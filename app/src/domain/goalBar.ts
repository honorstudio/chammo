// 참모 홈 진행 칸 — 참모마다 맡은 일 전체가 어디까지 왔나(시안 docs/design-drafts/progress-bar, 사용자 10-23 확정).
// 참모·세션은 아무것도 따로 보고하지 않는다: 작업 기록(tasks.jsonl) + 세션 상태 + 세션 할 일 목록 비율만으로 계산(토큰 0).
// 막대 = 목표 조각들(`scripts/task send --goal "<목표>[:예정 수]"`), 칸 하나 = send 한 건. 이름표 없는 일은 '기타' 조각.
// 끝난 조각은 결과 한 줄과 함께 잠깐 남고, 한 번 보면·참모당 최근 3개를 넘으면·하루 지나면 빠진다(사용자 10-23)
import { findTarget } from './inbox';
import { splitOrchName } from './orchLabel';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

const H = 3600_000;
/** 이보다 오래 기척 없으면 '오래 조용' — send→done 90% 가 182분(2026-10-23 사용자 기록 7일) */
export const QUIET_MS = 3 * H;
/** 이보다 오래된 send 는 안 센다 */
const WINDOW_MS = 7 * 24 * H;
/** 끝난 조각을 남겨 두는 최대 시간·개수 */
const DONE_KEEP_MS = 24 * H;
const DONE_KEEP_N = 3;

/** done 끝 · auto 앱이 닫음(회신 + 세션 꺼짐/끝냄, PR 머지) · ask 사용자 답 기다림 · run 일하는 중 · quiet 오래 조용 · stop 답 없이 꺼짐 · rest 쉬는 중 · todo 아직 안 보냄 */
export type CellState = 'done' | 'auto' | 'ask' | 'run' | 'quiet' | 'stop' | 'rest' | 'todo';

/** 칸 하나를 정하는 데 쓰는 기록 사실 */
export type CellFacts = { finished: boolean; replied: boolean; asks: number; answers: number; lastAt: number; notes: string[] };

export const isEnded = (s: CellState) => s === 'done' || s === 'auto';

