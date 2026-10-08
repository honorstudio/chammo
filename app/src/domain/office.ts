// 픽셀 사무실 — 세션을 책상에 앉힌다. 순수 TS(그리기는 ui/office). 시안: docs/design-drafts/pixel-office
// 방(아늑한 방): 가로 8칸. 맨 뒤(gy 1.1) 가운데 = 참모 반장 책상, 양옆 = 참모-2·3. 그 앞으로 하위 세션이 한 줄에 셋씩

import type { ActivityStatus } from './status';
import type { WorkAct } from './activity';

/** 사무실에서 하는 짓 — 작업 중(들썩) · 답 필요(말풍선) · 끝남(머그) · 대기(가만히) · 쉼(z) */
export type OfficeState = 'working' | 'asks' | 'done' | 'wait' | 'sleep';

export function officeState(s: ActivityStatus): OfficeState {
  switch (s) {
    case 'working': return 'working';
    case 'asks':
    case 'blocked':
    case 'login': return 'asks';
    case 'done': return 'done';
    case 'stale': return 'sleep';
    default: return 'wait';
  }
}

/** 하위 세션 캐릭터 후보 — 도감의 성숙기 28종 */
const ROSTER = ['fire', 'wave', 'leaf', 'star'].flatMap((f) => ['cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN'].map((s) => `${f}_${s}`));

const hash = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);

/** 프로젝트마다 늘 같은 종 */
export const speciesFor = (project: string) => ROSTER[hash(project) % ROSTER.length]!;
/** 몸통 색 번호 — 스킨 팔레트에서 고른다 */
export const colorFor = (key: string) => hash(key + '#c');

/** act = 작업 중일 때 도구로 정한 행동, doing = 머리 위 한 줄('Edit ambassador.ts'), human = 세션 브라우저가 사람을 부른 이유(browser_ask_human) */
export type Seat = { id: string; label: string; project: string; status: ActivityStatus; startedAt: number; act?: WorkAct; doing?: string; human?: string };
/** empty = 세션이 나간 자리(빈 책상) — 다른 세션이 밀려 앉지 않게 남겨 둔다 */
export type Desk = { id: string; label: string; gx: number; gy: number; w: number; boss?: boolean; empty?: boolean; spr: string; st: OfficeState; color: number; act?: WorkAct; doing?: string;
  /** 원래 상태 — 말(statusWord)은 이걸로, 짓(st)은 물어봄·확인창을 하나로 */ status?: ActivityStatus; human?: string };
/** pushed = 놓아 둔 칸을 새 책상이 덮어서 휴게실로 비켜 있음(자리가 비면 돌아간다) */
export type Placed = { id: string; gx: number; gy: number; pushed?: boolean };
/** furniture = 휴게실에 놓인 가구(withLounge) */
export type Room = { cols: number; rows: number; desks: Desk[]; furniture?: Placed[] };

const COLS = 8;
const BACK_Y = 1.1;
const FRONT_X = [0.5, 3.2, 5.9];
const ROW0 = 3.2;
const ROW_GAP = 2.1;

/**
 * orchestrators = 참모들(처음이 반장), workers = 하위 세션. boss = 반장 자리 캐릭터(지금 키우는 다마고치).
 * 옆자리는 둘까지, 그 뒤 참모는 하위 세션 줄에 섞는다. slots = 앞줄 자리표(seatSlots) — 주면 그 자리에, null 은 빈 책상
 */
export function planRoom(orchestrators: Seat[], workers: Seat[], boss: string, slots?: (string | null)[]): Room {
  const desks: Desk[] = [];
  const mk = (s: Seat, gx: number, gy: number, spr: string, w = 1.6, isBoss = false): Desk => ({
    id: s.id, label: s.label, gx, gy, w, spr, st: officeState(s.status), status: s.status, color: colorFor(s.project + s.label), ...(isBoss ? { boss: true } : {}),
    ...(s.act ? { act: s.act } : {}), ...(s.doing ? { doing: s.doing } : {}), ...(s.human !== undefined ? { human: s.human } : {}),
  });
  const [head, ...rest] = orchestrators;
  if (head) desks.push(mk(head, 2.8, BACK_Y, boss, 2.4, true));
  rest.slice(0, 2).forEach((s, i) => desks.push(mk(s, i === 0 ? 0.6 : 5.6, BACK_Y, speciesFor(s.label))));
  const pool = [...rest.slice(2), ...[...workers].sort((a, b) => a.project.localeCompare(b.project) || a.startedAt - b.startedAt)];
  const byId = new Map(pool.map((s) => [s.id, s]));
  const front: (Seat | null)[] = slots ? slots.map((id) => (id ? byId.get(id) ?? null : null)) : pool;
  if (slots) for (const s of pool) if (!slots.includes(s.id)) front.push(s); // 자리표에 아직 없는 세션(방금 뜸)
  const EMPTY: Seat = { id: '', label: '', project: '', status: 'idle', startedAt: 0 };
  const r1 = (x: number) => Math.round(x * 10) / 10; // 3.2 + 2.1 = 5.300…01 방지
  front.forEach((s, i) => {
    const d = mk(s ?? EMPTY, FRONT_X[i % 3]!, r1(ROW0 + ROW_GAP * Math.floor(i / 3)), s ? speciesFor(s.project) : '');
    desks.push(s ? d : { ...d, empty: true });
  });
  const lines = Math.max(2, Math.ceil(front.length / 3));
  return { cols: COLS, rows: Math.ceil(ROW0 + ROW_GAP * (lines - 1) + 1.8), desks };
}

