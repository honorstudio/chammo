// 픽셀 사무실 — 세션을 책상에 앉힌다. 순수 TS(그리기는 ui/office). 시안: docs/design-drafts/pixel-office
// 방 한 칸은 planOffice — 모양·규칙은 domain/officeRoom, 맨 뒤(gy 1.1) 가운데 = 반장 책상, 양옆 = 다음 참모, 그 앞이 직원 자리

import type { ActivityStatus } from './status';
import type { WorkAct } from './activity';
import { ART_ITEMS } from './catalog/art.gen';
import type { OrchSeat } from './gacha';
import { LEVELS, roomDims, seatsOf, type FloorItem, type OfficeRoom, type WallItem } from './officeRoom';

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

/** 하위 세션 캐릭터 후보 — 도감의 성숙기 28종 + 새 캐릭터(전설 빼고). 가졌는지와 상관없다(사용자 11-06 '지금처럼 랜덤') */
const ROSTER = [
  ...['fire', 'wave', 'leaf', 'star'].flatMap((f) => ['cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN'].map((s) => `${f}_${s}`)),
  ...ART_ITEMS.filter((c) => c.kind === 'chr' && c.rarity !== '전설').map((c) => c.id.slice(4)),
];

const hash = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);

/** 프로젝트마다 늘 같은 종 */
export const speciesFor = (project: string) => ROSTER[hash(project) % ROSTER.length]!;
/** 몸통 색 번호 — 스킨 팔레트에서 고른다 */
export const colorFor = (key: string) => hash(key + '#c');

/** act = 작업 중일 때 도구로 정한 행동, doing = 머리 위 한 줄('Edit ambassador.ts'), human = 세션 브라우저가 사람을 부른 이유(browser_ask_human) */
export type Seat = { id: string; label: string; project: string; status: ActivityStatus; startedAt: number; act?: WorkAct; doing?: string; human?: string };
/** empty = 세션이 나간 자리(빈 책상) — 다른 세션이 밀려 앉지 않게 남겨 둔다. off = 꺼진 참모 자리(이름표는 남는다). stand = 자리가 없어 문 앞에 선 직원(책상 없음).
 *  tuck = 문 앞도 꽉 차 방엔 안 그리는 직원(현황판엔 남는다), more = 이 사람 이름표에 접힌 사람 수 */
export type Desk = { id: string; label: string; gx: number; gy: number; w: number; boss?: boolean; empty?: boolean; off?: boolean; stand?: boolean; tuck?: boolean; more?: number; spr: string; st: OfficeState; color: number; act?: WorkAct; doing?: string;
  /** 원래 상태 — 말(statusWord)은 이걸로, 짓(st)은 물어봄·확인창을 하나로 */ status?: ActivityStatus; human?: string };
export type Placed = { id: string; gx: number; gy: number };
/** furniture = 놓인 가구. door·floor·wall·zone·short·used 는 사무실 v2(planOffice) — short = 자리가 없어 선 직원 수, used = 직원 자리를 쓰는 사람 수(선 사람 포함, 뒷줄 제자리 참모는 빼고) */
export type Room = { cols: number; rows: number; desks: Desk[]; furniture?: Placed[]; door?: boolean; floor?: FloorItem[]; wall?: WallItem[]; zone?: [number, number]; lv?: number; short?: number; used?: number };

const BACK_Y = 1.1;
const ROW0 = 3.2;
/** 뒷줄 책상 자리(반장·옆자리 둘) */
const BACK_SEATS: [number, number][] = [[2.8, 2.4], [0.6, 1.6], [5.6, 1.6]];

/** 참모 — name 은 gacha.json 의 chars·orchSeats 칸. spr = 고른 캐릭터(없으면 이름으로 랜덤), off = 지금 꺼짐(출근 전) */
export type OrchIn = Seat & { name: string; spr?: string; off?: boolean };
const BACK_W = 1.6, BOSS_W = 2.4;
const STAND_X = 0.5;
/** 문 앞에 서는 건 둘까지, 한 칸 간격 — 더 세우면 0.8칸마다 겹겹이 쌓여 누가 누군지 안 보였다(11-09 사용자). 나머지는 마지막 사람 이름표에 +N */
const STAND_MAX = 2, STAND_GAP = 1;

/**
 * 자리를 안 정한 참모의 기본 자리 — 첫 사무실 뒷줄. 반장(첫째)은 가운데 큰 책상, 나머지는 옆자리 둘, 다 찼으면 없음(직원 자리에 앉는다).
 * 이미 누가 정해 앉은 자리는 건너뛴다
 */
