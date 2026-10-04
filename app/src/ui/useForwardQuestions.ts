// 하위 세션 선택지 창을 참모 입력칸에 한 줄로 넘긴다 — 판단은 domain/forwardQuestion.
// sessions 는 3초마다 새로 와서 이 효과도 그때마다 돈다(30초 유예를 따로 재지 않아도 된다)
// 2026-09-30: 질문으로 턴을 끝내고 기다리는 하위 세션도(선택지 창이 아닌 것) — 그 턴에 참모에게 말을 안 했을 때만
import { useEffect, useRef } from 'react';
import { readTranscriptTails, sendToSession } from '../data/tauri';
import { askForwardText, askKeyOf, forwardText, forwardTo, inputWaitText, nextAskForward, nextForward, retryAfterFail, toldOrch, type AskCand, type AskTrack } from '../domain/forwardQuestion';
import type { TaskEvent } from '../domain/tasks';
import type { Session } from '../domain/session';

const DONE_KEY = 'askForwarded';
const loadDone = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const saveDone = (d: Set<string>) => {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...d].slice(-200)));
  } catch {
    // 못 남겨도 이번 실행 동안은 한 번만 넘긴다
  }
};

/** orch = 맨 앞 참모(맡긴 참모를 못 찾을 때). 받을 참모는 forwardTo — 맡긴 참모 → 같은 프로젝트를 맡긴 참모 → 맡은 일(heir) → 맨 앞 */
export function useForwardQuestions(subs: Session[], orch: Session | undefined, watching: (s: Session) => boolean, asks: AskCand[] = [], orchSids: string[] = [], events: TaskEvent[] = [], orchs: Session[] = [], sessions: Session[] = [], heir?: (s: Session) => Session | undefined) {
  const track = useRef<AskTrack>(new Map());
  const busy = useRef(false);
  const done = useRef<Set<string> | null>(null);
  const fails = useRef(new Map<string, number>());
  useEffect(() => {
    if (busy.current) return;
    const toOf = (s: Session) => forwardTo(s, events, orchs, sessions, orch, heir);
    const r = nextForward(subs, toOf, track.current, Date.now(), watching);
    track.current = r.track;
    if (r.sub && r.to) {
      busy.current = true;
      const sub = r.sub;
      // 선택지 창(마지막 도구가 AskUserQuestion)이 아니면 scripts/choice 로 못 읽는다 — "입력 기다림"으로
      const choice = asks.find((a) => a.session.id === sub.id)?.activity.tool?.name === 'AskUserQuestion';
      void sendToSession(r.to.id, choice ? forwardText(sub) : inputWaitText(sub))
        .catch(() => { if (retryAfterFail(fails.current, sub.id)) track.current.delete(sub.id); }) // 못 넣었으면 다음 번에 다시 센다 — 세 번까지
        .finally(() => { busy.current = false; });
      return;
    }
    done.current ??= loadDone();
    const c = nextAskForward(asks, toOf, done.current, Date.now(), watching);
    const to = c && toOf(c.session);
    if (!c || !to) return;
    const key = askKeyOf(c);
    done.current.add(key); // 확인하는 동안 다시 안 잡게 — 못 넣으면 뺀다
    saveDone(done.current);
    busy.current = true;
    const since = c.activity.prompt?.ts ?? c.activity.reply!.ts;
    void readTranscriptTails(orchSids)
      .then((tails) => {
        if (toldOrch(Object.values(tails).join('\n'), c.session.name, since)) return; // 그 턴에 참모에게 이미 말했다
        return sendToSession(to.id, askForwardText(c.session, c.activity, Date.now()));
      })
      .catch(() => { if (retryAfterFail(fails.current, key)) { done.current?.delete(key); saveDone(done.current!); } })
      .finally(() => { busy.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, orch, events, orchs]);
}