/** 현황판 순서 — 사람 필요 → 지금 탭 참모가 시킨 것(dim 아님) → 나머지. 같은 칸 안에선 원래 순서 */
export function dockOrder<D extends { id: string; human?: string }>(desks: D[], dim?: (id: string) => boolean): D[] {
  const rank = (d: D) => (d.human !== undefined ? 0 : dim?.(d.id) ? 2 : 1);
  return desks.map((d, i) => [d, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([d]) => d);
}

/** 반장이 서류 들고 걷는 중 — at = 지금 칸 좌표, awayId = 비어 있는 반장 책상 */
export type Delivery = { spr: string; at: [number, number]; flip: boolean; awayId: string; /** 돌아오는 길(서류 없음) */ back?: boolean };

const WALK_MS = 4000;
const HOLD_MS = 1200; // 도착해서 잠깐 서 있다가 같은 길로 걸어서 돌아온다
const AISLE_Y = 2.7; // 뒷줄과 앞줄 사이 통로
const GAPS_X = [0.2, 2.65, 5.35, 7.75]; // 앞줄 책상 사이 세로 통로

type Pt = [number, number];
function along(path: Pt[], f: number): { at: Pt; dir: Pt } {
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  let left = f * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    if (left <= seg[i]! || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, left / seg[i]!) : 1;
      return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dir: [b[0] - a[0], b[1] - a[1]] };
    }
    left -= seg[i]!;
  }
  return { at: path[path.length - 1]!, dir: [0, 0] };
}

/**
 * 가장 최근에 보낸 일(send)이 몇 초 안이면 반장이 그 책상 앞까지 걷는다. 길: 반장 책상 앞 → 가운데 통로 →
 * 대상에 가까운 세로 통로 → 대상 책상 앞 통로 → 대상 앞. resolve = 작업 기록의 대상(이름·id) → 책상 id
 */
export function delivery(events: { ts: string; type: string; task?: string; target?: string }[], room: Room, resolve: (target: string) => string | undefined, now: number): Delivery | null {
  const boss = room.desks.find((d) => d.boss);
  if (!boss) return null;
  // 보낸 일(send) = 반장이 서류 들고 감, 회신(reply) = 그 책상 캐릭터가 서류 들고 반장에게 옴
  const last = [...events].reverse().find((e) => e.type === 'send' || e.type === 'reply');
  const target = last?.target ?? events.find((e) => e.type === 'send' && e.task === last?.task)?.target;
  if (!last || !target) return null;
  const age = now - Date.parse(last.ts);
  if (!(age >= 0 && age <= WALK_MS * 2 + HOLD_MS)) return null;
  const id = resolve(target);
  const to = room.desks.find((d) => d.id === id && !d.boss && !d.empty);
  if (!to) return null;
  const reply = last.type === 'reply';
  const bx = boss.gx + boss.w / 2, tx = to.gx + to.w / 2, ty = to.gy + 1.45;
  const gap = GAPS_X.reduce((a, b) => (Math.abs(b - tx) < Math.abs(a - tx) ? b : a));
  const path: Pt[] = to.gy === boss.gy
    ? [[bx, boss.gy + 1.45], [tx, ty]]
    : [[bx, boss.gy + 1.45], [bx, AISLE_Y], [gap, AISLE_Y], [gap, ty], [tx, ty]];
  const go = reply ? [...path].reverse() : path;
  const back = age > WALK_MS + HOLD_MS;
  const { at, dir } = back ? along([...go].reverse(), (age - WALK_MS - HOLD_MS) / WALK_MS) : along(go, Math.min(1, age / WALK_MS));
  const who = reply ? to : boss;
  return { spr: who.spr, at, flip: dir[0] - dir[1] < 0, awayId: who.id, back };
}

