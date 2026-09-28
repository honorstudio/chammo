// 픽셀 사무실 그리기 — 아이소메트릭 도트. 시안 엔진(docs/design-drafts/pixel-office/body/office_engine.js)을 옮긴 것.
// 한 프레임 = 벽 → 바닥 → (깊이 순) 책상·캐릭터·가구. 캐릭터는 다마고치 도트(ui/tama/sprites)에 스킨 색을 입힌다
import type { BossReact, Delivery, Desk, Room } from '../../domain/office';
import { drawHat, windowScene, WINDOW_SKY } from '../gacha/icons';
import { SPR } from '../tama/sprites';
import type { Skin } from './skins';

export const TW = 24;
export const TH = 12;
const WH = 44;

type Pt = [number, number];

export function brush(ctx: CanvasRenderingContext2D) {
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  // 가장자리가 흐려지지 않게 화소 중심으로 칠한다(2:1 계단)
  const poly = (pts: Pt[], c: string) => {
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    ctx.fillStyle = c;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yy = y + 0.5, xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % pts.length]!;
        if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + ((yy - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.round(xs[k]!), b = Math.round(xs[k + 1]!);
        if (b > a) ctx.fillRect(a, y, b - a, 1);
      }
    }
  };
  const line = (p: Pt, q: Pt, c: string) => {
    let [x0, y0] = [Math.round(p[0]), Math.round(p[1])];
    const [x1, y1] = [Math.round(q[0]), Math.round(q[1])];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    ctx.fillStyle = c;
    for (;;) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  return { rect, poly, line };
}
export type Brush = ReturnType<typeof brush>;

// 다마고치 도트: '#' 외곽 · e 눈 · m 입 · p 무늬 · 갇힌 '.' 몸통 · 바깥 '.' 투명
const MASK = new Map<string, Set<number>>();
/**
 * 투명(바깥) 칸 — 테두리에서 물을 부어 닿는 '.' 중, 위·아래·왼쪽·오른쪽 네 방향 모두에 선이 있는 칸은 뺀다.
 * 외곽선에 틈이 있는 도트는 물이 새어 몸통까지 투명해졌다(2026-09-27 project-b 캐릭터)
 */
const CLEAR = new Map<string, Set<number>>();
const transparent = (name: string) => { let c = CLEAR.get(name); if (!c) { c = transparentCells(name); CLEAR.set(name, c); } return c; };
export function transparentCells(name: string): Set<number> {
  const flood = outside(name), rows = SPR[name]!, w = rows[0]!.length, h = rows.length;
  const solid = (y: number, x: number) => rows[y]![x] !== '.';
  const out = new Set<number>();
  for (const k of flood) {
    const y = Math.floor(k / w), x = k % w;
    let l = false, r = false, u = false, d = false;
    for (let i = 0; i < x && !l; i++) l = solid(y, i);
    for (let i = x + 1; i < w && !r; i++) r = solid(y, i);
    for (let i = 0; i < y && !u; i++) u = solid(i, x);
    for (let i = y + 1; i < h && !d; i++) d = solid(i, x);
    if (!(l && r && u && d)) out.add(k);
  }
  return out;
}
function outside(name: string): Set<number> {
  const hit = MASK.get(name);
  if (hit) return hit;
  const rows = SPR[name]!, h = rows.length, w = rows[0]!.length, out = new Set<number>(), st: Pt[] = [];
  for (let y = 0; y < h; y++) st.push([y, 0], [y, w - 1]);
  for (let x = 0; x < w; x++) st.push([0, x], [h - 1, x]);
  while (st.length) {
    const [y, x] = st.pop()!;
    if (y < 0 || x < 0 || y >= h || x >= w || out.has(y * w + x) || rows[y]![x] !== '.') continue;
    out.add(y * w + x); st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  MASK.set(name, out);
  return out;
}
export function pet(b: Pick<Brush, 'rect'>, sk: Skin, name: string, x: number, y: number, fill: string, o: { shut?: boolean; flip?: boolean } = {}) {
  const rows = SPR[name] ?? SPR.egg;
  if (!rows) return;
  const key = SPR[name] ? name : 'egg';
  const out = transparent(key), w = rows[0]!.length;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '.' && out.has(r * w + c)) return;
    let col = fill;
    if (ch === '#' || ch === 'm') col = sk.line;
    else if (ch === 'e') col = o.shut ? fill : sk.line;
    else if (ch === 'p') col = sk.pat;
    b.rect(x + (o.flip ? w - 1 - c : c), y + r, 1, 1, col);
  }));
}
const GLYPH: Record<string, string[]> = {
  '?': ['###', '..#', '.##', '.#.', '...', '.#.'],
  '!': ['.#.', '.#.', '.#.', '.#.', '...', '.#.'],
  ok: ['....#', '...#.', '#.#..', '.#...'],
};
const glyph = (b: Brush, g: string, x: number, y: number, c: string) =>
  GLYPH[g]!.forEach((row, r) => [...row].forEach((ch, i) => ch === '#' && b.rect(x + i, y + r, 1, 1, c)));

