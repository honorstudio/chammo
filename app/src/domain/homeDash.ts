// 홈 대시보드(참모 채팅 없는 전체 한눈에, 시안 docs/design-drafts/home-dash v1 HA — 사용자 10-24 고름) 숫자·칸.
// 새로 기록하는 건 없다: 참모별 진행 칸(goalBar)의 칸 상태 + 작업 기록(tasks.jsonl)의 done 만으로
import type { GoalBar } from './goalBar';
import { workDayStart, type TaskEvent } from './tasks';

export type HomeCounts = { asks: number; running: number; quiet: number; doneToday: number };
/** 참모 타일 — 진행 칸에서 일하는 칸·답 기다림 칸·오래 조용 칸 수 */
export type OrchTileCount = { id: string; run: number; ask: number; quiet: number };
/** 오래 조용 — 진행 칸의 quiet 칸(맡긴 참모·세션) */
export type QuietRow = { orch: string; task: string; title: string; target: string; at?: number };
/** 오늘 끝난 일 — orch 는 맡긴 참모(이 맥 참모가 아니면 없음) */
export type DoneRow = { task: string; title: string; target: string; orch?: string; at: number };

export function homeDash(o: {
  orchs: { id: string; name: string }[];
  bars: Record<string, GoalBar>;
  events: TaskEvent[];
  /** 결정 대기함 수(물음 + 직접 카드) — 앱 위 종과 같은 수 */
  asks: number;
  /** 일하는 프로젝트 세션 수 */
  running: number;
  now: number;
}): { counts: HomeCounts; tiles: OrchTileCount[]; quiet: QuietRow[]; done: DoneRow[] } {
  const tiles: OrchTileCount[] = [];
  const quiet = new Map<string, QuietRow>();
  for (const orch of o.orchs) {
    const cells = (o.bars[orch.id]?.goals ?? []).flatMap((g) => g.cells);
    const n = (s: string) => cells.filter((c) => c.state === s).length;
    tiles.push({ id: orch.id, run: n('run'), ask: n('ask'), quiet: n('quiet') });
    // 넘긴 일은 두 참모 칸에 같이 보일 수 있다 — 먼저 본 참모 것으로 한 번만
    for (const c of cells) if (c.state === 'quiet' && !quiet.has(c.task)) quiet.set(c.task, { orch: orch.id, task: c.task, title: c.title, target: c.target, at: c.at });
  }

  const start = workDayStart(o.now);
  const ids = new Set(o.orchs.map((x) => x.id));
  const sends = new Map(o.events.filter((e) => e.type === 'send').map((e) => [e.task, e]));
  const ended = new Map<string, number>();
  for (const e of o.events) {
    if (e.type !== 'done') continue;
    const t = Date.parse(e.ts);
    if (t >= start && t <= o.now) ended.set(e.task, Math.max(ended.get(e.task) ?? 0, t));
  }
  const done: DoneRow[] = [...ended].flatMap(([task, at]) => {
    const s = sends.get(task);
    if (!s) return [];
    return [{ task, title: s.title ?? '', target: s.target ?? '', ...(s.from && ids.has(s.from) ? { orch: s.from } : {}), at }];
  }).sort((a, b) => b.at - a.at);

  const q = [...quiet.values()];
  return { counts: { asks: o.asks, running: o.running, quiet: q.length, doneToday: done.length }, tiles, quiet: q, done };
}
