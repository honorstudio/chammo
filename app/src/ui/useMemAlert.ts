// 맥 메모리 위험 알림 — 부하 모니터가 잰 값(ui/useLoad)이 바뀔 때마다 보고, 세션 하나가 메모리를 위험하게 먹으면 맡긴 참모에게 [앱] 한 줄.
// 같은 세션은 30분에 한 번. 판단은 domain/memAlert
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { forwardTo } from '../domain/forwardQuestion';
import type { LoadReport, SysLoad } from '../domain/load';
import { memAlertLine, memAlerts } from '../domain/memAlert';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';

const QUIET_MS = 30 * 60_000;

type In = { sys: SysLoad | null; report: LoadReport | null; orchs: Session[]; sessions: Session[]; events: TaskEvent[]; front?: Session; heir?: (s: Session) => Session | undefined };

export function useMemAlert(o: In) {
  const cur = useRef(o);
  cur.current = o;
  const last = useRef(new Map<string, number>());
  useEffect(() => {
    const { sys, report } = o;
    if (!sys || !report) return;
    const now = Date.now();
    for (const a of memAlerts(sys, report)) {
      if (now - (last.current.get(a.id) ?? 0) < QUIET_MS) continue;
      const x = cur.current;
      const s = x.sessions.find((v) => v.id === a.id);
      const to = (s && forwardTo(s, x.events, x.orchs, x.sessions, x.front, x.heir)) ?? x.front ?? x.orchs[0];
      if (!to || to.id === a.id) continue;
      last.current.set(a.id, now);
      void sendToSession(to.id, memAlertLine(a, sys)).catch(() => last.current.delete(a.id));
    }
  }, [o.sys, o.report]);
}