/** 캔버스 논리 크기와 원점 */
export function roomSize(room: Room) {
  const W = Math.round((room.cols + room.rows) * (TW / 2) + 24);
  const H = Math.round((room.cols + room.rows) * (TH / 2) + WH + 22);
  return { W, H, ox: room.rows * (TW / 2) + 12, oy: WH + 6 };
}

/** 이름표·눌러서 열기용 좌표(캔버스 논리 좌표) */
/** doing = 작업 중일 때 머리 위 한 줄('Edit ambassador.ts') */
export type Spot = { id: string; label: string; x: number; y: number; hx: number; hy: number; st: Desk['st']; doing?: string };

/** 펑 — 세션이 생기거나 사라진 자리(칸 좌표)와 지난 시간(ms). 생길 땐 연기가 걷힐 즈음 캐릭터가 보인다 */
export type Poof = { id: string; gx: number; gy: number; age: number };
export const POOF_MS = 1100;

/** 뽑기로 얻어 장착한 것들(domain/gacha equip) + 펫 친구 위치 */
export type Deco = { hat?: string; window?: string; fx?: string; dance?: boolean; cat?: { at: [number, number]; flip: boolean } | null };
/** edit = 가구 놓기 — 바닥 칸 선을 보이고, 마우스가 올라간 칸을 칠한다(놓을 수 있으면 초록, 없으면 빨강) */
/** ghost = 끄는 중인 가구 — 원래 자리에선 빼고 hover 칸에 반투명으로(못 놓는 칸이면 더 흐리게) */
export type DrawOpts = { walker?: Delivery | null; poofs?: Poof[]; boss?: BossReact | null; deco?: Deco; edit?: { hover: [number, number] | null; ok: boolean; ghost?: string | null } };