export function defaultSeats(orchs: { name: string; off?: boolean }[], seats: Record<string, OrchSeat> = {}): Map<string, { x: number; y: number; w: number }> {
  const out = new Map<string, { x: number; y: number; w: number }>();
  const taken = Object.values(seats).filter((s) => s.office === 0).map((s) => s.x);
  const free = BACK_SEATS.slice(1).filter(([x]) => !taken.includes(x));
  orchs.forEach((o, i) => {
    if (seats[o.name]) return;
    if (i === 0 && !taken.includes(BACK_SEATS[0]![0])) { out.set(o.name, { x: BACK_SEATS[0]![0], y: BACK_Y, w: BOSS_W }); return; }
    const k = free.shift();
    if (k) out.set(o.name, { x: k[0], y: BACK_Y, w: BACK_W });
  });
  return out;
}
/** 켜졌는데 뒷줄 자리가 없어 직원 자리에 앉는 참모 — 자리표(seatSlots)에 같이 넣는다 */
export const poolOrchs = <O extends { name: string; off?: boolean }>(orchs: O[], seats: Record<string, OrchSeat> = {}): O[] => {
  const auto = defaultSeats(orchs, seats);
  return orchs.filter((o) => !seats[o.name] && !auto.has(o.name) && !o.off);
};

/**
 * 사무실 한 칸 → 그릴 재료(사용자 11-06 ⑤⑥). 참모 책상은 정한 자리에(안 정했으면 첫 사무실 뒷줄 차례로, 넷째부터 직원 자리),
 * 직원은 자리표대로 앉고 남으면 문 앞에 선다. 직원 자리는 비어 있어도 늘 책상이 있다
 */
export function planOffice(x: { room: OfficeRoom; index: number; orchs: OrchIn[]; workers: Seat[]; slots?: (string | null)[]; seats?: Record<string, OrchSeat> }): Room & { furniture: Placed[] } {
  const { room, index, orchs, seats = {} } = x;
  const [cols, rows] = roomDims(room.lv);
  const desks: Desk[] = [];
  const mk = (s: Seat, gx: number, gy: number, spr: string, w: number, isBoss = false): Desk => ({
    id: s.id, label: s.label, gx, gy, w, spr, st: officeState(s.status), status: s.status, color: colorFor(spr), ...(isBoss ? { boss: true } : {}),
    ...(s.act ? { act: s.act } : {}), ...(s.doing ? { doing: s.doing } : {}), ...(s.human !== undefined ? { human: s.human } : {}),
  });
  const pool: (Seat & { spr?: string })[] = [];
  const auto = defaultSeats(orchs, seats);
  orchs.forEach((o, i) => {
    const isBoss = i === 0, spr = o.spr ?? speciesFor(o.name), own = seats[o.name], def = auto.get(o.name);
    let at: [number, number] | null = null, w = isBoss ? BOSS_W : BACK_W;
    if (own) { if (own.office === index) { at = [own.x, own.y]; w = own.w ?? w; } }
    else if (index === 0) {
      if (def) { at = [def.x, def.y]; w = def.w; }
      else if (!o.off) pool.push({ ...o, spr });
    }
    if (!at) return;
    const d = mk(o, at[0], at[1], spr, w, isBoss);
    desks.push(o.off ? { ...d, empty: true, off: true, st: 'wait' } : d);
  });
  pool.push(...[...x.workers].sort((a, b) => a.project.localeCompare(b.project) || a.startedAt - b.startedAt));
  const byId = new Map(pool.map((s) => [s.id, s]));
  const order: ((Seat & { spr?: string }) | null)[] = x.slots ? x.slots.map((id) => (id ? byId.get(id) ?? null : null)) : [...pool];
  if (x.slots) for (const s of pool) if (!x.slots.includes(s.id)) order.push(s);
  const spots = seatsOf(room);
  const sit = order.slice(0, spots.length);
  const waiting = order.slice(spots.length).filter((s): s is Seat & { spr?: string } => !!s);
  // 빈 자리가 있으면 서 있던 직원부터 앉는다
  for (let k = 0; k < spots.length && waiting.length; k++) if (!sit[k]) sit[k] = waiting.shift()!;
  spots.forEach(([cx, cy], k) => {
    const s = sit[k];
    if (s) desks.push(mk(s, cx + 0.2, cy, s.spr ?? speciesFor(s.project), BACK_W));
    else desks.push({ id: `seat-${index}-${k}`, label: '', gx: cx + 0.2, gy: cy, w: BACK_W, spr: '', st: 'wait', color: 0, empty: true });
  });
  const fold = waiting.length > STAND_MAX ? waiting.length - STAND_MAX : 0;
  waiting.forEach((s, k) => {
    const shown = k < STAND_MAX, last = k === STAND_MAX - 1 && fold > 0;
    desks.push({ ...mk(s, STAND_X, rows - 0.45 - Math.min(k, STAND_MAX - 1) * STAND_GAP, s.spr ?? speciesFor(s.project), 0), stand: true, ...(shown ? {} : { tuck: true }), ...(last ? { more: fold } : {}) });
  });
  return {
    cols, rows, desks, door: true, lv: room.lv, zone: room.zone, short: waiting.length, used: sit.filter(Boolean).length + waiting.length,
    floor: room.floor, wall: room.wall,
    furniture: Object.entries(room.furn).map(([id, c]) => ({ id, gx: c[0], gy: c[1] })),
  };
}

