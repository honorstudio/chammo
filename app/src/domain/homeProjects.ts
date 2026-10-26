// 홈 '지금 돌아가는 프로젝트' 칸(시안 docs/design-drafts/home-projects v1 A — 사용자 10-25 고름: 참모 줄 아래 프로젝트 줄 목록, 접기·창 높이 맞춤).
// 새로 기록하는 건 없다: 세션 목록(프로젝트 묶음) + 작업 기록(tasks.jsonl)을 프로젝트 폴더로 모은다. 칸 상태는 진행 칸(goalBar cellState) 규칙 그대로
import { cellState, type CellFacts, type CellState } from './goalBar';
import { findTarget } from './inbox';
import type { Session } from './session';
import type { ActivityStatus } from './status';
import { workDayStart, type TaskEvent } from './tasks';

const H = 3600_000;
/** 이보다 오래 기척 없는 안 끝난 일은 프로젝트를 홈에 올리지 않는다(물음·기다림은 빼고) */
const ACTIVE_MS = 24 * H;
/** 상태를 셀 때 보는 send 범위 — 진행 칸과 같은 7일 */
const WINDOW_MS = 7 * 24 * H;

/** 막힘 · 답 기다림 · 오래 조용 · 일하는 중 · 기다림(밖) · 쉼 · 오늘 끝남 — 앞일수록 급하다 */
export type ProjState = 'stop' | 'ask' | 'quiet' | 'run' | 'wait' | 'rest' | 'done';
const ORDER: ProjState[] = ['stop', 'ask', 'quiet', 'run', 'wait', 'rest', 'done'];
const rank = (s: ProjState) => ORDER.indexOf(s);

export type ProjTask = { task: string; title: string; target: string; state: ProjState; at: number; orch?: string };
export type ProjRow = {
  name: string; state: ProjState;
  /** 지금 하는 일 한 줄 — 가장 급한 안 끝난 일의 제목(없으면 세션의 지금 줄) */
  line: string;
  /** 그 상태의 때 — 가장 급한 일의 마지막 기척(오늘 끝남은 끝난 때) */
  at: number;
  /** 기다림이면 이때까지 */
  until?: number;
  /** 맡은 참모 id — 최근에 보낸 순 */
  orchs: string[];
  sessions: Session[];
  tasks: ProjTask[];
};

const fromCell = (c: CellState): ProjState => (c === 'done' || c === 'auto' ? 'done' : c === 'todo' ? 'rest' : c);
const fromSession = (st: ActivityStatus): ProjState | null =>
  st === 'blocked' || st === 'login' ? 'stop' : st === 'asks' ? 'ask' : st === 'working' ? 'run' : null;