export function drawRoom(ctx: CanvasRenderingContext2D, room: Room, sk: Skin, t: number, { walker, poofs = [], boss, deco = {}, edit }: DrawOpts = {}): Spot[] {
  const { W, H, ox, oy } = roomSize(room);
  const b = brush(ctx);
  const P = (gx: number, gy: number, z = 0): Pt => [ox + (gx - gy) * (TW / 2), oy + (gx + gy) * (TH / 2) - z];
  const box = (gx: number, gy: number, w: number, d: number, z: number, h: number, top: string, left: string, right: string, edge?: string) => {
    b.poly([P(gx, gy + d, z), P(gx + w, gy + d, z), P(gx + w, gy + d, z + h), P(gx, gy + d, z + h)], left);
    b.poly([P(gx + w, gy, z), P(gx + w, gy + d, z), P(gx + w, gy + d, z + h), P(gx + w, gy, z + h)], right);
    b.poly([P(gx, gy, z + h), P(gx + w, gy, z + h), P(gx + w, gy + d, z + h), P(gx, gy + d, z + h)], top);
    if (edge) { b.line(P(gx, gy + d, z + h), P(gx + w, gy + d, z + h), edge); b.line(P(gx + w, gy + d, z + h), P(gx + w, gy, z + h), edge); }
  };
  ctx.clearRect(0, 0, W, H);

  // 벽 + 창문·시계
  const { cols, rows } = room;
  b.poly([P(0, 0), P(cols, 0), P(cols, 0, WH), P(0, 0, WH)], sk.wallR);
  b.poly([P(0, 0), P(0, rows), P(0, rows, WH), P(0, 0, WH)], sk.wallL);
  b.line(P(0, 0, WH), P(cols, 0, WH), sk.wallTop); b.line(P(0, 0, WH), P(0, rows, WH), sk.wallTop); b.line(P(0, 0), P(0, 0, WH), sk.wallTop);
  // 창문 — 창밖 풍경이 보이게 크게(사용자 2026-09-27: 작아서 안 보였다). 가로 세 칸 · 세로 두 칸 창살
  const [wa, wb] = [0.9, 4.3], [z0, z1] = [11, 40];
  b.poly([P(wa, 0, z0), P(wb, 0, z0), P(wb, 0, z1), P(wa, 0, z1)], deco.window ? WINDOW_SKY[deco.window.slice(7)] ?? sk.sky : sk.sky);
  if (deco.window) windowScene(deco.window, t, (u, v, w, h, c) => { const [x, y] = P(wa + 0.08 + u * (wb - wa - 0.16), 0, z1 - 2 - v * (z1 - z0 - 4)); b.rect(x, y, w * 2, h * 2, c); });
  if (sk.stars && !deco.window) for (const [g, z] of [[0.4, 34], [1.3, 26], [2.1, 37], [2.9, 22]] as const) { const [x, y] = P(wa + g, 0, z); b.rect(x, y, 1, 1, '#ffffff'); }
  const m1 = wa + (wb - wa) / 3, m2 = wa + ((wb - wa) * 2) / 3, zm = (z0 + z1) / 2;
  for (const [p, q] of [[P(wa, 0, z0), P(wb, 0, z0)], [P(wa, 0, z1), P(wb, 0, z1)], [P(wa, 0, z0), P(wa, 0, z1)], [P(wb, 0, z0), P(wb, 0, z1)], [P(m1, 0, z0), P(m1, 0, z1)], [P(m2, 0, z0), P(m2, 0, z1)], [P(wa, 0, zm), P(wb, 0, zm)]] as const) b.line(p, q, sk.frame);
  b.poly([P(wa - 0.05, 0.08, z0), P(wb + 0.05, 0.08, z0), P(wb + 0.05, 0, z0 - 2), P(wa - 0.05, 0, z0 - 2)], sk.frame); // 창턱
  {
    const [x, y] = P(0, 3.6, 30);
    b.rect(x - 3, y - 3, 7, 7, sk.paper);
    for (const [rx, ry, rw, rh] of [[-3, -3, 7, 1], [-3, 3, 7, 1], [-3, -3, 1, 7], [3, -3, 1, 7], [0, -2, 1, 3], [0, 0, 2, 1]] as const) b.rect(x + rx, y + ry, rw, rh, sk.line);
  }

  // 바닥
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    b.poly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], sk.floor[(i + j) % 2]!);
    if (sk.planks && (i * 7 + j * 3) % 5 === 0) b.line(P(i + 0.2, j + 0.5), P(i + 0.7, j + 0.5), sk.grain);
  }

  if (edit) {
    for (let i = 0; i <= cols; i++) b.line(P(i, 0), P(i, rows), 'rgba(0,0,0,.12)');
    for (let j = 0; j <= rows; j++) b.line(P(0, j), P(cols, j), 'rgba(0,0,0,.12)');
    if (edit.hover) { const [i, j] = edit.hover; b.poly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], edit.ok ? 'rgba(80,200,120,.55)' : 'rgba(229,72,77,.45)'); }
  }

  const spots: Spot[] = [];
  const items: { k: number; f: () => void }[] = [];

  room.desks.forEach((d, i) => items.push({
    k: d.gx + d.gy + 1.2 + d.w / 2,
    f: () => {
      const cx = d.gx + d.w / 2, cy = d.gy + 0.35;
      const [px, py] = P(cx, cy);
      let bob = 0;
      // 작업 중: 쓰는 도구마다 박자가 다르다(domain/activity workAct) — 고치기는 빠르게, 읽기는 가만히
      const act = d.st === 'working' ? d.act ?? 'think' : undefined;
      if (act === 'type') bob = t % 2 ? -1 : 0;
      else if (act === 'run') bob = t % 8 < 4 ? 0 : -1;
      else if (act === 'web' || act === 'agent') bob = t % 6 < 3 ? 0 : -1;
      else if (act === 'think') bob = t % 10 < 5 ? 0 : -1;
      if (d.st === 'asks') bob = [0, -2, -3, -2, 0, 0, 0, 0][t % 8]!;
      // 반장 반응(domain/office bossReaction) — 상태 연출보다 앞선다
      const react = d.boss ? boss?.mode : undefined;
      if (react === 'ask') bob = [0, -4, -7, -8, -7, -4, 0, 0][t % 8]!;
      if (react === 'cheer') bob = [0, -3, -6, -7, -6, -3, 0, 0][t % 8]!;
      if (react === 'say' || react === 'talk') bob = [0, -1, 0, 0][t % 4]!;
      const fill = sk.pets[d.color % sk.pets.length]!;
      const shut = d.st === 'sleep' || ((d.st === 'working' || d.st === 'wait') && (t + i * 7) % 23 === 0);
      const hatching = poofs.some((p) => p.id === d.id && p.age < POOF_MS * 0.45);
      if (!d.empty && !hatching && walker?.awayId !== d.id) {
        pet(b, sk, d.spr, Math.round(px - 8), Math.round(py - 17 + bob), fill, { shut, flip: act === 'read' && Math.floor(t / 6) % 2 === 1 }); // 배달 나가면 자리가 빈다 · 읽을 땐 좌우를 본다
        if (d.boss && deco.hat) drawHat(b, deco.hat, Math.round(px - 8), Math.round(py - 17 + bob));
      }
      box(d.gx, d.gy + 0.6, d.w, 0.55, 0, 9, sk.deskTop, sk.deskL, sk.deskR, sk.line);
      if (d.boss) {
        box(d.gx + d.w - 0.55, d.gy + 0.68, 0.35, 0.3, 9, 4, sk.paper, sk.grain, sk.grain);
        const [pt, pl, pr] = sk.plate ?? ['#e0b94f', '#c99a2e', '#b3871f'];
        box(d.gx + 0.9, d.gy + 0.95, 0.6, 0.12, 9, 2, pt, pl, pr);
      }
      // 모니터(왼쪽 끝, 화면은 캐릭터 쪽)
      const mx = d.gx + 0.12, my = d.gy + 0.66;
      box(mx, my, 0.14, 0.42, 9, 11, sk.mon, sk.mon, sk.monR);
      const scr = (z0: number, z1: number): Pt[] => [P(mx + 0.14, my + 0.05, z0), P(mx + 0.14, my + 0.37, z0), P(mx + 0.14, my + 0.37, z1), P(mx + 0.14, my + 0.05, z1)];
      b.poly(scr(11, 19), sk.screen);
      if (d.empty) { /* 빈 책상 — 화면 꺼짐 */ }
      else if (d.st === 'working') {
        const X = mx + 0.14;
        if (act === 'run') { // 진행 막대 + 도는 점
          const f = (t % 24) / 24;
          b.line(P(X, my + 0.08, 15), P(X, my + 0.08 + 0.26, 15), sk.monR);
          b.line(P(X, my + 0.08, 15), P(X, my + 0.08 + 0.26 * f, 15), sk.on[2]);
          const [sx, sy] = P(X, my + 0.2, 18); b.rect(sx + [0, 1, 1, 0][t % 4]!, sy + [0, 0, 1, 1][t % 4]!, 1, 1, sk.on[1]);
        } else if (act === 'web') { // 도는 지구본
          const [gx, gy] = P(X, my + 0.21, 15);
          b.rect(gx - 2, gy - 2, 5, 5, '#3f7ad6'); b.rect(gx - 3, gy - 1, 7, 3, '#3f7ad6');
          for (let k = 0; k < 3; k++) b.rect(gx - 2 + ((t + k * 2) % 5), gy - 1 + (k % 2), 1, 2, '#5fbf6a');
        } else if (act === 'read') { // 가만히 있는 페이지
          for (let k = 0; k < 4; k++) b.line(P(X, my + 0.08, 18 - k * 2), P(X, my + 0.08 + 0.2 - (k % 2) * 0.06, 18 - k * 2), sk.on[0]);
        } else { // 고치기는 빨리, 나머지는 천천히 올라가는 글자
          const speed = act === 'type' ? 2 : 1;
          for (let k = 0; k < 3; k++) {
            const len = 0.08 + ((t * speed + k * 3 + i) % 5) * 0.045, z = 17 - k * 2;
            b.line(P(X, my + 0.08, z), P(X, my + 0.08 + len, z), sk.on[k % 3]!);
          }
          if (act === 'type' && t % 4 < 2) { const [cx2, cy2] = P(X, my + 0.3, 11); b.rect(cx2, cy2 - 1, 1, 2, sk.on[0]); }
        }
      } else if (d.st === 'asks') { if (t % 4 < 2) b.poly(scr(12, 18), sk.on[1]); }
      else if (d.st === 'done') { const [gx, gy] = P(mx + 0.14, my + 0.3, 17); glyph(b, 'ok', gx - 1, gy, sk.on[2]); }
      const hx = Math.round(px), hy = Math.round(py - 22 + bob - (d.boss && deco.hat ? 5 : 0)); // 모자를 쓰면 말풍선을 모자 위로
      if (react && walker?.awayId !== d.id) {
        const bubble = (w: number, h: number) => { b.rect(hx - w / 2, hy - h, w, h, sk.paper); b.rect(hx - w / 2 + 1, hy - h - 1, w - 2, 1, sk.paper); b.rect(hx - 1, hy, 2, 2, sk.paper); };
        if (react === 'think') { bubble(13, 7); for (let k = 0; k < 1 + (Math.floor(t / 3) % 3); k++) b.rect(hx - 4 + k * 4, hy - 5, 2, 2, sk.line); }
        if (react === 'ask') { bubble(9, 9); glyph(b, '!', hx - 1, hy - 8, '#d9462f'); if (t % 8 < 4) { b.rect(hx - 12, hy + 6, 3, 1, sk.line); b.rect(hx + 10, hy + 6, 3, 1, sk.line); } }
        if (react === 'talk') { if (t % 4 < 2) b.rect(hx - 1, hy + 13, 3, 2, sk.line); for (let k = 0; k < 3; k++) if ((t + k) % 6 < 3) b.rect(hx + 9 + k * 3, hy + 6 - k, 1, 3 + k * 2, sk.on[0]); }
        if (react === 'cheer') {
          const k = t % 8;
          if (deco.dance) { const s2 = t % 4 < 2 ? 0 : 2; b.rect(hx - 11 + s2, hy + 3, 2, 4, fill); b.rect(hx + 9 - s2, hy + 3, 2, 4, fill); b.rect(hx + 12, hy - 6 - (t % 6), 2, 2, sk.on[1]); b.rect(hx + 14, hy - 8 - (t % 6), 1, 3, sk.on[1]); }
          else if (k < 6) { b.rect(hx - 11, hy + 2, 2, 5, fill); b.rect(hx + 10, hy + 2, 2, 5, fill); }
          for (let c = 0; c < 3; c++) { const a = (t + c * 3) % 10; const cx = hx - 6 + c * 6, cy = hy - 4 - a * 2; const w = [5, 3, 1, 3][(t + c) % 4]!; b.rect(cx - Math.floor(w / 2), cy, w, 5, '#e0b94f'); b.rect(cx - Math.floor(w / 2), cy + 4, w, 1, '#b3871f'); }
        }
      } else if (d.st === 'asks') {
        b.rect(hx - 4, hy - 9, 9, 9, sk.paper); b.rect(hx - 3, hy - 10, 7, 1, sk.paper); b.rect(hx - 1, hy, 2, 2, sk.paper);
        glyph(b, t % 6 < 4 ? '?' : '!', hx - 1, hy - 8, sk.line);
      }
      // 작업 중 소품 — 반장이 말풍선을 띄우는 동안엔 머리 위를 비운다
      if (act && !d.empty && walker?.awayId !== d.id) {
        const top = !react;
        if (act === 'type') for (let k = 0; k < 2; k++) { const [sx, sy] = P(cx + (((t * 7 + i * 3 + k * 5) % 7) - 3) * 0.08, d.gy + 0.72, 10); b.rect(sx, sy - (t + k) % 3, 1, 1, k ? '#fff1a6' : sk.paper); }
        if (act === 'read') { const w = t % 8 < 4 ? 6 : 4; b.rect(px - 3, py - 8 + bob, w, 5, sk.paper); b.rect(px - 2, py - 7 + bob, w - 2, 1, sk.grain); b.rect(px - 2, py - 5 + bob, w - 3, 1, sk.grain); }
        if (act === 'run' && top) { const k = t % 2; b.rect(hx - 2, hy - 6, 5, 5, sk.line); b.rect(hx - 1, hy - 5, 3, 3, sk.paper); b.rect(hx + (k ? -3 : 3), hy - 4, 1, 1, sk.line); b.rect(hx, hy + (k ? -8 : 0), 1, 1, sk.line); }
        if (act === 'think' && top && t % 8 < 6) { b.rect(hx - 1, hy - 6, 3, 3, '#ffe07a'); b.rect(hx, hy - 3, 1, 1, sk.line); b.rect(hx - 1, hy - 7, 3, 1, '#fff6c2'); }
        if (act === 'agent') { // 옆에 작은 분신
          const ph = t % 30, ay = Math.round(py - 10 + (t % 6 < 3 ? 0 : -1));
          if (ph < 26) { b.rect(px + 9, ay, 6, 6, 'rgba(255,255,255,.85)'); b.rect(px + 10, ay + 2, 1, 1, sk.line); b.rect(px + 13, ay + 2, 1, 1, sk.line); b.rect(px + 9, ay - 1, 1, 1, 'rgba(255,255,255,.85)'); b.rect(px + 14, ay - 1, 1, 1, 'rgba(255,255,255,.85)'); }
          if (ph < 3 || ph > 26) b.rect(px + 8, ay - 1, 8, 8, 'rgba(255,255,255,.5)');
        }
      }
      if (d.st === 'done') {
        box(d.gx + d.w - 0.4, d.gy + 0.75, 0.18, 0.18, 9, 4, sk.paper, sk.paper, sk.grain);
        const [sx, sy] = P(d.gx + d.w - 0.31, d.gy + 0.84, 13);
        pet(b, sk, t % 4 < 2 ? 'steam1' : 'steam2', Math.round(sx - 8), Math.round(sy - 14), sk.paper);
      }
      if (d.st === 'sleep') {
        const k = t % 12, zx = hx + 4 + Math.floor(k / 4), zy = hy - k;
        b.rect(zx, zy, 4, 1, sk.line); b.rect(zx + 2, zy + 1, 1, 1, sk.line); b.rect(zx + 1, zy + 2, 1, 1, sk.line); b.rect(zx, zy + 3, 4, 1, sk.line);
      }
      const [lx, ly] = P(d.gx + d.w / 2, d.gy + 1.15);
      if (!d.empty) spots.push({ id: d.id, label: d.label, x: lx, y: ly + 1, hx: px, hy: py - 8, st: d.st, ...(d.st === 'working' && d.doing ? { doing: d.doing } : {}) });
    },
  }));

  // 가구 — 방 크기와 상관없이 뒤쪽 벽에 붙는다
  const plant = (gx: number, gy: number) => {
    box(gx, gy, 0.45, 0.45, 0, 6, sk.pot, sk.pot, sk.grain);
    const [x, y] = P(gx + 0.22, gy + 0.22, 6), sway = t % 10 < 5 ? 0 : 1;
    ([[-3, -5, 6, 5], [-5, -9, 5, 5], [0, -10, 5, 6], [-2, -14, 5, 5]] as const).forEach(([dx, dy, w, h], k) => b.rect(x + dx + (k === 3 ? sway : 0), y + dy, w, h, sk.leaf[k % 2]!));
  };
  items.push({ k: 0.8, f: () => plant(0.15, 0.2) });
  items.push({ k: 7.8, f: () => plant(cols - 0.55, 0.2) });
  items.push({
    k: 5.5, f: () => {
      const gx = 4.9, gy = 0.05, w = 2.4;
      box(gx, gy, w, 0.4, 0, 24, sk.shelf, sk.shelf, sk.deskR, sk.line);
      for (let k = 0; k < 2; k++) for (let n = 0; n < 12; n++) {
        const g = gx + 0.12 + n * 0.19, z = 3 + k * 11;
        b.line(P(g, gy + 0.4, z), P(g, gy + 0.4, z + 7 - (n % 3)), sk.books[(n + k) % sk.books.length]!);
      }
    },
  });
  items.push({ k: cols - 0.65 + 1.85, f: () => { box(cols - 0.65, 1.6, 0.5, 0.5, 0, 14, sk.cooler, sk.cooler, sk.grain, sk.line); box(cols - 0.55, 1.7, 0.3, 0.3, 14, 8, sk.water, sk.water, sk.on[0]); } });

  // 휴게실 가구(domain/office withLounge) — 뽑기로 얻은 것
  const ghost = edit?.ghost ?? null;
  for (const f of room.furniture ?? []) if (f.id !== ghost) items.push({ k: f.gx + f.gy + 1, f: () => furniture(b, P, box, sk, f.id, f.gx, f.gy, t) });
  if (ghost && edit?.hover) {
    const [hx, hy] = edit.hover, alpha = edit.ok ? 0.6 : 0.3;
    items.push({ k: hx + hy + 1, f: () => { ctx.save(); ctx.globalAlpha = alpha; furniture(b, P, box, sk, ghost, hx, hy, t); ctx.restore(); } });
  }
  // 사무실 고양이
  if (deco.cat) {
    const [cx, cy] = deco.cat.at, flip = deco.cat.flip;
    items.push({
      k: cx + cy, f: () => {
        const [x0, y0] = P(cx, cy), F = '#f4a261', D = '#c97d3f', x = Math.round(x0) - 6, y = Math.round(y0) - 8, step = t % 4 < 2 ? 0 : 1;
        const X = (dx: number) => (flip ? x + 11 - dx : x + dx);
        b.rect(x, y + 8, 12, 1, 'rgba(0,0,0,.18)');
        for (const [dx, dy, w, h, c] of [[1, 3, 8, 4, F], [7, 0, 5, 4, F], [7, -1, 1, 1, F], [11, -1, 1, 1, F], [8, 1, 1, 1, sk.line], [10, 1, 1, 1, sk.line], [0, 1 - step, 1, 3, F], [2, 7, 1, 1 + step, D], [7, 7, 1, 2 - step, D]] as const) {
          b.rect(flip ? X(dx) - w + 1 : X(dx), y + dy, w, h, c);
        }
      },
    });
  }

  // 서류 들고 걷는 참모(일을 시킨 순간)
  if (walker) {
    const [gx, gy] = walker.at;
    const boss = room.desks.find((d) => d.id === walker.awayId);
    const fill = sk.pets[(boss?.color ?? 3) % sk.pets.length]!;
    items.push({
      k: gx + gy,
      f: () => {
        const [x, y] = P(gx, gy), hop = t % 2 ? -1 : 0;
        b.rect(x - 5, y - 1, 10, 2, 'rgba(0,0,0,.18)');
        pet(b, sk, walker.spr, Math.round(x - 8), Math.round(y - 16 + hop), fill, { flip: walker.flip });
        if (deco.hat && room.desks.some((d) => d.boss && d.id === walker.awayId)) drawHat(b, deco.hat, Math.round(x - 8), Math.round(y - 16 + hop)); // 반장이 걸을 때만
        if (!walker.back) { b.rect(x - 3, y - 21 + hop, 7, 5, sk.paper); b.rect(x - 2, y - 20 + hop, 5, 1, sk.grain); b.rect(x - 2, y - 18 + hop, 4, 1, sk.grain); }
      },
    });
  }

  // 펑 — 연기 뭉치가 퍼지며 옅어지고 반짝이가 튄다(맨 위에). 뽑은 이펙트를 장착했으면 그걸로
  for (const p of deco.fx ? [] : poofs) {
    const f = Math.min(1, p.age / POOF_MS);
    const [cx, cy] = P(p.gx, p.gy, 8);
    const r = 5 + f * 14, puff = Math.max(2, Math.round(8 - f * 6));
    // 처음엔 하얀 뭉게구름이 확 부풀고, 바깥으로 흩어지며 작아진다
    if (f < 0.4) { const s = Math.round(10 + f * 14); b.rect(cx - s / 2, cy - s / 2.6, s, s / 1.3, sk.paper); b.rect(cx - s / 2, cy + s / 2.6, s, 1, sk.grain); }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + f * 1.5;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.65 - f * 3;
      b.rect(x - puff / 2, y - puff / 2, puff, puff, sk.paper);
      b.rect(x - puff / 2, y + puff / 2 - 1, puff, 1, sk.grain);
    }
    if (f > 0.2 && f < 0.8) for (const [dx, dy] of [[-r - 3, -4], [r + 2, -6], [0, -r - 5]] as const) { b.rect(cx + dx, cy + dy, 1, 3, sk.on[1]); b.rect(cx + dx - 1, cy + dy + 1, 3, 1, sk.on[1]); }
  }

  items.sort((a, c) => a.k - c.k).forEach((it) => it.f());
  if (sk.weather) weather(b, W, H, sk.weather, t);
  if (deco.fx) for (const p of poofs) fxBurst(b, P, sk, deco.fx, p.gx, p.gy, Math.min(1, p.age / POOF_MS));
  return spots;
}

