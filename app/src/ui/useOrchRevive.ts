// 참모가 앱이 끄지 않았는데 목록에서 사라지면 같은 대화로 다시 켠다 — 판단은 domain/orchRevive, 켜기는 App(resumeSession = claude respawn).
// 3초마다 본다(목록 폴링과 같은 결). 연달아 죽어 멈추면 결정 대기함 카드 + 맥 알림 한 번, 그 참모가 다시 뜨면 카드를 닫는다
import { useEffect, useRef, useState } from 'react';
import { appendTaskEvent, appStoppedRecently, daemonStartedAt, daemonStoppedRecently } from '../data/tauri';
import { emptyRevive, planRevive, reviveCard, type ReviveMemo, type ReviveOrch } from '../domain/orchRevive';
import type { Session } from '../domain/session';
import { taskId } from '../domain/reviewSummary';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';
import { busyNow } from './busyNow';

const TICK = 3000;

export function useOrchRevive(o: {
  /** 살아 있는 참모(백그라운드) */
  orchs: Session[];
  /** 살아 있는 세션 전부(agents 목록) — 참모 묶음에서 빠졌어도 여기 있으면 산 것 */
  all: Session[];
  /** 세션 목록을 한 번이라도 읽었나 */
  ready: boolean;
  /** 다시 켜기 — 끝나면(실패해도) 돌아온다 */
  revive: (s: ReviveOrch) => Promise<void>;
  refresh: () => void;
}): ReviveOrch[] {
  const memo = useRef<ReviveMemo>(emptyRevive);
  const cards = useRef(new Map<string, string>()); // 참모 id → 카드 일 id
  const [reviving, setReviving] = useState<ReviveOrch[]>([]);
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => {
    let busy = false;
    const step = async () => {
      const c = latest.current;
      if (busy || !c.ready) return;
      busy = true;
      try {
        // 앱이 끈 목록을 못 읽으면 사람이 끈 참모를 켤 수 있다 — 그땐 판단하지 않는다
        const [daemon, stopped] = await Promise.all([daemonStartedAt().catch(() => null), appStoppedRecently().catch(() => null)]);
        if (!stopped) return;
        const live = latest.current.orchs.filter((s) => s.kind === 'background' && s.sessionId).map((s) => ({ id: s.id, sessionId: s.sessionId!, name: s.name, cwd: s.cwd }));
        const alive = new Set(latest.current.all.map((s) => s.id));
        // 터미널·스크립트의 claude stop 은 앱이 모른다 — 사라진 참모가 있을 때만 daemon.log 를 본다(#6). 못 읽으면 예전처럼(빈 목록)
        const gone = Object.keys(memo.current.seen).some((id) => !live.some((s) => s.id === id));
        const outside = gone ? await daemonStoppedRecently().catch(() => [] as string[]) : [];
        // 맥이 바쁘면 Claude Code 가 '응답 없음'으로 다시 켜는 중일 수 있다 — 겹쳐 켜지 않게 더 기다린다(domain/orchRevive BUSY_GONE_GRACE)
        const r = planRevive(memo.current, { live, now: Date.now(), daemon, stoppedByApp: (id) => stopped.includes(id), stoppedOutside: (id) => outside.includes(id), alive: (id) => alive.has(id), busy: busyNow() !== 'ok' });
        memo.current = r.memo;
        const goneIds = new Set(Object.keys(r.memo.goneAt));
        setReviving((x) => {
          const next = [...x.filter((s) => goneIds.has(s.id) && r.memo.gaveUp[s.id] == null), ...r.revive.filter((s) => !x.some((y) => y.id === s.id))];
          return next.length === x.length && next.every((s, i) => s.id === x[i]?.id) ? x : next;
        });
        for (const s of r.closed) {
          const task = cards.current.get(s.id);
          cards.current.delete(s.id);
          if (task) void appendTaskEvent({ ts: new Date().toISOString(), type: 'done', task, note: tr('다시 켜짐', 'Back up') }).catch(() => {});
        }
        for (const s of r.giveUp) {
          const task = taskId(new Date());
          cards.current.set(s.id, task);
          const [send, ask] = reviveCard(s, new Date().toISOString(), task);
          void appendTaskEvent(send).then(() => appendTaskEvent(ask)).then(() => latest.current.refresh(), () => {});
          notifyOnce({ kind: 'lost', session: s.id, orch: true, title: tr('참모 자동으로 다시 켜기 멈춤', 'Auto-restart paused'), body: String(ask.note) });
        }
        for (const s of r.revive) await latest.current.revive(s);
        if (r.revive.length) latest.current.refresh();
      } finally {
        busy = false;
      }
    };
    const t = window.setInterval(() => void step(), TICK);
    return () => window.clearInterval(t);
  }, []);
  return reviving;
}