/** groups = 프로젝트 묶음(session.groupByProject — 참모·도우미·예약 밖), sessions = 모든 세션(꺼진 일의 대상 찾기) */
export function homeProjects(o: {
  groups: { name: string; sessions: Session[] }[];
  sessions: Session[];
  events: TaskEvent[];
  /** 이 맥 참모 id — 맡은 참모로 붙일 것만 */
  orchIds: string[];
  statusOf: (s: Session) => ActivityStatus;
  /** 일이 없는 세션의 지금 줄(대화 기록의 마지막 동작) */
  lineOf?: (s: Session) => string | undefined;
  now: number;
}): { live: ProjRow[]; done: ProjRow[] } {
  const { now } = o;
  const inGroup = new Map(o.groups.flatMap((g) => g.sessions.map((s) => [s.id, g.name] as const)));

  // 일마다 기록 사실 — goalBar collect 와 같은 규칙(넘김 큰 일 칸은 받은 쪽 send 가 따로 있으니 안 센다)
  type Acc = { send: TaskEvent; f: CellFacts; endAt?: number };
  const acc = new Map<string, Acc>();
  for (const e of o.events) {
    const t = Date.parse(e.ts);
    if (e.type === 'send') {
      if (now - t > WINDOW_MS) continue;
      for (const a of acc.values()) if (a.f.wait && a.send.target === e.target && !(a.f.wait.until && a.f.wait.until > t)) delete a.f.wait;
      acc.set(e.task, { send: e, f: { finished: false, replied: false, asks: 0, answers: 0, lastAt: t, notes: [] } });
      continue;
    }
    const a = acc.get(e.task);
    if (!a) continue;
    a.f.lastAt = Math.max(a.f.lastAt, t);
    if (e.note) a.f.notes.push(e.note);
    if (e.target) a.send = { ...a.send, target: e.target };
    if (e.type === 'done') { a.f.finished = true; a.endAt = t; }
    if (e.type === 'reply') { a.f.replied = true; a.endAt ??= t; }
    if (e.type === 'ask') a.f.asks++;
    if (e.type === 'answer') a.f.answers++;
    if (e.type === 'wait') a.f.wait = { why: e.note ?? '', on: e.on === 'user' ? 'user' : 'outside', ...(e.until && !Number.isNaN(Date.parse(e.until)) ? { until: Date.parse(e.until) } : {}) };
    else if (e.type === 'reply' || e.type === 'done' || e.type === 'answer' || e.retry) delete a.f.wait;
  }

  const today = workDayStart(now);
  const byProject = new Map<string, { tasks: ProjTask[]; until?: number; sends: { orch: string; at: number }[] }>();
  for (const a of acc.values()) {
    const s = findTarget(o.sessions, a.send.target);
    // 살아 있는 대상이 프로젝트 묶음 밖(참모·도우미)이면 프로젝트 일이 아니다
    if (s && !inGroup.has(s.id)) continue;
    const project = (s && inGroup.get(s.id)) ?? a.send.project;
    if (!project) continue;
    const state = fromCell(cellState(a.f, s, now));
    const live = a.f.wait && (a.f.wait.until === undefined || now < a.f.wait.until);
    const at = state === 'done' ? a.endAt ?? a.f.lastAt : a.f.lastAt;
    // 안 끝난 일은 24시간 안 기척·물음·기다림만, 끝난 일은 오늘 끝난 것만
    const keep = state === 'done' ? at >= today : state === 'ask' || live || now - a.f.lastAt <= ACTIVE_MS;
    if (!keep) continue;
    const p = byProject.get(project) ?? { tasks: [], sends: [] };
    const orch = a.send.from && o.orchIds.includes(a.send.from) ? a.send.from : undefined;
    p.tasks.push({ task: a.send.task, title: a.send.title ?? '', target: a.send.target ?? '', state, at, ...(orch ? { orch } : {}) });
    if (orch) p.sends.push({ orch, at: Date.parse(a.send.ts) });
    if (state === 'wait' && a.f.wait?.until) p.until = Math.max(p.until ?? 0, a.f.wait.until);
    byProject.set(project, p);
  }

  const names = [...new Set([...o.groups.map((g) => g.name), ...byProject.keys()])];
  const rows = names.map((name): ProjRow => {
    const sessions = o.groups.find((g) => g.name === name)?.sessions ?? [];
    const p = byProject.get(name) ?? { tasks: [], sends: [] };
    const tasks = [...p.tasks].sort((x, y) => rank(x.state) - rank(y.state) || y.at - x.at);
    const sesState = sessions.map((s) => fromSession(o.statusOf(s))).filter((x): x is ProjState => !!x).sort((x, y) => rank(x) - rank(y))[0];
    const top = tasks[0];
    const state = [sesState, top?.state, sessions.length && !top ? 'rest' as const : undefined].filter((x): x is ProjState => !!x).sort((x, y) => rank(x) - rank(y))[0] ?? 'rest';
    const open = tasks.find((t) => t.state !== 'done');
    const working = sessions.find((s) => fromSession(o.statusOf(s)) === state);
    const line = open?.title || (working && o.lineOf?.(working)) || (state === 'done' ? top?.title : undefined) || '';
    const orchs = [...new Map([...p.sends].sort((x, y) => y.at - x.at).map((x) => [x.orch, x.orch])).keys()];
    const at = top ? (state === 'done' ? Math.max(...tasks.map((t) => t.at)) : top.at) : 0;
    return { name, state, line, at, ...(state === 'wait' && p.until ? { until: p.until } : {}), orchs, sessions, tasks };
  });
  const sort = (a: ProjRow, b: ProjRow) => rank(a.state) - rank(b.state) || b.at - a.at || a.name.localeCompare(b.name);
  return { live: rows.filter((r) => r.state !== 'done').sort(sort), done: rows.filter((r) => r.state === 'done').sort(sort) };
}

/** 접힘 — list 목록 전체 펼침, open 펼친 줄(프로젝트 이름), more '+N개 더'를 펼침 */
export type Fold = { list: boolean; open: string[]; more: boolean };
const OPEN_KEEP = 30;
export const FOLD_KEY = 'homeProjects.fold.v1';

export function readFold(raw: string | null): Fold {
  let v: unknown;
  try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    list: typeof x.list === 'boolean' ? x.list : true,
    open: Array.isArray(x.open) ? x.open.filter((n): n is string => typeof n === 'string').slice(-OPEN_KEEP) : [],
    more: x.more === true,
  };
}
export const writeFold = (f: Fold) => JSON.stringify(f);

export function toggleFold(f: Fold, t: { row: string } | { list: true } | { more: true }): Fold {
  if ('list' in t) return { ...f, list: !f.list };
  if ('more' in t) return { ...f, more: !f.more };
  const open = f.open.includes(t.row) ? f.open.filter((n) => n !== t.row) : [...f.open, t.row].slice(-OPEN_KEEP);
  return { ...f, open };
}

/** 창 높이 맞춤 — 목록 칸 높이(avail)에 줄(rowH)이 몇 개 들어가나. 넘치면 끝에 '+N개 더' 단추(moreH, 없으면 줄 한 칸) 자리를 뺀다. 아직 못 쟀으면(0) 다 */
export function fitRows(o: { avail: number; rowH: number; moreH?: number; n: number }): { shown: number; more: number } {
  if (!o.n) return { shown: 0, more: 0 };
  if (o.avail <= 0 || o.n * o.rowH <= o.avail) return { shown: o.n, more: 0 };
  const shown = Math.max(1, Math.floor((o.avail - (o.moreH ?? o.rowH)) / o.rowH));
  return { shown, more: o.n - shown };
}
