// 참모 홈 진행 칸 — 참모마다 맡은 일 전체가 어디까지 왔나(시안 docs/design-drafts/progress-bar, 사용자 10-23 확정).
// 참모·세션은 아무것도 따로 보고하지 않는다: 작업 기록(tasks.jsonl) + 세션 상태 + 세션 할 일 목록 비율만으로 계산(토큰 0).
// 막대 = 목표 조각들(`scripts/task send --goal "<목표>[:예정 수]"`), 칸 하나 = send 한 건. 이름표 없는 일은 프로젝트(없으면 세션 대상)마다 한 조각 —
// 줄 이름이 그 프로젝트다(처음 쓰는 사람의 참모는 --goal 을 잘 안 써서 다 '기타' 한 줄이었다, 2026-10-24).
// 끝난 조각은 결과 한 줄과 함께 잠깐 남고, 한 번 보면·참모당 최근 3개를 넘으면·하루 지나면 빠진다(사용자 10-23)
// 예정 칸을 못 채운 목표는 보낸 일이 다 끝나고 2시간 새 일이 없으면 끝, 참모가 `task goal-done`·`goal-total` 로 닫거나 고친다(사용자 10-23 폰)
// 참모끼리 넘긴 일(`task handover`) — 넘긴 쪽엔 큰 일 한 칸이 받은 쪽 쪼갠 일들(`send --from-handover`)의 진행을 따라가고,
// 받은 쪽 목표 줄엔 누가 넘겼는지(넘긴 쪽 칸엔 큰 일, 받은 쪽 칸엔 쪼갠 일)
import { tr } from '../i18n';
import { findTarget } from './inbox';
import { splitOrchName } from './orchLabel';
import { seenName, type Session } from './session';
import type { TaskEvent } from './tasks';

const H = 3600_000;
/** 이보다 오래 기척 없으면 '오래 조용' — send→done 90% 가 182분(2026-10-23 사용자 기록 7일) */
export const QUIET_MS = 3 * H;
/** 이보다 오래된 send 는 안 센다 */
const WINDOW_MS = 7 * 24 * H;
/** 끝난 조각을 남겨 두는 최대 시간·개수 */
const DONE_KEEP_MS = 24 * H;
const DONE_KEEP_N = 3;
/** 목표 일이 다 끝나고 이만큼 그 목표로 새 send 가 없으면 남은 예정 칸은 버린 것 — 목표가 끝난다 */
export const GOAL_IDLE_MS = 2 * H;
/** 이름표 없는 안 끝난 일이 이만큼 기척 없으면 진행 칸에서 접는다(작업 패널엔 남는다) */
export const ETC_FOLD_MS = 24 * H;

/** done 끝 · auto 앱이 닫음(회신·결정 답 + 세션 꺼짐/끝냄, PR 머지, 참모가 목표를 닫음) · ask 사용자 답 기다림 · wait 밖을 기다림(`task wait`) · run 일하는 중 · quiet 오래 조용 · stop 답 없이 꺼짐 · rest 쉬는 중 · todo 아직 안 보냄 */
export type CellState = 'done' | 'auto' | 'ask' | 'wait' | 'run' | 'quiet' | 'stop' | 'rest' | 'todo';

/** 참모가 건 기다림 — why 사유, until 이때까지(없으면 끝없이), on user = 사용자가 줄 것 · outside = 심사·예약 날짜처럼 밖 */
export type Wait = { why: string; until?: number; on: 'user' | 'outside' };

/** 칸 하나를 정하는 데 쓰는 기록 사실 */
export type CellFacts = { finished: boolean; replied: boolean; asks: number; answers: number; lastAt: number; notes: string[]; wait?: Wait };

export const isEnded = (s: CellState) => s === 'done' || s === 'auto';

