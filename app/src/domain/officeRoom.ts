// 사무실 한 칸의 모양 — 크기(단계)·직원 책상 묶음·가구·바닥 장식·벽 장식과 놓는 규칙. 순수 TS.
// 확정 docs/plans/2026-11-06-office-v2.md, 시안 docs/design-drafts/office-v2 v1. 그리기는 ui/office/draw, 저장은 gacha.json offices

export type FloorItem = { id: string; x: number; y: number };
/** side R = 뒤 벽(창문 쪽, 가로 칸), L = 왼 벽(문 쪽, 세로 칸). at = 왼쪽(뒤쪽)부터 몇 번째 칸 */
export type WallSide = 'L' | 'R';
export type WallItem = { id: string; side: WallSide; at: number };
export type OfficeRoom = {
  lv: number;
  /** 사무실마다 스킨 — 첫 사무실은 equip.skin 을 쓴다(폰·도감과 같은 칸) */
  skin?: string;
  /** 직원 책상 묶음 왼쪽 위 칸 */
  zone: [number, number];
  /** 놓은 가구 칸 — 없으면 창고 */
  furn: Record<string, [number, number]>;
  floor: FloorItem[];
  wall: WallItem[];
};
/** 바닥에 놓인 참모 책상 — 앉는 자리 그대로(소수), 칸 판정은 deskCells */
export type OrchDesk = { id: string; x: number; y: number; w: number };

/** 단계마다 넓이·직원 책상 가로×세로. price = 이 단계로 올리는 값(기본 0) */
export const LEVELS = [
  { cols: 8, rows: 7, zone: [2, 2], price: 0 },
  { cols: 10, rows: 8, zone: [3, 2], price: 1000 },
  { cols: 12, rows: 10, zone: [4, 3], price: 1500 },
  { cols: 14, rows: 13, zone: [4, 5], price: 3000 },
] as const;
export const MAX_LEVEL = LEVELS.length - 1;
/** 사무실 값 — 첫 번째는 무료, 최대 3개 */
const OFFICE_PRICES = [0, 2000, 10000];
export const MAX_OFFICES = OFFICE_PRICES.length;
export const officePrice = (i: number): number | null => OFFICE_PRICES[i] ?? null;
/** 지금 단계에서 다음 단계로 넓히는 값 — 끝이면 null */
export const expandPrice = (lv: number): number | null => LEVELS[lv + 1]?.price ?? null;

const clampLv = (lv: number) => Math.max(0, Math.min(MAX_LEVEL, Math.floor(lv) || 0));
export const roomDims = (lv: number): [number, number] => { const L = LEVELS[clampLv(lv)]!; return [L.cols, L.rows]; };
export const seatCount = (lv: number) => { const L = LEVELS[clampLv(lv)]!; return L.zone[0] * L.zone[1]; };
/** 한 자리 3×2칸(책상 2×2 + 옆 통로 1). 묶음 넓이는 마지막 통로를 뺀다 */
const SEAT_W = 3, SEAT_H = 2;
export const zoneSize = (lv: number): [number, number] => { const L = LEVELS[clampLv(lv)]!; return [L.zone[0] * SEAT_W - 1, L.zone[1] * SEAT_H]; };

/** 왼쪽 한 줄은 통로(문으로 들어오는 길, 못 앉은 직원이 서는 곳) */
export const newRoom = (): OfficeRoom => ({ lv: 0, zone: [1, 3], furn: {}, floor: [], wall: [] });

export function seatsOf(room: Pick<OfficeRoom, 'lv' | 'zone'>): [number, number][] {
  const L = LEVELS[clampLv(room.lv)]!, out: [number, number][] = [];
  for (let j = 0; j < L.zone[1]; j++) for (let i = 0; i < L.zone[0]; i++) out.push([room.zone[0] + i * SEAT_W, room.zone[1] + j * SEAT_H]);
  return out;
}

const key = (x: number, y: number) => `${x},${y}`;
/** 고정 소품 — 뒤쪽 화분 둘·책장·정수기(ui/office/draw) */
const fixedCells = (cols: number): [number, number][] => [[0, 0], [cols - 1, 0], [5, 0], [6, 0], [7, 0], [cols - 1, 1]];
/** 참모 책상이 차지하는 칸 — 깊이 2칸 */
export const deskCells = (d: Pick<OrchDesk, 'x' | 'y' | 'w'>): [number, number][] => {
  const x0 = Math.floor(d.x), y0 = Math.floor(d.y), w = Math.ceil(d.x + d.w) - x0, out: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < 2; j++) out.push([x0 + i, y0 + j]);
  return out;
};
const seatCells = (room: Pick<OfficeRoom, 'lv' | 'zone'>): [number, number][] =>
  seatsOf(room).flatMap(([x, y]): [number, number][] => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]);

/** 인테리어를 못 놓는 칸 — skip 은 지금 옮기는 것(자기 자리는 빼고 본다) */
function solid(room: OfficeRoom, desks: OrchDesk[], skip: { furn?: string; desk?: string; zone?: boolean } = {}) {
  const [cols] = roomDims(room.lv), s = new Set<string>();
  for (const [x, y] of fixedCells(cols)) s.add(key(x, y));
  if (!skip.zone) for (const [x, y] of seatCells(room)) s.add(key(x, y));
  for (const d of desks) if (d.id !== skip.desk) for (const [x, y] of deskCells(d)) s.add(key(x, y));
  for (const [id, c] of Object.entries(room.furn)) if (id !== skip.furn) s.add(key(c[0], c[1]));
  return s;
}
const inside = (room: OfficeRoom, x: number, y: number, w = 1, h = 1) => { const [cols, rows] = roomDims(room.lv); return x >= 0 && y >= 0 && x + w <= cols && y + h <= rows; };

