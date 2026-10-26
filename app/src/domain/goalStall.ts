// 오래 멈춘 목표(2026-10-26 사용자 "골이 오래 그 상태면 참모가 확인하고 정리하게 해 둔 건가?") — 세션 자동 정리(autoTidy)와 같은 길:
// 앱이 알아채서 그 목표를 맡긴 참모 입력칸에 [앱] 한 줄 → 참모가 기록·세션을 보고 done·goal-done / wait --until 다시 / ask.
// 기준: 목표의 마지막 움직임에서 24시간(날짜 없는 기다림 포함), 또는 wait --until 날짜가 지나고 1시간 그대로. 같은 목표엔 하루 한 번
// 안 알리는 것: 일하는 중 칸이 있는 목표·사람 답 기다림(결정 대기함에 이미 있다)·날짜가 아직인 기다림·끝난 목표·이름표 없는 일
import { tr } from '../i18n';
import { goalBar, isEnded, type Cell, type Goal } from './goalBar';
import { splitOrchName } from './orchLabel';
import { whenLabel } from './orchHome';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

const H = 3600_000;
export const GOAL_STALL_MS = 24 * H;
/** wait --until 날짜가 지나고 이만큼 그대로면 */
export const GOAL_OVERDUE_MS = H;
/** 같은 목표를 다시 알리기까지 */
export const GOAL_STALL_AGAIN_MS = 24 * H;

/** overdue 기다린 날짜 지남 · wait 날짜 없는 기다림 · quiet 조용 */
export type StallKind = 'overdue' | 'wait' | 'quiet';
export type GoalStall = { goal: Goal; kind: StallKind; tasks: string[] };

function cellStall(c: Cell, g: Goal, now: number): StallKind | undefined {
  if (isEnded(c.state) || c.state === 'todo' || c.state === 'ask' || c.state === 'run') return undefined;
  if (c.overdue !== undefined) return now - c.overdue >= GOAL_OVERDUE_MS ? 'overdue' : undefined;
  if (c.wait?.until !== undefined) return undefined;
  if (now - g.lastAt < GOAL_STALL_MS) return undefined;
  return c.state === 'wait' ? 'wait' : 'quiet';
}

/** 이 목표가 오래 멈췄나 — tasks = 멈춘 일 번호 */
export function goalStall(g: Goal, now: number): GoalStall | undefined {
  if (!g.name || g.finished || g.cells.some((c) => c.state === 'run')) return undefined;
  const hit = g.cells.map((c) => [c, cellStall(c, g, now)] as const).filter((x): x is readonly [Cell, StallKind] => !!x[1]);
  if (!hit.length) return undefined;
  const kinds = new Set(hit.map((x) => x[1]));
  const kind: StallKind = kinds.has('overdue') ? 'overdue' : kinds.has('quiet') ? 'quiet' : 'wait';
  return { goal: g, kind, tasks: hit.map((x) => x[0].task) };
}

/** 같은 참모·같은 목표 — 기본 이름이라 되살아나 id 가 바뀌어도 같다 */
export const stallKey = (orch: { name: string }, goal: string) => `${splitOrchName(orch.name).base}|${goal}`;

/** 이번에 알릴 목표 하나 + 받을 참모. 참모가 쉬는 중일 때만(아니면 다음 폴링에 다시 잡힌다). last = 열쇠마다 마지막으로 알린 때 */
export function pickGoalStall(
  orchs: Session[],
  o: { events: TaskEvent[]; sessions: Session[]; now: number; last: ReadonlyMap<string, number> },
): { orch: Session; stall: GoalStall; key: string } | undefined {
  for (const orch of orchs) {
    if (orch.state !== 'idle') continue;
    for (const g of goalBar({ events: o.events, sessions: o.sessions, orch: { id: orch.id, name: orch.name }, now: o.now, seen: new Set() }).goals) {
      const stall = goalStall(g, o.now);
      if (!stall) continue;
      const key = stallKey(orch, g.name);
      const at = o.last.get(key);
      if (at !== undefined && o.now - at < GOAL_STALL_AGAIN_MS) continue;
      return { orch, stall, key };
    }
  }
  return undefined;
}

/** 참모 입력칸에 넣을 한 줄(Enter 로 보내져서 줄바꿈 없이) — 정리할 세션 줄과 같은 모양 */
export function stallText(s: GoalStall, now: number): string {
  const g = s.goal;
  const what = { overdue: tr('기다린 날짜 지남', 'wait date passed'), wait: tr('기다림', 'waiting'), quiet: tr('조용', 'quiet') }[s.kind];
  const ids = s.tasks.slice(0, 3).join(', ') + (s.tasks.length > 3 ? tr(` 외 ${s.tasks.length - 3}`, ` +${s.tasks.length - 3}`) : '');
  const todo = tr('기록·세션을 보고 끝났으면 done·goal-done, 기다리는 중이면 wait --until 로 날짜를 다시, 사용자가 정할 거면 ask',
    "Check the log and session: if it's finished, done/goal-done; if still waiting, set wait --until again; if the user must decide, ask");
  return tr(`[앱] 오래 멈춘 목표: ${g.name} — 조각 ${g.done}/${g.total} · 마지막 ${whenLabel(g.lastAt, now)} · ${what} · 일 ${ids}. ${todo}`,
    `[app] Stalled goal: ${g.name} — ${g.done}/${g.total} · last ${whenLabel(g.lastAt, now)} · ${what} · task ${ids}. ${todo}`);
}