/** 스킨마다 방 안에 날리는 것 — 프레임 번호로만 정해져서(무작위 없음) 매 프레임 같은 입자가 이어 움직인다 */
function weather(b: Brush, W: number, H: number, kind: NonNullable<Skin['weather']>, t: number) {
  const n = kind === 'star' ? 14 : 18;
  for (let k = 0; k < n; k++) {
    const seedX = (k * 97) % W, seedY = (k * 61) % H;
    const wob = Math.sin(t / 7 + k) * 2;
    switch (kind) {
      case 'snow': b.rect((seedX + wob + t * 0.2) % W, (seedY + t * 0.6) % H, 1, 1, '#ffffff'); break;
      case 'petal': b.rect((seedX + t * 0.5 + wob) % W, (seedY + t * 0.45) % H, 2, 1, k % 2 ? '#f49ab8' : '#ffc6d9'); break;
      case 'leaf': b.rect((seedX + t * 0.35 + wob) % W, (seedY + t * 0.4) % H, 2, 1, ['#e07a2f', '#c9a23a', '#7aa04a'][k % 3]!); break;
      case 'bubble': { const x = (seedX + wob) % W, y = H - ((seedY + t * 0.5) % H); b.rect(x, y, 2, 1, 'rgba(220,250,255,.7)'); b.rect(x, y + 2, 2, 1, 'rgba(220,250,255,.7)'); b.rect(x - 1, y + 1, 1, 1, 'rgba(220,250,255,.7)'); b.rect(x + 2, y + 1, 1, 1, 'rgba(220,250,255,.7)'); break; }
      case 'ember': if ((t + k) % 6 < 4) b.rect((seedX + wob) % W, H - ((seedY + t * 0.7) % H), 1, 1, k % 2 ? '#ffb33b' : '#ff5a1f'); break;
      case 'rain': b.rect((seedX + t * 0.3) % W, (seedY + t * 3) % H, 1, 3, k % 2 ? 'rgba(0,240,255,.55)' : 'rgba(255,43,214,.45)'); break;
      case 'star': if ((t + k * 3) % 12 < 8) b.rect(seedX, seedY % Math.round(H * 0.45), 1, 1, '#ffffff'); break;
      case 'confetti': b.rect((seedX + wob) % W, (seedY + t * 0.6) % H, 1, 2, ['#ff8ac2', '#9ff0e0', '#fff1a6', '#c9b3ff'][k % 4]!); break;
    }
  }
}

