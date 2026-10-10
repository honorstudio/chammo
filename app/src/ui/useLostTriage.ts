// 재시작으로 꺼진 세션을 사람 대신 처리한다 — 판단은 domain/lostTriage.
// 끝난 건 꺼진 목록에서 조용히 빼고, 안 끝난 건 주인 참모 입력칸에 한 줄. 참모가 하나도 없으면 hold 를 돌려줘 홈에 짧게 보인다.
// 같은 알림을 두 번 안 보내게 기록(live.json)에서 먼저 지우고 보낸다 — 못 보내면 꺼진 목록에 되돌리고 30초·60초 뒤 다시, 세 번 실패하면 이번 실행에선 그만두고
// 사람에게 맥 알림 한 번(참모가 있으면 홈이 안 보여 아무도 몰랐다). 목록엔 남아 다음 실행에 다시
import { useEffect, useRef, useState } from 'react';
import { listSessionsAllRaw, readTranscriptTails, sendToSession } from '../data/tauri';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';
import { summarizeTranscript } from '../domain/activity';
import { forgetLost, lastDoing, planNotices, restartNotice, triageLost } from '../domain/lostTriage';
import type { LiveSnap, SnapSession } from '../domain/revive';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';

const RETRY_MS = 30_000;
const MAX_FAILS = 3;

export function useLostTriage(o: {
  lost: SnapSession[];
  /** 꺼진 목록 계산·작업 기록을 한 번이라도 읽었나 */
  ready: boolean;
  sessions: Session[];
  events: TaskEvent[];
  orchs: Session[];
  front?: Session;
  heir: (s: Session) => Session | undefined;
  isOrch: (s: SnapSession) => boolean;
  autoRevive: boolean;
  devRoot?: string;
  extras: string[];
  /** 기록(live.json)을 고친다 — 다 쓰고 나서 끝난다 */
  update: (f: (s: LiveSnap) => LiveSnap) => Promise<void>;
}): { hold: SnapSession[]; open: SnapSession[] } {
  const [hold, setHold] = useState<SnapSession[]>([]);
  // 자동으로 다시 켜기(무인 맥)가 켤 것 — 판단을 마친 '안 끝남'만. 판단 전에 켜면 끝난 세션까지 켠다
  const [open, setOpen] = useState<SnapSession[]>([]);
  const busy = useRef(false);
  // 도는 동안 값이 바뀌면 끝나고 한 번 더 — 안 그러면 그 사이 뜬 참모에게 보낼 기회를 다음 변화까지 놓친다
  const dirty = useRef(false);
  const [tick, setTick] = useState(0);
  const fails = useRef(new Map<string, number>()); // 대화 id → 보내기 실패 횟수
  const notBefore = useRef(new Map<string, number>()); // 대화 id → 다시 보내도 되는 때

  const latest = useRef(o);
  latest.current = o;
  const lostKey = o.lost.map((s) => s.sessionId).join(',');
  const orchKey = o.orchs.map((s) => `${s.id}:${s.state}`).join(',');
  useEffect(() => {
    const c = latest.current;
    if (!c.ready || c.devRoot == null) return;
    if (busy.current) { dirty.current = true; return; }
    if (!c.lost.length) { setHold((h) => (h.length ? [] : h)); setOpen((x) => (x.length ? [] : x)); return; }
    busy.current = true;
    void (async () => {
      try {
        const tails = await readTranscriptTails(c.lost.map((s) => s.sessionId)).catch(() => ({} as Record<string, string>));
        const activity = Object.fromEntries(Object.entries(tails).map(([k, v]) => [k, summarizeTranscript(v)]));
        // '지워졌다(rm)'는 지금 새로 읽은 agents --all 로만 — 앞 폴링 목록엔 막 꺼진 세션이 아직 없어 일하던 세션을 빼 버렸다(리뷰 1).
        // 못 읽었거나 비어 있으면 모름 — 끝난 세션을 잘못 빼면 아무도 모르게 일이 사라진다
        const all = await listSessionsAllRaw().then((j) => JSON.parse(j) as { sessionId?: string }[], () => null);
        const listOk = Array.isArray(all) && all.length > 0;
        const listed = new Set([...(listOk ? all : []), ...c.sessions].map((s) => s.sessionId).filter(Boolean));
        const { drop, open } = triageLost(c.lost, { events: c.events, activity, listed: (s) => (listed.has(s.sessionId) ? true : listOk ? false : undefined), isOrch: c.isOrch, autoRevive: c.autoRevive });
        if (drop.length) await c.update((s) => forgetLost(s, drop.map((x) => x.sessionId)));
        if (c.autoRevive) { setHold([]); setOpen(open); return; } // 무인 맥 — 안 끝난 건 자동으로 이어서 켠다(App autoRestore)
        setOpen([]);
        const plan = planNotices(open, { events: c.events, orchs: c.orchs, sessions: c.sessions, front: c.front, heir: c.heir, devRoot: c.devRoot!, extras: c.extras });
        setHold(plan.hold);
        const now = Date.now();
        for (const n of plan.notices) {
          const go = n.sessions.filter((x) => (fails.current.get(x.sessionId) ?? 0) < MAX_FAILS && (notBefore.current.get(x.sessionId) ?? 0) <= now);
          if (!go.length) continue;
          const ids = go.map((x) => x.sessionId);
          await c.update((s) => forgetLost(s, ids)); // 기록부터 — 보낸 뒤 쓰다 실패하면 다음 폴링에 또 보낸다
          try {
            await sendToSession(n.to.id, restartNotice(go.map((x) => ({ s: x, doing: lastDoing(x, c.events, activity[x.sessionId]) }))));
          } catch {
            // 참모를 막 켠 순간엔 화면이 아직 안 떠 실패하기 쉽다 — 바로 말고 간격을 두고
            const k = Math.max(...ids.map((id) => (fails.current.get(id) ?? 0) + 1));
            for (const id of ids) { fails.current.set(id, k); notBefore.current.set(id, now + RETRY_MS * k); }
            await c.update((s) => ({ ...s, lost: [...s.lost, ...go.filter((x) => !s.lost.some((y) => y.sessionId === x.sessionId))] }));
            if (k < MAX_FAILS) window.setTimeout(() => setTick((v) => v + 1), RETRY_MS * k + 500);
            else notifyOnce({ kind: 'lost', session: n.to.id, orch: false, title: tr('재시작으로 꺼진 세션을 참모에게 못 알렸어요', 'Could not tell your assistant about stopped sessions'),
              body: tr(`${go.map((x) => x.name || x.sessionId.slice(0, 8)).join(', ')} — 이어서 할지 직접 봐 주세요`, `${go.map((x) => x.name || x.sessionId.slice(0, 8)).join(', ')} — check whether to continue`) });
          }
        }
      } finally {
        busy.current = false;
        if (dirty.current) { dirty.current = false; setTick((n) => n + 1); }
      }
    })();
  }, [lostKey, orchKey, o.ready, o.autoRevive, o.events.length, o.devRoot, tick]);
  return { hold, open };
}