const prsIn = (t: string) => [...t.matchAll(/#(\d{2,})/g)].map((m) => m[1]!);

/** 칸 상태 — 위에서 먼저 맞는 것(README 계산 규칙). merged = 머지된 PR 번호 */
export function cellState(f: CellFacts, s: Session | undefined, now: number, merged?: Set<string>): CellState {
  if (f.finished) return 'done';
  if (f.asks > f.answers) return 'ask';
  if (f.replied && (!s || s.finished)) return 'auto';
  if (f.replied && merged?.size && f.notes.some((n) => prsIn(n).some((p) => merged.has(p)))) return 'auto';
  if (s?.state === 'working') return 'run';
  if (now - f.lastAt > QUIET_MS) return 'quiet';
  if (!s) return 'stop';
  return 'rest';
}

/** 끝난 조각에 붙는 결과 한 줄 — done(또는 회신) 메모의 PR 번호·주소, 없으면 메모 첫 줄 */
export function prResult(note: string | undefined): string {
  if (!note) return '';
  const refs = [...new Set([...note.matchAll(/#\d{2,}|https?:\/\/[^\s,)·]+/g)].map((m) => m[0]))];
  if (refs.length) return refs.slice(0, 3).join(' · ');
  const first = note.split('\n')[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

export type Cell = {
  task: string; title: string; target: string; state: CellState;
  /** 마지막 기척(send·reply·ask…) */
  at?: number;
  /** 일하는 중 칸 채움 0~1(세션 할 일 목록 끝난 비율) */
  fill?: number;
  /** 끝난 이름표 없는 칸 — 사라짐 열쇠(봤음 기록) */
  unit?: string;
  endedAt?: number;
};
export type Goal = {
  key: string; name: string; project?: string; cells: Cell[];
  /** 끝 칸(끝 + 앱이 닫음) / 전체 칸(예정 칸 수가 더 크면 그것) */
  done: number; total: number;
  finished: boolean;
  /** 칸들 마지막 기척 */
  lastAt: number;
  /** 끝난 목표의 결과 한 줄·사라짐 열쇠 */
  result?: string; unit?: string; endedAt?: number;
};
export type GoalBar = { goals: Goal[]; done: number; total: number; byProject: boolean };

/** 이 참모 일인가 — send 의 from(또는 사용자가 붙인 own), 되살아나 id 가 바뀌었으면 기본 이름(fromName) */
function mine(events: TaskEvent[], orch: { id: string; name: string }) {
  const base = splitOrchName(orch.name).base;
  const own = new Map<string, TaskEvent>();
  for (const e of events) if (e.type === 'send' || (e.type === 'own' && e.from)) own.set(e.task, e);
  return (task: string) => {
    const e = own.get(task);
    if (!e) return false;
    if (e.type === 'own') return e.from === orch.id;
    return e.from === orch.id || (!!e.fromName && e.fromName === base);
  };
}

export function goalBar(o: {
  events: TaskEvent[]; sessions: Session[]; orch: { id: string; name: string }; now: number;
  /** 봤음 기록(사라짐 열쇠) */
  seen: Set<string>;
  /** 세션 할 일 목록 끝난 비율 */
  fill?: (s: Session) => number | undefined;
  merged?: Set<string>;
}): GoalBar {
  const { events, sessions, now } = o;
  const isMine = mine(events, o.orch);
  type Acc = { send: TaskEvent; f: CellFacts; endNote?: string; endAt?: number };
  const acc = new Map<string, Acc>();
  for (const e of events) {
    if (e.type === 'send') {
      if (now - Date.parse(e.ts) > WINDOW_MS) continue;
      acc.set(e.task, { send: e, f: { finished: false, replied: false, asks: 0, answers: 0, lastAt: Date.parse(e.ts), notes: [] } });
      continue;
    }
    const a = acc.get(e.task);
    if (!a) continue;
    const t = Date.parse(e.ts);
    a.f.lastAt = Math.max(a.f.lastAt, t);
    if (e.note) a.f.notes.push(e.note);
    if (e.target) a.send = { ...a.send, target: e.target };
    if (e.type === 'done') { a.f.finished = true; a.endNote = e.note; a.endAt = t; }
    if (e.type === 'reply') { a.f.replied = true; if (!a.f.finished) { a.endNote = e.note; a.endAt = t; } }
    if (e.type === 'ask') a.f.asks++;
    if (e.type === 'answer') a.f.answers++;
  }

  const rows = [...acc.values()].filter((a) => isMine(a.send.task)).map((a) => {
    const s = findTarget(sessions, a.send.target);
    const state = cellState(a.f, s, now, o.merged);
    const fill = state === 'run' && s && o.fill ? o.fill(s) : undefined;
    const cell: Cell = { task: a.send.task, title: a.send.title ?? '', target: a.send.target ?? '', state, at: a.f.lastAt, ...(fill !== undefined ? { fill } : {}) };
    if (isEnded(state)) cell.endedAt = a.endAt ?? a.f.lastAt;
    return { a, cell, project: a.send.project ?? s?.project ?? '' };
  });
  const byProject = new Set(rows.map((r) => r.project).filter(Boolean)).size >= 2;

  // 목표마다 모으기 — 보낸 순
  const groups = new Map<string, { name: string; project: string; total: number; first: number; rows: typeof rows }>();
  for (const r of rows.sort((x, y) => Date.parse(x.a.send.ts) - Date.parse(y.a.send.ts))) {
    // 목표는 프로젝트를 걸쳐도 한 조각(첫 일의 프로젝트 밑), 기타만 프로젝트마다
    const name = r.a.send.goal ?? '';
    const key = name ? `g|${name}` : `e|${byProject ? r.project : ''}`;
    const g = groups.get(key) ?? { name, project: byProject ? r.project : '', total: 0, first: Date.parse(r.a.send.ts), rows: [] };
    g.total = Math.max(g.total, r.a.send.goalTotal ?? 0);
    g.rows.push(r);
    groups.set(key, g);
  }

  const goals: Goal[] = [];
  for (const [key, g] of groups) {
    const cells = g.rows.map((r) => r.cell);
    const total = Math.max(cells.length, g.total);
    const ended = cells.filter((c) => isEnded(c.state));
    const goal: Goal = { key, name: g.name, ...(byProject ? { project: g.project } : {}), cells, done: ended.length, total, finished: false, lastAt: Math.max(...cells.map((c) => c.at ?? 0)) };
    if (g.name && ended.length === total) {
      const last = g.rows.filter((r) => isEnded(r.cell.state)).sort((x, y) => (x.cell.endedAt ?? 0) - (y.cell.endedAt ?? 0)).pop()!;
      goal.finished = true;
      goal.endedAt = last.cell.endedAt;
      goal.result = prResult(last.a.endNote);
      goal.unit = `${key}|${goal.endedAt}`;
    }
    if (!g.name) for (const c of cells) if (isEnded(c.state)) c.unit = `t|${c.task}`;
    goals.push(goal);
  }

  // 끝난 조각(끝난 목표 + 기타의 끝난 칸) — 봤으면·하루 지났으면 빼고, 남은 것 중 최근 3개만
  const units = [
    ...goals.filter((g) => g.finished).map((g) => ({ unit: g.unit!, at: g.endedAt ?? 0 })),
    ...goals.filter((g) => !g.name).flatMap((g) => g.cells.filter((c) => c.unit).map((c) => ({ unit: c.unit!, at: c.endedAt ?? 0 }))),
  ];
  const keep = new Set(units.filter((u) => !o.seen.has(u.unit) && now - u.at <= DONE_KEEP_MS)
    .sort((a, b) => b.at - a.at).slice(0, DONE_KEEP_N).map((u) => u.unit));
  const shown = goals.flatMap((g): Goal[] => {
    if (g.finished) return keep.has(g.unit!) ? [g] : [];
    if (g.name) return [g];
    const cells = g.cells.filter((c) => !c.unit || keep.has(c.unit));
    if (!cells.length) return [];
    const done = cells.filter((c) => isEnded(c.state)).length;
    return [{ ...g, cells, done, total: cells.length, lastAt: Math.max(...cells.map((c) => c.at ?? 0)) }];
  });

  // 이름표 있는 목표 먼저(보낸 순) · 기타는 끝, 프로젝트로 묶으면 프로젝트 이름순
  const first = (g: Goal) => groups.get(g.key)!.first;
  shown.sort((a, b) => (a.project ?? '').localeCompare(b.project ?? '') || Number(!a.name) - Number(!b.name) || first(a) - first(b));
  for (const g of shown) {
    const todo = g.total - g.cells.length;
    if (todo > 0) g.cells = [...g.cells, ...Array.from({ length: todo }, (_, i): Cell => ({ task: `${g.key}#todo${i}`, title: '', target: '', state: 'todo' }))];
  }
  return { goals: shown, done: shown.reduce((n, g) => n + g.done, 0), total: shown.reduce((n, g) => n + g.total, 0), byProject };
}