/** 펑 대신 — 하트가 떠오르고 / 꽃잎이 흩날리고 / 불꽃이 터진다 */
function fxBurst(b: Brush, P: (gx: number, gy: number, z?: number) => Pt, sk: Skin, id: string, gx: number, gy: number, f: number) {
  const [cx, cy] = P(gx, gy, 8);
  for (let n = 0; n < 10; n++) {
    const a = (n / 10) * Math.PI * 2, r = 4 + f * 16;
    if (id === 'fx.heart') { const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.6 - f * 10; b.rect(x, y, 2, 1, '#f49ab8'); b.rect(x - 1, y - 1, 1, 1, '#f49ab8'); b.rect(x + 2, y - 1, 1, 1, '#f49ab8'); b.rect(x, y + 1, 2, 1, '#f49ab8'); }
    else if (id === 'fx.petal') b.rect(cx + Math.cos(a + f * 3) * r, cy + Math.sin(a) * r * 0.5 + f * 12, 2, 1, n % 2 ? '#ffc6d9' : '#f49ab8');
    else { const c = ['#e0b94f', '#e5484d', '#5aa0e6', '#7cc48a'][n % 4]!; b.rect(cx + Math.cos(a) * r, cy - 6 + Math.sin(a) * r, 1, 1, c); if (f < 0.6) b.rect(cx + Math.cos(a) * r * 0.6, cy - 6 + Math.sin(a) * r * 0.6, 1, 1, c); }
  }
  if (f < 0.35) b.rect(cx - 2, cy - 2, 4, 4, sk.paper);
}