export function canPlaceFurn(room: OfficeRoom, desks: OrchDesk[], id: string, [x, y]: [number, number]): boolean {
  return inside(room, x, y) && !solid(room, desks, { furn: id }).has(key(x, y));
}

/** 바닥 장식 — 책상·가구 아래에 깔리고, 바닥 장식끼리만 못 겹친다 */
export function canPlaceFloor(room: OfficeRoom, id: string, [x, y]: [number, number], sizeOf: (id: string) => [number, number]): boolean {
  const [w, h] = sizeOf(id);
  if (!inside(room, x, y, w, h)) return false;
  return !room.floor.some((f) => {
    if (f.id === id) return false;
    const [fw, fh] = sizeOf(f.id);
    return x < f.x + fw && x + w > f.x && y < f.y + fh && y + h > f.y;
  });
}

/** 벽에서 못 쓰는 칸 — 뒤 벽 창문(0~4), 왼 벽 시계·문 */
const wallBlocked = (side: WallSide, at: number, rows: number) => (side === 'R' ? at <= 4 : at === 3 || at === rows - 3 || at === rows - 2);
export function canHangWall(room: OfficeRoom, id: string, side: WallSide, at: number, spanOf: (id: string) => number): boolean {
  const [cols, rows] = roomDims(room.lv), span = spanOf(id), lim = side === 'R' ? cols : rows;
  if (at < 0 || at + span > lim) return false;
  for (let k = at; k < at + span; k++) if (wallBlocked(side, k, rows)) return false;
  return !room.wall.some((w) => w.id !== id && w.side === side && at < w.at + spanOf(w.id) && at + span > w.at);
}
/** 벽 칸 하나가 쓸 수 있는 칸인가 — 편집 화면 표시용 */
export const wallFree = (lv: number, side: WallSide, at: number) => !wallBlocked(side, at, roomDims(lv)[1]);

export function canMoveZone(room: OfficeRoom, desks: OrchDesk[], [x, y]: [number, number]): boolean {
  const [w, h] = zoneSize(room.lv);
  if (!inside(room, x, y, w, h)) return false;
  const s = solid(room, desks, { zone: true });
  return !seatCells({ lv: room.lv, zone: [x, y] }).some(([a, b]) => s.has(key(a, b)));
}

/** 참모 책상 자리 — 칸 번호로 묻는다. w 는 책상 폭(반장 2.4, 나머지 1.6) */
export const orchDeskAt = ([x, y]: [number, number], w: number): Pick<OrchDesk, 'x' | 'y' | 'w'> => ({ x: x + (w > 2 ? 0.3 : 0.2), y: y + 0.1, w });
export function canMoveOrch(room: OfficeRoom, desks: OrchDesk[], id: string, cell: [number, number], w: number): boolean {
  const d = orchDeskAt(cell, w), cells = deskCells(d), s = solid(room, desks, { desk: id });
  return cells.every(([a, b]) => inside(room, a, b) && !s.has(key(a, b)));
}

/** 참모 책상을 둘 첫 빈 칸(뒤에서 앞으로) — 다른 사무실로 옮길 때 */
export function freeDeskCell(room: OfficeRoom, desks: OrchDesk[], id: string, w: number): [number, number] | null {
  const [cols, rows] = roomDims(room.lv);
  for (let y = 1; y < rows - 1; y++) for (let x = 0; x < cols; x++) if (canMoveOrch(room, desks, id, [x, y], w)) return [x, y];
  return null;
}

/** 인테리어 칸 수 — 바닥에서 직원 자리·기본 참모 자리·고정 소품을 뺀 것(편집 화면 '몇 칸 남음') */
export const interiorCells = (lv: number) => { const [c, r] = roomDims(lv); return c * r - seatCount(lv) * 4 - 14 - fixedCells(c).length; };
/** 벽 장식 칸 수 — 뒤 벽 창문 옆 + 왼 벽 시계·문 뺀 칸 */
export const wallSlots = (lv: number) => { const [c, r] = roomDims(lv); return c - 5 + r - 3; };

const isCell = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
/** 파일에서 읽기 — 깨진 칸은 버린다(칸 하나로 사무실이 안 그려지면 안 된다) */
export function parseRoom(v: unknown): OfficeRoom {
  const base = newRoom();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  const furn: Record<string, [number, number]> = {};
  if (o.furn && typeof o.furn === 'object') for (const [k, c] of Object.entries(o.furn)) if (isCell(c)) furn[k] = c;
  const floor = Array.isArray(o.floor) ? o.floor.filter((f): f is FloorItem => !!f && typeof f.id === 'string' && typeof f.x === 'number' && typeof f.y === 'number').map((f) => ({ id: f.id, x: f.x, y: f.y })) : [];
  const wall = Array.isArray(o.wall) ? o.wall.filter((w): w is WallItem => !!w && typeof w.id === 'string' && (w.side === 'L' || w.side === 'R') && typeof w.at === 'number').map((w) => ({ id: w.id, side: w.side, at: w.at })) : [];
  return { lv: typeof o.lv === 'number' ? clampLv(o.lv) : 0, ...(typeof o.skin === 'string' ? { skin: o.skin } : {}), zone: isCell(o.zone) ? o.zone : base.zone, furn, floor, wall };
}
