// 세션 자동 정리 — 끝난 팀 세션을 맡긴 참모 입력칸에 [앱] 한 줄로 알린다. 판단은 domain/autoTidy.
// 1분마다 본다(일·세션 목록은 3초마다 오지만 2시간·24시간 판정이라 촘촘할 필요가 없다). git 은 다른 조건을 다 통과한 후보 폴더만 본다
import { useEffect, useRef } from 'react';
import { sendToSession, tidyGit } from '../data/tauri';
import { progressHint } from '../domain/progressHint';
import { pickTidy, tidyKey, tidyLight, tidyText, tidyVerdict, type TidyCand } from '../domain/autoTidy';
import { forwardTo, retryAfterFail, type AskCand } from '../domain/forwardQuestion';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { every } from './poll';

const SEEN_KEY = 'autoTidySeen';
const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const saveSeen = (d: Set<string>) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...d].slice(-200)));
  } catch {
    // 못 남겨도 이번 실행 동안은 한 번만 넘긴다
  }
};

export const TIDY_POLL_MS = 60_000;

type In = {
  on: boolean;
  /** 팀 세션(도우미·프로젝트 밖·프로젝트) — 참모는 넣지 않는다 */
  subs: Session[];
  /** HQ 안의 도우미 — 정리 줄이 '갱신 없이 바로 끄기'(예약 routine-<이름> 도) */
  helpers: Session[];
  acts: AskCand[];
  events: TaskEvent[];
  /** 답을 기다리는 직접 답하기 카드를 띄운 세션 id */
  asking: string[];
  front?: Session;
  orchs: Session[];
  sessions: Session[];
  heir?: (s: Session) => Session | undefined;
};

export function useAutoTidy(o: In) {
  const cur = useRef(o);
  cur.current = o;
  const busy = useRef(false);
  const seen = useRef<Set<string> | null>(null);
  const fails = useRef(new Map<string, number>());
  useEffect(() => {
    const tick = async () => {
      const x = cur.current;
      if (!x.on || busy.current || !x.orchs.length) return;
      seen.current ??= loadSeen();
      const now = Date.now();
      const asking = new Set(x.asking);
      const orchIds = new Set(x.orchs.map((s) => s.id));
      const base: TidyCand[] = x.subs.filter((s) => !orchIds.has(s.id)).map((s) => ({ session: s, activity: x.acts.find((a) => a.session.id === s.id)?.activity }));
      const want = base.filter((c) => {
        const v = tidyVerdict(c, { events: x.events, now, asking });
        return v && !seen.current!.has(tidyKey(c.session, v.since));
      });
      if (!want.length) return;
      busy.current = true;
      try {
        const git = new Map((await tidyGit([...new Set(want.map((c) => c.session.cwd))])).map((g) => [g.dir, g]));
        const cands = want.map((c) => ({ ...c, git: git.get(c.session.cwd) })).filter((c) => c.git);
        const p = pickTidy(cands, { events: x.events, now, asking, seen: seen.current!, toOf: (s) => forwardTo(s, x.events, x.orchs, x.sessions, x.front, x.heir) });
        if (!p) return;
        const key = tidyKey(p.cand.session, p.verdict.since);
        seen.current!.add(key); // 넣는 동안 다시 안 잡게 — 못 넣으면 뺀다(세 번까지)
        saveSeen(seen.current!);
        await sendToSession(p.to.id, tidyText(p.cand.session, p.verdict.reason, tidyLight(p.cand.session, x.helpers), progressHint(p.cand.activity, p.cand.git))).catch(() => {
          if (retryAfterFail(fails.current, key)) { seen.current!.delete(key); saveSeen(seen.current!); }
        });
      } catch {
        // git 을 못 읽었으면 다음 번에
      } finally {
        busy.current = false;
      }
    };
    void tick();
    return every(() => void tick(), TIDY_POLL_MS);
  }, []);
}