type BoxFn = (gx: number, gy: number, w: number, d: number, z: number, h: number, top: string, left: string, right: string, edge?: string) => void;
/** 휴게실 가구 — (gx, gy) 칸 왼쪽 위 기준 0.8×0.8 안에 */
function furniture(b: Brush, P: (gx: number, gy: number, z?: number) => Pt, box: BoxFn, sk: Skin, id: string, gx: number, gy: number, t: number) {
  const L = sk.line;
  switch (id) {
    case 'furn.sofa':
      box(gx, gy + 0.25, 0.9, 0.5, 0, 5, '#d9786b', '#b85f53', '#9e4d43', L);
      box(gx, gy + 0.1, 0.9, 0.15, 5, 7, '#c96a5e', '#a65247', '#8e453b', L);
      box(gx - 0.08, gy + 0.25, 0.1, 0.5, 5, 4, '#c96a5e', '#a65247', '#8e453b'); box(gx + 0.88, gy + 0.25, 0.1, 0.5, 5, 4, '#c96a5e', '#a65247', '#8e453b');
      return;
    case 'furn.board': {
      box(gx + 0.1, gy + 0.3, 0.8, 0.06, 6, 18, '#ffffff', '#f4f4f4', '#dddddd', L);
      box(gx + 0.15, gy + 0.3, 0.04, 0.04, 0, 6, L, L, L); box(gx + 0.8, gy + 0.3, 0.04, 0.04, 0, 6, L, L, L);
      b.line(P(gx + 0.2, gy + 0.36, 21), P(gx + 0.55, gy + 0.36, 18), '#e5484d'); b.line(P(gx + 0.25, gy + 0.36, 14), P(gx + 0.75, gy + 0.36, 12), '#5aa0e6');
      return;
    }
    case 'furn.lamp': {
      box(gx + 0.3, gy + 0.3, 0.3, 0.3, 0, 2, L, L, L);
      box(gx + 0.42, gy + 0.42, 0.06, 0.06, 2, 22, '#666666', '#555555', '#444444');
      const [x, y] = P(gx + 0.45, gy + 0.45, 26);
      b.rect(x - 6, y - 5, 12, 6, '#fff1a6'); b.rect(x - 5, y + 1, 10, 1, '#e0b94f');
      if (t % 16 < 12) b.rect(x - 9, y + 3, 18, 1, 'rgba(255,241,166,.45)');
      return;
    }
    case 'furn.vending': {
      box(gx + 0.1, gy + 0.2, 0.6, 0.5, 0, 28, '#e5484d', '#c23a3f', '#a02f33', L);
      const pane = [P(gx + 0.18, gy + 0.7, 25), P(gx + 0.55, gy + 0.7, 25), P(gx + 0.55, gy + 0.7, 9), P(gx + 0.18, gy + 0.7, 9)];
      b.poly(pane, '#bfe5ff');
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) { const [x, y] = P(gx + 0.24 + q * 0.1, gy + 0.7, 22 - r * 5); b.rect(x, y, 2, 2, ['#ffd27a', '#9ef0a4', '#ffc6d9'][(r + q) % 3]!); }
      if (t % 10 < 5) { const [x, y] = P(gx + 0.62, gy + 0.7, 18); b.rect(x, y, 1, 1, '#9ef0a4'); }
      return;
    }
    case 'furn.tank': {
      box(gx + 0.05, gy + 0.3, 0.8, 0.4, 0, 6, sk.deskTop, sk.deskL, sk.deskR, L);
      box(gx + 0.05, gy + 0.3, 0.8, 0.4, 6, 12, '#bfe5ff', '#8fd0ff', '#6ab8ee', L);
      const f = (t % 24) / 24, [x, y] = P(gx + 0.1 + f * 0.7, gy + 0.7, 11);
      b.rect(x, y, 3, 2, '#ff9a3c'); b.rect(x + (f < 0.5 ? -1 : 3), y, 1, 2, '#ff9a3c'); if (t % 6 < 3) b.rect(x + 1, y - 3, 1, 1, '#ffffff');
      return;
    }
    case 'furn.cattower':
      box(gx + 0.05, gy + 0.05, 0.8, 0.8, 0, 3, '#c99e70', '#a97c4e', '#8a6a4a', L);
      box(gx + 0.38, gy + 0.38, 0.14, 0.14, 3, 16, '#e8d9c0', '#cbb89a', '#b3a080');
      box(gx + 0.15, gy + 0.15, 0.6, 0.6, 19, 3, '#c99e70', '#a97c4e', '#8a6a4a', L);
      box(gx + 0.2, gy + 0.2, 0.5, 0.5, 22, 5, '#b8663f', '#9e5634', '#86472b', L);
      return;
    case 'furn.arcade': {
      box(gx + 0.15, gy + 0.2, 0.6, 0.55, 0, 26, '#5b3fa8', '#46308a', '#36256d', L);
      const pane = [P(gx + 0.22, gy + 0.75, 23), P(gx + 0.62, gy + 0.75, 23), P(gx + 0.62, gy + 0.75, 15), P(gx + 0.22, gy + 0.75, 15)];
      b.poly(pane, '#0b1a26');
      const [x, y] = P(gx + 0.3 + (t % 6) * 0.04, gy + 0.75, 20); b.rect(x, y, 2, 2, ['#39f3ff', '#ff4fd8', '#b6ff5c'][t % 3]!);
      box(gx + 0.15, gy + 0.55, 0.6, 0.25, 11, 2, '#2c254c', '#221d3c', '#1b1730');
      return;
    }
    case 'furn.trophy': {
      box(gx + 0.25, gy + 0.25, 0.4, 0.4, 0, 6, '#5a3727', '#4a2c1f', '#3d2419', L);
      const [x, y] = P(gx + 0.45, gy + 0.45, 18);
      b.rect(x - 4, y, 8, 6, '#e0b94f'); b.rect(x - 6, y + 1, 2, 3, '#e0b94f'); b.rect(x + 4, y + 1, 2, 3, '#e0b94f'); b.rect(x - 1, y + 6, 2, 3, '#c99a2e'); b.rect(x - 3, y + 9, 6, 1, '#c99a2e');
      if (t % 10 < 3) b.rect(x - 3, y + 1, 1, 3, '#fff1a6');
      return;
    }
  }
}