const prsIn = (t: string) => [...t.matchAll(/#(\d{2,})/g)].map((m) => m[1]!);

/** 칸 상태 — 위에서 먼저 맞는 것(README 계산 규칙). merged = 머지된 PR 번호 */
export function cellState(f: CellFacts, s: Session | undefined, now: number, merged?: Set<string>): CellState {
  if (f.finished) return 'done';
  if (f.asks > f.answers) return 'ask';
  if ((f.replied || f.answers > 0) && (!s || s.finished)) return 'auto';
  if (f.replied && merged?.size && f.notes.some((n) => prsIn(n).some((p) => merged.has(p)))) return 'auto';
  if (f.wait && (f.wait.until === undefined || now < f.wait.until)) return 'wait';
  if (s?.state === 'working') return 'run';
  // 기다리기로 한 날짜가 지났는데 기척이 없으면 그때부터 조용을 센다
  if (now - Math.max(f.lastAt, f.wait?.until ?? 0) > QUIET_MS) return 'quiet';
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

/** 넘긴 큰 일 칸 — 받은 참모(별명)와 그쪽이 쪼갠 일들(읽기만). total 은 예정 칸까지, todo 는 아직 안 보낸 칸 */
export type Hand = { to: string; done: number; total: number; todo: number; jobs: Cell[] };

export type Cell = {
  task: string; title: string; target: string; state: CellState;
  /** 다른 참모에게 넘긴 큰 일 칸이면 */
  hand?: Hand;
  /** 마지막 기척(send·reply·ask…) */
  at?: number;
  /** 기다림 사유 — state 가 wait 이거나(ask 로 덮여도) 지금 걸린 기다림 */
  wait?: Wait;
  /** 일하는 중 칸 채움 0~1(세션 할 일 목록 끝난 비율) */
  fill?: number;
  /** 기다리기로 한 날짜(until)가 지났는데 그 뒤로 기척이 없으면 그 날짜 — 오래 멈춘 목표 알림(domain/goalStall) */
  overdue?: number;
  /** 끝난 이름표 없는 칸 — 사라짐 열쇠(봤음 기록) */
  unit?: string;
  endedAt?: number;
};
export type Goal = {
  key: string; name: string; project?: string; cells: Cell[];
  /** 이름표 없는 일 줄 — 그 프로젝트(없으면 세션 대상) 이름 */
  label?: string;
  /** 끝 칸(끝 + 앱이 닫음) / 전체 칸(예정 칸 수가 더 크면 그것) */
  done: number; total: number;
  finished: boolean;
  /** 안 끝난 보낸 칸이 다 기다림이면(안 보낸 예정 칸은 안 센다) — 줄 오른쪽에 '기다림' */
  waiting: boolean;
  /** 칸들 마지막 기척 */
  lastAt: number;
  /** 끝난 목표의 결과 한 줄·사라짐 열쇠 */
  result?: string; unit?: string; endedAt?: number;
  /** 넘겨받은 일이면 넘긴 참모(별명)와 넘김 번호들 */
  handedBy?: string; hands?: string[];
};
export type GoalBar = { goals: Goal[]; done: number; total: number; byProject: boolean };

/** 이 참모가 쓴 기록인가 — from, 되살아나 id 가 바뀌었으면 기본 이름(fromName) */
const byOrch = (orch: { id: string; name: string }) => {
  const base = splitOrchName(orch.name).base;
  return (e: TaskEvent) => e.from === orch.id || (!!e.fromName && e.fromName === base);
};

/** 이 참모 일인가 — send 의 from(또는 사용자가 붙인 own) */
function mine(events: TaskEvent[], orch: { id: string; name: string }) {
  const by = byOrch(orch);
  const own = new Map<string, TaskEvent>();
  for (const e of events) if (e.type === 'send' || e.type === 'handover' || (e.type === 'own' && e.from)) own.set(e.task, e);
  return (task: string) => {
    const e = own.get(task);
    if (!e) return false;
    if (e.type === 'own') return e.from === orch.id;
    return by(e);
  };
}

const tsOf = (e: TaskEvent) => Date.parse(e.ts);

/** 참모를 화면에 부르는 말 — 별명 있는 이름 먼저(기록의 전체 이름 → 지금 그 번호의 세션), 없으면 번호 뺀 기본 이름(seenName) */
const orchLabel = (sessions: Session[], base?: string, full?: string) => {
  const live = base ? sessions.find((s) => splitOrchName(s.name).base === base)?.name : undefined;
  const n = [full, live].find((x) => x && splitOrchName(x).nick) ?? full ?? live ?? base;
  return n ? seenName(n) : '';
};

type Opts = {
  events: TaskEvent[]; sessions: Session[]; orch: { id: string; name: string }; now: number;
  /** 봤음 기록(사라짐 열쇠) */
  seen: Set<string>;
  /** 세션 할 일 목록 끝난 비율 */
  fill?: (s: Session) => number | undefined;
  merged?: Set<string>;
};

/** 목표 조각 전부(끝난 것·봤음 거르기 전). nested = 받은 참모 쪽을 셀 때 — 넘김은 한 단계만(A→B→A 가 안 돈다) */
function collect(o: Opts, nested: boolean) {
  const { events, sessions, now } = o;
  const isMine = mine(events, o.orch);
  const by = byOrch(o.orch);
  // 참모가 목표에 남긴 goal-done·goal-total — 목표 이름마다 시간순
  const marks = new Map<string, TaskEvent[]>();
  for (const e of events) {
    if ((e.type !== 'goal-done' && e.type !== 'goal-total') || !e.goal || !by(e) || now - tsOf(e) > WINDOW_MS) continue;
    marks.set(e.goal, [...(marks.get(e.goal) ?? []), e]);
  }
  type Acc = { send: TaskEvent; f: CellFacts; endNote?: string; endAt?: number };
  const acc = new Map<string, Acc>();
  const handovers = new Map<string, TaskEvent>();
  for (const e of events) {
    if (e.type === 'handover') handovers.set(e.task, e);
    if (e.type === 'send' || (e.type === 'handover' && !nested)) {
      if (now - Date.parse(e.ts) > WINDOW_MS) continue;
      // 같은 세션에 새 일이 가면 앞 기다림은 풀린다 — 날짜(until)가 아직 안 온 기다림은 그 날짜가 끝을 정하니 남는다(같은 세션에 예약이 둘일 수 있다)
      if (e.type === 'send') for (const o2 of acc.values()) if (o2.f.wait && o2.send.target === e.target && !(o2.f.wait.until && o2.f.wait.until > Date.parse(e.ts))) delete o2.f.wait;
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
    if (e.type === 'wait') a.f.wait = { why: e.note ?? '', on: e.on === 'user' ? 'user' : 'outside', ...(e.until && !Number.isNaN(Date.parse(e.until)) ? { until: Date.parse(e.until) } : {}) };
    else if (e.type === 'reply' || e.type === 'done' || e.type === 'answer' || e.retry) delete a.f.wait;
  }

  // 넘긴 큰 일 칸 — 받은 참모 쪽 목표 중 이 넘김에 붙은 것들을 센다. 프로젝트는 받은 쪽 첫 일의 것
  const recv = new Map<string, Goal[]>();
  function handCell(a: Acc, cell: Cell): string {
    const h = a.send;
    const first = events.find((e) => e.type === 'send' && e.handover === h.task);
    const who = { id: first?.from ?? h.toId ?? '', name: first?.fromName ?? h.toName ?? h.target ?? '' };
    const key = `${who.id}|${who.name}`;
    if (!recv.has(key)) recv.set(key, collect({ ...o, orch: who }, true).goals);
    const gs = recv.get(key)!.filter((g) => g.hands?.includes(h.task));
    const jobs = gs.flatMap((g) => g.cells);
    const done = gs.reduce((n, g) => n + g.done, 0);
    const total = gs.reduce((n, g) => n + g.total, 0);
    cell.hand = { to: orchLabel(sessions, h.toName, h.target), done, total, todo: total - jobs.length, jobs };
    const lastAt = Math.max(tsOf(h), ...gs.map((g) => g.lastAt), ...jobs.map((c) => c.endedAt ?? 0));
    cell.at = Math.max(lastAt, a.f.lastAt);
    delete cell.fill;
    if (a.f.finished) { cell.state = 'done'; return first?.project ?? ''; }
    if (total) cell.fill = done / total;
    const heir = findTarget(sessions, h.target) ?? sessions.find((x) => splitOrchName(x.name).base === h.toName);
    // 받은 쪽 일이 다 끝나고 2시간 조용하면 앱이 닫는다(목표 닫힘과 같은 규칙)
    if (gs.length && gs.every((g) => g.done === g.total) && now - lastAt > GOAL_IDLE_MS) {
      cell.state = 'auto';
      cell.endedAt = lastAt;
      a.endNote = gs.map((g) => g.result).filter(Boolean).pop();
      delete cell.fill;
    } else if (jobs.some((c) => c.state === 'ask')) cell.state = 'ask';
    else if (jobs.some((c) => c.state === 'run') || (!gs.length && heir?.state === 'working')) cell.state = 'run';
    else cell.state = now - lastAt > QUIET_MS ? 'quiet' : 'rest';
    return first?.project ?? '';
  }

  const rows = [...acc.values()].filter((a) => isMine(a.send.task)).map((a) => {
    const s = findTarget(sessions, a.send.target);
    const state = cellState(a.f, s, now, o.merged);
    const fill = state === 'run' && s && o.fill ? o.fill(s) : undefined;
    const w = a.f.wait;
    const live = w && (w.until === undefined || now < w.until) ? w : undefined; // until 이 지난 기다림은 칸에 안 단다
    const at = w?.until && !live ? Math.max(a.f.lastAt, w.until) : a.f.lastAt;
    const overdue = w?.until && !live && a.f.lastAt <= w.until ? w.until : undefined;
    const cell: Cell = { task: a.send.task, title: a.send.title ?? '', target: a.send.target ?? '', state, at, ...(live ? { wait: live } : {}), ...(overdue ? { overdue } : {}), ...(fill !== undefined ? { fill } : {}) };
    const project = a.send.type === 'handover' ? handCell(a, cell) : a.send.project ?? s?.project ?? '';
    if (isEnded(cell.state)) cell.endedAt ??= a.endAt ?? a.f.lastAt;
    return { a, cell, project };
  });
  const byProject = new Set(rows.map((r) => r.project).filter(Boolean)).size >= 2;

  // 목표마다 모으기 — 보낸 순
  const groups = new Map<string, { name: string; label: string; project: string; first: number; rows: typeof rows }>();
  for (const r of rows.sort((x, y) => Date.parse(x.a.send.ts) - Date.parse(y.a.send.ts))) {
    // 목표는 프로젝트를 걸쳐도 한 조각(첫 일의 프로젝트 밑), 이름표 없는 일은 프로젝트(없으면 세션 대상)마다
    const name = r.a.send.goal ?? (r.a.send.type === 'handover' ? r.a.send.title ?? '' : '');
    const label = name ? '' : r.project || seenName(r.cell.target);
    const key = name ? `g|${name}` : `e|${label}`;
    const g = groups.get(key) ?? { name, label, project: byProject ? r.project : '', first: Date.parse(r.a.send.ts), rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }

  const goals: Goal[] = [];
  for (const [key, g] of groups) {
    const ms = g.name ? marks.get(g.name) ?? [] : [];
    // 예정 수 — send 의 :N 은 가장 큰 값(몇 번째로 잘못 써도), goal-total 은 그때 값으로 바꾼다
    let planned = 0;
    for (const x of [...g.rows.map((r) => r.a.send), ...ms.filter((m) => m.type === 'goal-total')].sort((x, y) => tsOf(x) - tsOf(y))) {
      planned = x.type === 'goal-total' ? x.goalTotal ?? 0 : Math.max(planned, x.goalTotal ?? 0);
    }
    // goal-done 앞에 보낸 안 끝난 칸은 참모가 닫은 칸
    const closedAt = Math.max(0, ...ms.filter((m) => m.type === 'goal-done').map(tsOf));
    for (const r of g.rows) {
      if (closedAt && !isEnded(r.cell.state) && tsOf(r.a.send) <= closedAt) {
        r.cell.state = 'auto';
        r.cell.endedAt = closedAt;
        delete r.cell.fill;
      }
    }
    const cells = g.rows.map((r) => r.cell);
    const ended = cells.filter((c) => isEnded(c.state));
    const lastSend = Math.max(...g.rows.map((r) => tsOf(r.a.send)));
    const lastEnd = Math.max(0, ...ended.map((c) => c.endedAt ?? 0));
    // 보낸 일이 다 끝났고 닫혔거나 2시간 새 일이 없으면 남은 예정 칸은 버린 것
    const dropTodo = ended.length === cells.length && (closedAt >= lastSend || now - Math.max(lastSend, lastEnd) > GOAL_IDLE_MS);
    const total = dropTodo ? cells.length : Math.max(cells.length, planned);
    const open = cells.filter((c) => !isEnded(c.state));
    const goal: Goal = { key, name: g.name, ...(g.label ? { label: g.label } : {}), ...(byProject ? { project: g.project } : {}), cells, done: ended.length, total, finished: false, waiting: open.length > 0 && open.every((c) => c.state === 'wait'), lastAt: Math.max(...cells.map((c) => c.at ?? 0)) };
    const hands = [...new Set(g.rows.map((r) => r.a.send.handover).filter((x): x is string => !!x))];
    if (hands.length) {
      goal.hands = hands;
      const by = hands.map((x) => handovers.get(x)).find(Boolean);
      if (by) goal.handedBy = orchLabel(sessions, by.fromName);
    }
    if (g.name && ended.length === total) {
      const last = g.rows.filter((r) => isEnded(r.cell.state) && r.a.endNote).sort((x, y) => (x.cell.endedAt ?? 0) - (y.cell.endedAt ?? 0)).pop();
      goal.finished = true;
      goal.endedAt = lastEnd;
      goal.result = prResult(last?.a.endNote);
      goal.unit = `${key}|${goal.endedAt}`;
    }
    if (!g.name) for (const c of cells) if (isEnded(c.state)) c.unit = `t|${c.task}`;
    goals.push(goal);
  }
  return { goals, byProject, first: new Map([...groups].map(([k, g]) => [k, g.first])) };
}

export function goalBar(o: Opts): GoalBar {
  const { goals, byProject, first: firstAt } = collect(o, false);
  const { now } = o;

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
    // 안 끝난 기타 칸도 하루 넘게 기척이 없으면 접는다 — 버려진 일이 '오래 조용'으로 며칠 남았다
    const cells = g.cells.filter((c) => (c.unit ? keep.has(c.unit) : c.state === 'wait' || now - (c.at ?? 0) <= ETC_FOLD_MS));
    if (!cells.length) return [];
    const done = cells.filter((c) => isEnded(c.state)).length;
    return [{ ...g, cells, done, total: cells.length, waiting: cells.some((c) => !isEnded(c.state)) && cells.filter((c) => !isEnded(c.state)).every((c) => c.state === 'wait'), lastAt: Math.max(...cells.map((c) => c.at ?? 0)) }];
  });

  // 이름표 있는 목표 먼저(보낸 순) · 기타는 끝, 프로젝트로 묶으면 프로젝트 이름순
  const first = (g: Goal) => firstAt.get(g.key)!;
  shown.sort((a, b) => (a.project ?? '').localeCompare(b.project ?? '') || Number(!a.name) - Number(!b.name) || first(a) - first(b));
  for (const g of shown) {
    const todo = g.total - g.cells.length;
    if (todo > 0) g.cells = [...g.cells, ...Array.from({ length: todo }, (_, i): Cell => ({ task: `${g.key}#todo${i}`, title: '', target: '', state: 'todo' }))];
  }
  return { goals: shown, done: shown.reduce((n, g) => n + g.done, 0), total: shown.reduce((n, g) => n + g.total, 0), byProject };
}

/** 진행 칸 줄마다 머리줄·이름 — 프로젝트 머리줄은 묶을 때(byProject) 그 프로젝트에 목표가 있을 때만(목표 없는 일만 있으면 줄 이름이 곧 프로젝트).
 *  머리줄 밑 이름표 없는 줄은 머리줄과 같은 이름이 되니 '그 밖의 일' */
export function goalRows(bar: GoalBar): { goal: Goal; head?: string; name: string }[] {
  const named = new Set(bar.goals.filter((g) => g.name).map((g) => g.project ?? ''));
  let last: string | undefined;
  return bar.goals.map((goal) => {
    const p = goal.project ?? '';
    const under = bar.byProject && named.has(p);
    const head = under && p !== last ? p || tr('프로젝트 밖', 'No project') : undefined;
    last = p;
    const name = goal.name || (under ? tr('그 밖의 일', 'Other work') : goal.label || tr('기타', 'Other'));
    return { goal, ...(head !== undefined ? { head } : {}), name };
  });
}