/**
 * 작업 기록은 3초마다 읽혀서 기록 시각(ts)으로 걸으면 늦게 본 만큼 반쯤 걸어간 데서 시작한다.
 * 앱이 처음 본 시각으로 바꿔 준다. seen 은 부르는 쪽이 들고 있는 기억 — 처음 부를 땐 옛 기록을 그대로 둔다
 */
export function stampSeen<E extends { ts: string; type: string; task: string }>(events: E[], seen: Map<string, number>, now: number): E[] {
  const primed = seen.has('');
  seen.set('', 0);
  return events.map((e) => {
    if (e.type !== 'send') return e;
    if (!seen.has(e.task)) seen.set(e.task, primed ? now : Date.parse(e.ts));
    const at = seen.get(e.task)!;
    return at === Date.parse(e.ts) ? e : { ...e, ts: new Date(at).toISOString() };
  });
}

/**
 * 앞줄 자리표. 한 번 앉은 세션은 그 자리 그대로 — 새 세션은 첫 빈 자리, 없으면 끝에. 나간 자리는 null(빈 책상),
 * 끝쪽 null 은 줄인다. 이름순으로 매번 다시 세우면 새 세션 하나에 모두 한 칸씩 밀렸다(2026-09-27 사용자)
 */
export function seatSlots(prev: (string | null)[], ids: string[]): (string | null)[] {
  const live = new Set(ids);
  const out = prev.map((id) => (id && live.has(id) ? id : null));
  for (const id of ids) {
    if (out.includes(id)) continue;
    const hole = out.indexOf(null);
    if (hole >= 0) out[hole] = id; else out.push(id);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/** 반장(참모)의 반응 — 머지 만세 > 물어봄(폴짝 !) > 음성으로 읽는 중(입 뻐끔) > 첫마디 말풍선 > 생각 중(…) */
export type BossMode = 'think' | 'say' | 'talk' | 'ask' | 'cheer';
export type BossReact = { mode: BossMode; text?: string };
const SAY_MS = 5000;
const CHEER_MS = 2500;
const SAY_MAX = 18;

export function firstWords(text: string): string {
  const first = (text.split(/(?<=[.?!。])\s|\n/)[0] ?? '').replace(/[.。]$/, '').trim();
  return first.length > SAY_MAX ? first.slice(0, SAY_MAX) + '…' : first;
}

export function bossReaction(x: { status: ActivityStatus; reply: { text: string; ts: number } | null; voice: boolean; cheerAt: number | null; now: number }): BossReact | null {
  if (x.cheerAt != null && x.now - x.cheerAt >= 0 && x.now - x.cheerAt < CHEER_MS) return { mode: 'cheer' };
  if (x.status === 'asks' || x.status === 'blocked' || x.status === 'login') return { mode: 'ask' };
  if (x.reply) {
    const age = x.now - x.reply.ts;
    const talkMs = Math.min(12_000, x.reply.text.length * 110 + 800); // 참모세이가 읽는 시간 어림
    if (x.voice && age >= 0 && age < talkMs) return { mode: 'talk', text: firstWords(x.reply.text) };
    if (age >= 0 && age < SAY_MS) return { mode: 'say', text: firstWords(x.reply.text) };
  }
  if (x.status === 'working') return { mode: 'think' };
  return null;
}

/** 가구가 생기면 방 오른쪽에 휴게실 두 칸 — 가구를 두 줄로 놓는다. 끌어다 놓기(가구 놓기) 전까지의 자동 자리 */
export function withLounge(room: Room, ids: string[], placed: Record<string, [number, number] | null> = {}): Room & { furniture: Placed[] } {
  if (!ids.length) return { ...room, furniture: [] };
  let auto = 0;
  const furniture: Placed[] = [];
  for (const id of ids) {
    const p = placed[id];
    if (p === null) continue; // 창고
    const covered = p && room.desks.some((d) => p[0] < d.gx + d.w && p[0] + 1 > d.gx && p[1] < d.gy + 1.2 && p[1] + 1 > d.gy);
    if (p && !covered) { furniture.push({ id, gx: p[0], gy: p[1] }); continue; }
    furniture.push({ id, gx: room.cols + 0.2 + (auto % 2), gy: Math.round((0.5 + Math.floor(auto / 2) * 1.6) * 10) / 10, ...(covered ? { pushed: true } : {}) });
    auto++;
  }
  // 방 크기는 놓은 자리와 무관하게 — 가진 가구가 다 휴게실에 있을 때의 깊이로 정한다.
  // 놓은 가구에 +1.2 를 주면 맨 아래 줄에 놓을 때마다 방이 한 줄씩 커지고 배율이 뚝 떨어졌다(사용자 2026-09-27)
  const lounge = Math.ceil(0.5 + Math.floor((ids.length - 1) / 2) * 1.6 + 1.2);
  const deepest = Math.max(0, ...furniture.filter((f) => !placed[f.id] || f.pushed).map((f) => Math.ceil(f.gy + 1.2)), ...furniture.filter((f) => placed[f.id] && !f.pushed).map((f) => f.gy + 1));
  return { ...room, cols: room.cols + 2, rows: Math.max(room.rows, lounge, deepest), furniture };
}

const HALF_W = 12; // 타일 2:1 — ui/office/draw TW/2, TH/2
const HALF_H = 6;
/** 캔버스 점(논리 좌표) → 바닥 칸. (ox, oy) = 방 원점. 방 밖이면 null */
export function cellAt(room: Room, ox: number, oy: number, x: number, y: number): [number, number] | null {
  const a = (x - ox) / HALF_W, b = (y - oy) / HALF_H;
  const gx = Math.floor((a + b) / 2), gy = Math.floor((b - a) / 2);
  return gx >= 0 && gy >= 0 && gx < room.cols && gy < room.rows ? [gx, gy] : null;
}

/** 캔버스 점(논리 좌표) → 그 자리에 놓인 가구 id. 바닥 가운데부터 위로 34 까지(키 큰 가구 몸통)를 잡고, 겹치면 앞(gx+gy 큰 것) */
export function furnitureAt(room: Room, ox: number, oy: number, x: number, y: number): string | null {
  let best: Placed | null = null;
  for (const f of room.furniture ?? []) {
    const ax = ox + (f.gx - f.gy) * HALF_W, ay = oy + (f.gx + f.gy + 0.9) * HALF_H;
    if (Math.abs(x - ax) >= HALF_W - 2 || y > ay + 6 || y < ay - 34) continue; // 옆 칸(가로 12)과 안 겹치게 10 까지
    if (!best || f.gx + f.gy > best.gx + best.gy) best = f;
  }
  return best?.id ?? null;
}

/** 그 칸에 가구를 놓을 수 있나 — 방 안이고 책상·책장·정수기와 안 겹칠 때 */
export function canPlace(room: Room, [cx, cy]: [number, number]): boolean {
  if (cx < 0 || cy < 0 || cx >= room.cols || cy >= room.rows) return false;
  const hit = (x0: number, y0: number, x1: number, y1: number) => cx < x1 && cx + 1 > x0 && cy < y1 && cy + 1 > y0;
  if (room.desks.some((d) => hit(d.gx, d.gy, d.gx + d.w, d.gy + 1.2))) return false;
  if (hit(4.9, 0, 7.3, 0.45)) return false; // 책장
  return true;
}

const COFFEE_EVERY = 60_000;
/** 커피 액션: 1분마다 반장이 정수기(오른쪽 벽)까지 걸어갔다 온다. 반장 반응·배달이 없을 때만 부른다 */
export function coffeeWalk(room: Room, now: number): Delivery | null {
  const boss = room.desks.find((d) => d.boss);
  if (!boss) return null;
  const age = now % COFFEE_EVERY;
  if (age > WALK_MS * 2 + HOLD_MS) return null;
  const bx = boss.gx + boss.w / 2, cx = room.cols - 0.4;
  const path: Pt[] = [[bx, boss.gy + 1.45], [bx, AISLE_Y], [cx, AISLE_Y], [cx, 2.3]];
  const back = age > WALK_MS + HOLD_MS;
  const { at, dir } = back ? along([...path].reverse(), (age - WALK_MS - HOLD_MS) / WALK_MS) : along(path, Math.min(1, age / WALK_MS));
  // back = 서류 없이 걷기. 갈 땐 빈손, 돌아올 땐 컵(흰 네모)을 든다
  return { spr: boss.spr, at, flip: dir[0] - dir[1] < 0, awayId: boss.id, back: !back };
}

/** 사무실 고양이: 가운데 통로 → 오른쪽 세로 통로 → 맨 앞 통로 → 왼쪽 세로 통로를 30초에 한 바퀴 */
export function catWalk(room: Room, now: number): { at: [number, number]; flip: boolean } {
  const front = room.desks.filter((d) => !d.boss && d.gy > BACK_Y);
  const lastY = front.length ? Math.max(...front.map((d) => d.gy)) + 1.45 : ROW0 + 1.45;
  const right = Math.min(7.75, room.cols - 0.25);
  const path: Pt[] = [[0.2, AISLE_Y], [right, AISLE_Y], [right, lastY], [0.2, lastY], [0.2, AISLE_Y]];
  const { at, dir } = along(path, (now % 30_000) / 30_000);
  return { at, flip: dir[0] - dir[1] < 0 };
}