export const ARRIVE_MS = 3000;
/** 출근 — 문을 열고 들어와 왼쪽 통로를 지나 자기 책상 앞까지. 다 걸었으면 null(그 뒤론 책상에 앉아 있다) */
export function arrival(room: Room, id: string, age: number): Delivery | null {
  const d = room.desks.find((x) => x.id === id && !x.empty && !x.stand);
  if (!d || age < 0 || age >= ARRIVE_MS) return null;
  const doorY = room.rows - 1.55, tx = d.gx + d.w / 2, ty = d.gy + 1.45;
  const { at, dir } = along([[0.15, doorY], [STAND_X, doorY], [STAND_X, ty], [tx, ty]], age / ARRIVE_MS);
  return { spr: d.spr, at, flip: dir[0] - dir[1] < 0, awayId: id, back: true };
}

/** 캔버스 점(논리 좌표) → 벽 칸. side R = 뒤 벽, L = 왼 벽 */
export function wallAt(room: Pick<Room, 'cols' | 'rows'>, ox: number, oy: number, x: number, y: number): { side: 'L' | 'R'; at: number } | null {
  const gx = (x - ox) / 12, zr = oy + gx * 6 - y;
  if (gx >= 0 && gx < room.cols && zr >= 0 && zr <= 46) return { side: 'R', at: Math.floor(gx) };
  const gy = (ox - x) / 12, zl = oy + gy * 6 - y;
  if (gy >= 0 && gy < room.rows && zl >= 0 && zl <= 46) return { side: 'L', at: Math.floor(gy) };
  return null;
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
const AISLE_Y = 2.7; // 뒷줄과 앞줄 사이 통로(옛 배치)
const GAPS_X = [0.2, 2.65, 5.35, 7.75]; // 앞줄 책상 사이 세로 통로(옛 배치)
/** 묶음 위 가로 통로 — 묶음을 옮기면 따라간다 */
const aisleOf = (room: Room) => (room.zone ? Math.max(0.3, room.zone[1] - 0.3) : AISLE_Y);
/** 직원 책상 사이 세로 통로(한 자리 3칸 중 셋째 칸) */
const gapsOf = (room: Room) => (room.zone && room.lv !== undefined ? [STAND_X, ...Array.from({ length: LEVELS[room.lv]!.zone[0] }, (_, k) => room.zone![0] + 2.5 + k * 3), room.cols - 0.4] : GAPS_X);

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
  const aisle = aisleOf(room);
  const gap = gapsOf(room).reduce((a, b) => (Math.abs(b - tx) < Math.abs(a - tx) ? b : a));
  const path: Pt[] = to.gy === boss.gy
    ? [[bx, boss.gy + 1.45], [tx, ty]]
    : [[bx, boss.gy + 1.45], [bx, aisle], [gap, aisle], [gap, ty], [tx, ty]];
  const go = reply ? [...path].reverse() : path;
  const back = age > WALK_MS + HOLD_MS;
  const { at, dir } = back ? along([...go].reverse(), (age - WALK_MS - HOLD_MS) / WALK_MS) : along(go, Math.min(1, age / WALK_MS));
  const who = reply ? to : boss;
  return { spr: who.spr, at, flip: dir[0] - dir[1] < 0, awayId: who.id, back };
}

/**
 * delivery 가 보는 건 마지막 보낸 일·회신 하나(회신에 대상이 없으면 그 일의 send)뿐이다. 기록이 바뀔 때 한 번 뽑아 두고
 * 프레임마다 이것만 stampSeen·delivery 에 넘긴다 — 기록 전체(수천 줄)를 매 프레임 훑지 않게
 */
export function deliveryTail<E extends { type: string; task?: string; target?: string }>(events: E[]): E[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'send' && e.type !== 'reply') continue;
    if (e.type === 'send' || e.target) return [e];
    for (let j = i - 1; j >= 0; j--) {
      const x = events[j]!;
      if (x.type === 'send' && x.task === e.task) return [x, e];
    }
    return [e];
  }
  return [];
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

const HALF_W = 12; // 타일 2:1 — ui/office/draw TW/2, TH/2
const HALF_H = 6;
/** 캔버스 점(논리 좌표) → 바닥 칸. (ox, oy) = 방 원점. 방 밖이면 null */
export function cellAt(room: Room, ox: number, oy: number, x: number, y: number): [number, number] | null {
  const a = (x - ox) / HALF_W, b = (y - oy) / HALF_H;
  const gx = Math.floor((a + b) / 2), gy = Math.floor((b - a) / 2);
  return gx >= 0 && gy >= 0 && gx < room.cols && gy < room.rows ? [gx, gy] : null;
}

/** 캔버스 점(논리 좌표) → 그 자리에 놓인 가구 id. 바닥 칸 안을 누르면 그 가구가 먼저(앞 가구 몸통이 뒤 바닥을 덮어도),
 *  아니면 바닥 가운데부터 위로 34 까지(키 큰 가구 몸통)를 잡고, 겹치면 앞(gx+gy 큰 것) */
export function furnitureAt(room: Room, ox: number, oy: number, x: number, y: number): string | null {
  const a = (x - ox) / HALF_W, b = (y - oy) / HALF_H;
  const fx = (a + b) / 2, fy = (b - a) / 2;
  const floor = (room.furniture ?? []).filter((f) => fx >= f.gx && fx < f.gx + 1 && fy >= f.gy && fy < f.gy + 1);
  if (floor.length) return floor.reduce((p, f) => (f.gx + f.gy > p.gx + p.gy ? f : p)).id;
  let best: Placed | null = null;
  for (const f of room.furniture ?? []) {
    const ax = ox + (f.gx - f.gy) * HALF_W, ay = oy + (f.gx + f.gy + 0.9) * HALF_H;
    if (Math.abs(x - ax) >= HALF_W - 2 || y > ay + 6 || y < ay - 34) continue; // 옆 칸(가로 12)과 안 겹치게 10 까지
    if (!best || f.gx + f.gy > best.gx + best.gy) best = f;
  }
  return best?.id ?? null;
}

const COFFEE_EVERY = 60_000;
/** 커피 액션: 1분마다 반장이 정수기(오른쪽 벽)까지 걸어갔다 온다. 반장 반응·배달이 없을 때만 부른다 */
export function coffeeWalk(room: Room, now: number): Delivery | null {
  const boss = room.desks.find((d) => d.boss);
  if (!boss) return null;
  const age = now % COFFEE_EVERY;
  if (age > WALK_MS * 2 + HOLD_MS) return null;
  const bx = boss.gx + boss.w / 2, cx = room.cols - 0.4;
  const path: Pt[] = [[bx, boss.gy + 1.45], [bx, aisleOf(room)], [cx, aisleOf(room)], [cx, 2.3]];
  const back = age > WALK_MS + HOLD_MS;
  const { at, dir } = back ? along([...path].reverse(), (age - WALK_MS - HOLD_MS) / WALK_MS) : along(path, Math.min(1, age / WALK_MS));
  // back = 서류 없이 걷기. 갈 땐 빈손, 돌아올 땐 컵(흰 네모)을 든다
  return { spr: boss.spr, at, flip: dir[0] - dir[1] < 0, awayId: boss.id, back: !back };
}

/** 사무실 고양이: 가운데 통로 → 오른쪽 세로 통로 → 맨 앞 통로 → 왼쪽 세로 통로를 30초에 한 바퀴 */
export function catWalk(room: Room, now: number): { at: [number, number]; flip: boolean } {
  const front = room.desks.filter((d) => !d.boss && !d.stand && d.gy > BACK_Y);
  const lastY = Math.min(room.rows - 0.3, front.length ? Math.max(...front.map((d) => d.gy)) + 1.45 : ROW0 + 1.45);
  const right = room.zone ? room.cols - 0.4 : Math.min(7.75, room.cols - 0.25), aisle = aisleOf(room);
  const path: Pt[] = [[0.2, aisle], [right, aisle], [right, lastY], [0.2, lastY], [0.2, aisle]];
  const { at, dir } = along(path, (now % 30_000) / 30_000);
  return { at, flip: dir[0] - dir[1] < 0 };
}
