// 할로윈 한정 세트(11/15 23:59 까지 — domain/catalog/halloween) — 방 스킨 14·모자 4·가구 3·창밖 2·조명 2·펑 2·칭호 2·책상 소품 1.
// 스킨 장식(scene)은 'hw-' 로 시작한다. 방은 8칸(휴게실 있으면 10) — 벽 장식은 책장 위 뒤 벽(gx 5.05~7.2, z 27~42)·왼쪽 벽(gy 0.45~2.95 · 4.1~6.6)에만,
// k 가 있는 바닥 장식은 방 앞 왼쪽 모서리(gx 0.2~1.5, gy rows-1.6~rows-0.4). 오른쪽 뒤 벽은 휴게실이 없으면 방 밖이다
import type { Skin } from '../../office/skins';
import { BASE, type Dot, type Pack, type Pz, type R } from './types';

const OR = '#ff8a1f', ORD = '#c95f10', ORL = '#ffb36b', STEM = '#4d7a2f', GLOW = '#ffd84d', FLICK = '#ffb33b';
const BAT = '#1c1424', RED = '#ff3b3b', BONE = '#f2ecdc', GHOST = '#eef4ff', GHOST_EYE = '#2a2a40', WEB = 'rgba(232,232,244,.7)';

/** 칸 → 정수 점 */
const Q = (P: Pz, gx: number, gy: number, z = 0): [number, number] => { const [x, y] = P(gx, gy, z); return [Math.round(x), Math.round(y)]; };
/** 글자 도트 — '.' 는 비우고 나머지 글자는 pal 색 */
function spr(b: R, x: number, y: number, rows: string[], pal: Record<string, string>) {
  rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const col = pal[row[c]!]; if (col) b.rect(x + c, y + r, 1, 1, col); } });
}
/** 화소 선(거미줄·빗자루) */
function seg(b: R, x0: number, y0: number, x1: number, y1: number, c: string) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) b.rect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
}
/** 둥근 판(달·창) — 가로줄로 */
function disc(b: R, cx: number, cy: number, r: number, c: string) {
  for (let dy = -r; dy <= r; dy++) { const h = Math.round(Math.sqrt(r * r - dy * dy)); b.rect(cx - h, cy + dy, h * 2 + 1, 1, c); }
}

/** 호박 — (cx, by) = 바닥 가운데, w 는 홀수. lit 을 주면 얼굴을 파서 불빛이 깜빡인다(lit = t + 자리마다 다른 값) */
function pumpkin(b: R, cx: number, by: number, w: number, h: number, lit?: number) {
  const x = cx - (w - 1) / 2, y = by - h;
  b.rect(x + 1, y, w - 2, h, OR); b.rect(x, y + 1, w, h - 2, OR);
  if (w >= 7) { const r = Math.floor(w / 3); b.rect(x + r, y + 1, 1, h - 3, ORD); b.rect(x + w - 1 - r, y + 1, 1, h - 3, ORD); b.rect(x + 1, y + 1, 1, 2, ORL); }
  b.rect(x + 1, y + h - 1, w - 2, 1, ORD);
  if (w >= 9) { b.rect(cx, y - 2, 1, 2, STEM); b.rect(cx + 1, y - 2, 2, 1, STEM); } else b.rect(cx, y - 1, 1, 1, STEM);
  if (lit === undefined) return;
  const g = lit % 12 < 9 ? GLOW : FLICK;
  if (w >= 9) { b.rect(cx - 3, y + 2, 2, 2, g); b.rect(cx + 2, y + 2, 2, 2, g); b.rect(cx - 3, y + h - 4, 7, 2, g); b.rect(cx - 1, y + h - 4, 1, 1, OR); b.rect(cx + 1, y + h - 3, 1, 1, OR); }
  else if (w >= 7) { b.rect(cx - 2, y + 1, 1, 1, g); b.rect(cx + 2, y + 1, 1, 1, g); b.rect(cx - 2, y + h - 3, 5, 1, g); }
  else { b.rect(cx - 1, y + 1, 1, 1, g); b.rect(cx + 1, y + 1, 1, 1, g); b.rect(cx - 1, y + 2, 3, 1, g); }
}

// 작은 도트들
const BAT_UP = ['#.......#', '##.#.#.##', '.##e#e##.', '...###...'];
const BAT_DN = ['...#.#...', '..#e#e#..', '.#######.', '##.....##'];
/** 박쥐 9×4 — (cx, cy) = 가운데, up = 날개 든 장 */
const bat = (b: R, cx: number, cy: number, up: boolean, c = BAT, eye = c) => spr(b, cx - 4, cy - 2, up ? BAT_UP : BAT_DN, { '#': c, e: eye });
const GHOST_S = ['..###..', '.#####.', '#######', '##e#e##', '##e#e##', '###o###', '#######', '#.#.#.#'];
/** 유령 7×8 — (x, y) = 왼쪽 위 */
const ghost = (b: R, x: number, y: number, c = GHOST, eye = GHOST_EYE) => spr(b, x, y, GHOST_S, { '#': c, e: eye, o: eye });
const CAT_A = ['.#...#..', '.#####..', '.#e#e#..', '.#####..', '..###...', '.#####.#', '######.#', '######.#', '########'];
const CAT_B = ['.#...#..', '.#####..', '.#e#e#..', '.#####..', '..###...', '.#####..', '######..', '######.#', '########'];
const SPIDER = ['#.###.#', '.#####.', '##e#e##', '#.###.#'];
const CORN = ['..w..', '.www.', '.ooo.', 'ooooo', 'yyyyy'];
const CORN_PAL = { w: '#fffaf0', o: OR, y: '#ffd84d' };

/** 비석 — (cx, by) = 바닥 가운데 */
function tomb(b: R, cx: number, by: number) {
  const x = cx - 3, y = by - 11;
  b.rect(x - 1, by - 2, 9, 2, '#3a2a1e');
  b.rect(x + 1, y, 5, 1, '#9aa0ab'); b.rect(x, y + 1, 7, 9, '#9aa0ab'); b.rect(x + 6, y + 1, 1, 9, '#6f7580');
  b.rect(x + 2, y + 3, 3, 1, '#5f6570'); b.rect(x + 2, y + 5, 3, 1, '#5f6570'); b.rect(x, y + 8, 2, 2, '#4d7a2f');
}
/** 마녀 솥 — (x, y) = 바닥 가운데. 초록 물약이 끓고 거품이 오른다 */
function cauldron(b: R, x: number, y: number, t: number) {
  b.rect(x - 7, y - 2, 14, 2, '#5a3727'); b.rect(x - 6, y - 2, 1, 2, '#3f2618'); b.rect(x + 3, y - 2, 1, 2, '#3f2618');
  const f = t % 4;
  b.rect(x - 4, y - 5, 8, 3, '#ff6b3b'); b.rect(x - 3 + (f % 2) * 2, y - 5, 2, 2, GLOW); b.rect(x + 1 - (f % 2), y - 4, 2, 2, '#ff9a3c');
  b.rect(x - 6, y - 5, 2, 3, '#1f1a24'); b.rect(x + 4, y - 5, 2, 3, '#1f1a24');
  b.rect(x - 6, y - 15, 12, 9, '#1f1a24'); b.rect(x - 7, y - 13, 14, 5, '#1f1a24'); b.rect(x - 5, y - 6, 10, 1, '#1f1a24');
  b.rect(x - 5, y - 12, 1, 4, '#3a3344');
  b.rect(x - 7, y - 16, 14, 2, '#3a3344');
  const brew = t % 16 < 8 ? '#7cf05a' : '#6ae04a';
  b.rect(x - 5, y - 17, 10, 1, brew); b.rect(x - 2 + (f > 1 ? 1 : 0), y - 17, 2, 1, '#c9ff9a');
  for (let k = 0; k < 4; k++) {
    const ph = (t + k * 5) % 20;
    if (ph < 14) { const s = ph < 7 ? 2 : 1; b.rect(x - 4 + k * 3 + (ph % 6 < 3 ? 0 : 1), y - 19 - ph, s, s, ph < 10 ? '#9ef05a' : 'rgba(158,240,90,.5)'); }
  }
}
/** 물약 병 — (x, by) = 선반 위 바닥 가운데, kind 0 둥근 플라스크 · 1 긴 병 · 2 세모 플라스크 */
function potion(b: R, x: number, by: number, kind: number, liquid: string, t: number) {
  const glass = '#cfe8e8', glint = t % 16 < 4 ? '#ffffff' : liquid;
  if (kind === 0) { b.rect(x - 1, by - 9, 3, 1, '#a07a4a'); b.rect(x, by - 8, 1, 2, glass); b.rect(x - 2, by - 6, 5, 6, liquid); b.rect(x - 3, by - 5, 7, 4, liquid); b.rect(x - 1, by - 5, 1, 1, glint); }
  else if (kind === 1) { b.rect(x, by - 12, 1, 1, '#a07a4a'); b.rect(x, by - 11, 1, 2, glass); b.rect(x - 1, by - 9, 3, 9, liquid); b.rect(x - 1, by - 8, 1, 2, glint); }
  else { b.rect(x, by - 8, 1, 3, glass); b.rect(x - 1, by - 5, 3, 1, liquid); b.rect(x - 2, by - 4, 5, 2, liquid); b.rect(x - 3, by - 2, 7, 2, liquid); b.rect(x - 1, by - 3, 1, 1, glint); }
}
/** 촛대(세 갈래) — (x, y) = 받침 바닥 가운데 */
function candelabra(b: R, x: number, y: number, t: number, k: number) {
  const G = '#c9a66a', GD = '#8a6a3a';
  b.rect(x - 3, y - 1, 7, 1, GD); b.rect(x, y - 9, 1, 8, G); b.rect(x - 4, y - 9, 9, 1, G); b.rect(x - 4, y - 11, 1, 2, G); b.rect(x + 4, y - 11, 1, 2, G);
  for (const dx of [-4, 0, 4]) {
    const top = dx === 0 ? y - 15 : y - 14;
    b.rect(x + dx, top, 1, dx === 0 ? 6 : 3, '#f4ecd8');
    b.rect(x + dx - 1, top - 3, 3, 3, 'rgba(255,200,90,.25)');
    b.rect(x + dx, top - 2, 1, 2, (t + k + dx) % 3 === 0 ? GLOW : '#ff9a3c');
  }
}
/** 해골 — (cx, by) = 발 가운데, pose 0..3(팔 만세·팔 휘두름 × 다리 섬·발차기). 뼈마다 선 색 테두리를 먼저 깔아 밝은 바닥에서도 보이게 */
function skeleton(b: R, cx: number, by: number, pose: number, line: string) {
  const y = by - 16;
  const parts: [number, number, number, number][] = [[cx - 2, y, 5, 4], [cx - 1, y + 4, 3, 1], [cx, y + 5, 1, 6], [cx - 3, y + 6, 7, 1], [cx - 2, y + 8, 5, 1], [cx - 2, y + 11, 5, 1]];
  if (pose % 2 === 0) parts.push([cx - 4, y + 2, 1, 5], [cx + 4, y + 2, 1, 5]);
  else parts.push([cx - 5, y + 6, 2, 1], [cx - 6, y + 7, 1, 3], [cx + 4, y + 6, 2, 1], [cx + 6, y + 3, 1, 4]);
  if (pose < 2) parts.push([cx - 2, y + 12, 1, 4], [cx + 2, y + 12, 1, 4], [cx - 3, y + 15, 1, 1], [cx + 3, y + 15, 1, 1]);
  else parts.push([cx - 2, y + 12, 1, 4], [cx - 3, y + 15, 1, 1], [cx + 2, y + 12, 3, 1], [cx + 5, y + 10, 1, 3]);
  for (const [x, yy, w, h] of parts) b.rect(x - 1, yy - 1, w + 2, h + 2, line);
  for (const [x, yy, w, h] of parts) b.rect(x, yy, w, h, BONE);
  b.rect(cx - 1, y + 1, 1, 2, line); b.rect(cx + 1, y + 1, 1, 2, line);
}
/** 깃발 — (x, y) = 막대 가운데 위. 가운데 금빛 박쥐 */
function banner(b: R, x: number, y: number) {
  const C = '#9a1020';
  b.rect(x - 5, y, 11, 1, '#e0b94f'); b.rect(x - 4, y + 1, 9, 18, C); b.rect(x - 4, y + 19, 4, 2, C); b.rect(x + 1, y + 19, 4, 2, C);
  b.rect(x - 4, y + 2, 9, 1, '#7a0c18'); b.rect(x - 4, y + 17, 9, 1, '#e0b94f');
  bat(b, x, y + 9, true, '#e0b94f', '#e0b94f');
}
/** 횃불 — (x, y) = 받침 */
function torch(b: R, x: number, y: number, t: number, k: number) {
  b.rect(x - 5, y - 13, 11, 10, 'rgba(255,150,50,.12)'); b.rect(x - 3, y - 11, 7, 7, 'rgba(255,170,60,.16)');
  b.rect(x - 1, y, 3, 2, '#3a3344'); b.rect(x - 1, y - 4, 3, 5, '#6a4a2a'); b.rect(x - 2, y - 6, 5, 2, '#3a3344');
  const f = (t + k) % 3;
  b.rect(x - 1, y - 9, 3, 3, '#ff6b3b'); b.rect(x - 1 + (f === 1 ? 1 : 0), y - 11, 2, 2, '#ff9a3c'); b.rect(x + (f === 2 ? -1 : 0), y - 12 - (f === 0 ? 1 : 0), 1, 2, GLOW); b.rect(x, y - 8, 1, 2, GLOW);
}

// ── 창밖 — 창이 비스듬해서(오른쪽으로 갈수록 내려감) 화소 단위로 놓는 도우미. 창 가로 ≈ 38.9px, 세로 25px(ui/office/draw 창 크기) ──
const WU = 38.88, WV = 25;
const at = (dot: Dot, uc: number, vc: number) => (X: number, Y: number, w: number, h: number, c: string) => dot(uc + X / WU, vc + (Y - X / 2) / WV, w / 2, h / 2, c);

/** 스킨 = 나무 색 묶음을 펼쳐 덮고 장식을 붙인다 */
const S = (ko: string, en: string, o: Partial<Skin>, scene: string[]) => ({ skin: { ...BASE, ...o, scene }, ko, en });

export const HALLOWEEN: Pack = {
  hat: {
    witch: (b, x, y) => {
      b.rect(x - 1, y + 2, 19, 1, '#2a1c3a');
      b.rect(x + 4, y - 1, 9, 3, '#3a2a55'); b.rect(x + 4, y + 1, 9, 1, OR); b.rect(x + 8, y + 1, 1, 1, GLOW);
      b.rect(x + 5, y - 3, 7, 2, '#3a2a55'); b.rect(x + 6, y - 5, 4, 2, '#3a2a55'); b.rect(x + 9, y - 6, 3, 1, '#3a2a55');
      b.rect(x + 5, y - 1, 1, 2, '#54407a');
    },
    pumpkinhead: (b, x, y) => {
      b.rect(x + 7, y - 3, 2, 2, STEM); b.rect(x + 9, y - 3, 2, 1, '#6aa04a');
      b.rect(x + 2, y - 1, 12, 1, OR); b.rect(x + 1, y, 14, 1, OR); b.rect(x, y + 1, 16, 7, OR); b.rect(x + 1, y + 8, 14, 1, OR); b.rect(x + 2, y + 9, 12, 1, ORD);
      b.rect(x + 5, y, 1, 8, ORD); b.rect(x + 10, y, 1, 8, ORD); b.rect(x + 2, y + 1, 2, 1, ORL);
      b.rect(x + 3, y + 3, 3, 1, GLOW); b.rect(x + 4, y + 2, 1, 1, GLOW); b.rect(x + 10, y + 3, 3, 1, GLOW); b.rect(x + 11, y + 2, 1, 1, GLOW);
      b.rect(x + 3, y + 6, 10, 1, GLOW); b.rect(x + 4, y + 7, 8, 1, GLOW); b.rect(x + 6, y + 6, 1, 1, OR); b.rect(x + 9, y + 7, 1, 1, OR);
    },
    horns: (b, x, y) => {
      const R1 = '#d9342b', R2 = '#a3231c';
      b.rect(x + 3, y + 2, 11, 1, '#3a1418');
      b.rect(x + 3, y, 3, 2, R1); b.rect(x + 2, y - 2, 2, 2, R1); b.rect(x + 1, y - 3, 1, 1, R2); b.rect(x + 5, y + 1, 1, 1, R2);
      b.rect(x + 11, y, 3, 2, R1); b.rect(x + 13, y - 2, 2, 2, R1); b.rect(x + 15, y - 3, 1, 1, R2); b.rect(x + 11, y + 1, 1, 1, R2);
      b.rect(x + 4, y, 1, 1, '#ff8a7a'); b.rect(x + 12, y, 1, 1, '#ff8a7a');
    },
    batband: (b, x, y) => {
      b.rect(x + 3, y + 2, 11, 1, BAT);
      b.rect(x + 7, y, 3, 2, BAT); b.rect(x + 7, y - 1, 1, 1, BAT); b.rect(x + 9, y - 1, 1, 1, BAT); b.rect(x + 7, y, 1, 1, RED); b.rect(x + 9, y, 1, 1, RED);
      b.rect(x + 2, y, 5, 1, BAT); b.rect(x + 3, y + 1, 4, 1, BAT); b.rect(x + 1, y - 1, 2, 1, BAT);
      b.rect(x + 10, y, 5, 1, BAT); b.rect(x + 10, y + 1, 4, 1, BAT); b.rect(x + 14, y - 1, 2, 1, BAT);
    },
  },

  furn: {
    pumpkins: {
      icon: (b) => { pumpkin(b, 12, 18, 13, 10, 0); pumpkin(b, 4, 19, 7, 6); pumpkin(b, 20, 19, 7, 6, 5); },
      room: (b, P, _box, _sk, gx, gy, t) => {
        const [x, y] = Q(P, gx + 0.4, gy + 0.45);
        b.rect(x - 11, y - 12, 22, 14, 'rgba(255,150,40,.12)');
        pumpkin(b, x, y, 11, 8, t); pumpkin(b, x - 7, y + 3, 7, 6, t + 5); pumpkin(b, x + 6, y + 4, 5, 4);
      },
    },
    cauldron: {
      icon: (b) => {
        b.rect(4, 18, 16, 2, '#5a3727'); b.rect(8, 16, 8, 2, '#ff9a3c'); b.rect(10, 16, 3, 2, GLOW); b.rect(6, 15, 2, 3, '#1f1a24'); b.rect(16, 15, 2, 3, '#1f1a24');
        b.rect(5, 6, 14, 9, '#1f1a24'); b.rect(4, 7, 16, 7, '#1f1a24'); b.rect(6, 15, 12, 1, '#1f1a24'); b.rect(6, 8, 1, 5, '#3a3344');
        b.rect(3, 5, 18, 2, '#3a3344'); b.rect(5, 3, 14, 2, '#7cf05a'); b.rect(8, 3, 3, 1, '#c9ff9a');
        b.rect(8, 1, 2, 2, '#9ef05a'); b.rect(14, 0, 1, 1, '#9ef05a'); b.rect(12, 2, 1, 1, '#c9ff9a');
      },
      room: (b, P, _box, _sk, gx, gy, t) => { const [x, y] = Q(P, gx + 0.45, gy + 0.5); cauldron(b, x, y, t); },
    },
    coffin: {
      icon: (b) => {
        const shape = (dx: number, c: string) => { b.rect(8 + dx, 2, 8, 1, c); b.rect(7 + dx, 3, 10, 2, c); b.rect(6 + dx, 5, 12, 4, c); b.rect(7 + dx, 9, 10, 5, c); b.rect(8 + dx, 14, 8, 6, c); };
        shape(0, '#12060a'); b.rect(7, 6, 1, 1, RED); b.rect(9, 6, 1, 1, RED);
        shape(4, '#5a2a3c'); b.rect(12, 4, 8, 1, '#7a3f52'); b.rect(15, 8, 2, 3, '#e0b94f'); b.rect(14, 9, 4, 1, '#e0b94f');
        bat(b, 4, 2, true, BAT, RED);
      },
      room: (b, P, box, sk, gx, gy, t) => {
        const ph = t % 64, open = ph >= 40 && ph < 60;
        box(gx + 0.22, gy + 0.32, 0.42, 0.26, 0, 28, '#4a2533', '#3a1c28', '#2a1418', sk.line);
        if (!open) {
          box(gx + 0.25, gy + 0.58, 0.36, 0.03, 2, 24, '#6a3446', '#5a2a3c', '#4a2232');
          const [x, y] = Q(P, gx + 0.43, gy + 0.61, 18); b.rect(x - 1, y, 3, 3, '#e0b94f');
        } else {
          box(gx + 0.25, gy + 0.575, 0.36, 0.01, 2, 24, '#12060a', '#12060a', '#12060a');
          const [x, y] = Q(P, gx + 0.43, gy + 0.59, 21); b.rect(x - 2, y, 1, 1, RED); b.rect(x + 2, y, 1, 1, RED);
          box(gx + 0.61, gy + 0.58, 0.03, 0.3, 2, 24, '#6a3446', '#5a2a3c', '#4a2232');
          for (let k = 0; k < 2; k++) {
            const f = (ph - 40 - k * 6) / 14;
            if (f > 0) { const [bx, by] = Q(P, gx + 0.43 + (k ? 0.4 : -0.3) * f, gy + 0.6, 24 + f * 18); bat(b, bx, by, (t + k) % 2 === 0, BAT, RED); }
          }
        }
      },
    },
  },

  window: {
    bloodmoon: {
      sky: '#2a0a18',
      icon: (b) => {
        disc(b, 15, 6, 3, '#d42a35'); b.rect(14, 5, 1, 1, '#a81c28'); b.rect(16, 7, 2, 1, '#a81c28');
        b.rect(3, 8, 7, 1, '#4a1424'); b.rect(5, 7, 3, 1, '#4a1424'); b.rect(13, 11, 7, 1, '#4a1424');
        b.rect(2, 13, 20, 3, '#14060c'); b.rect(4, 12, 5, 1, '#14060c'); b.rect(15, 11, 4, 2, '#14060c'); b.rect(6, 4, 3, 1, '#14060c'); b.rect(7, 5, 1, 1, '#14060c');
      },
      scene: (t, dot) => {
        const m = at(dot, 0.68, 0.36), a = (0.18 + 0.1 * Math.sin(t / 8)).toFixed(2);
        for (let dy = -7; dy <= 7; dy++) { const h = Math.round(Math.sqrt(49 - dy * dy)); m(-h, dy, h * 2 + 1, 1, `rgba(255,70,70,${a})`); }
        for (let dy = -5; dy <= 5; dy++) { const h = Math.round(Math.sqrt(25 - dy * dy)); m(-h, dy, h * 2 + 1, 1, '#d42a35'); }
        m(-3, -2, 2, 2, '#a81c28'); m(1, 1, 3, 2, '#a81c28'); m(-1, 3, 2, 1, '#a81c28');
        for (let k = 0; k < 3; k++) { const c = at(dot, 0.12 + ((k * 0.31 + t * 0.004) % 0.72), 0.5 + k * 0.12); c(-6, 0, 12, 2, '#3a1020'); c(-3, -1, 6, 1, '#3a1020'); }
        for (let u = 0.02; u < 0.97; u += 0.05) dot(u, 0.84 - Math.abs(Math.sin(u * 9)) * 0.06, 1.5, 2.5, '#14060c'); // 언덕은 창 밑변을 따라(기울기 그대로)
        const ph = (t % 60) / 60;
        if (ph < 0.5) { const f = at(dot, 0.1 + ph * 1.6, 0.25 + Math.sin(t / 3) * 0.02), up = t % 4 < 2; f(-1, 0, 2, 2, '#14060c'); f(-4, up ? -1 : 1, 3, 1, '#14060c'); f(2, up ? -1 : 1, 3, 1, '#14060c'); }
      },
    },
    batswarm: {
      sky: '#3a2a55',
      icon: (b) => {
        b.rect(16, 3, 4, 4, '#fff1c2'); b.rect(15, 4, 6, 2, '#fff1c2');
        for (const [x, y] of [[5, 4], [9, 7], [6, 12], [14, 10], [18, 13], [13, 5], [3, 8]] as const) { b.rect(x - 2, y, 5, 1, '#120c1c'); b.rect(x, y + 1, 1, 1, '#120c1c'); b.rect(x - 2, y - 1, 1, 1, '#120c1c'); b.rect(x + 2, y - 1, 1, 1, '#120c1c'); }
        b.rect(2, 14, 20, 2, '#1f1630');
      },
      scene: (t, dot) => {
        const m = at(dot, 0.82, 0.2);
        for (let dy = -3; dy <= 3; dy++) { const h = Math.round(Math.sqrt(9 - dy * dy)); m(-h, dy, h * 2 + 1, 1, '#fff1c2'); }
        for (let k = 0; k < 8; k++) {
          const u = 0.1 + ((k * 0.29 + t * 0.006 * (1 + (k % 3) * 0.3)) % 0.78), v = 0.25 + ((k * 0.37) % 0.55) + Math.sin(t / 4 + k) * 0.03;
          const f = at(dot, u, v), up = (t + k) % 4 < 2;
          f(-1, 0, 2, 2, '#120c1c'); f(-4, up ? -1 : 1, 3, 1, '#120c1c'); f(2, up ? -1 : 1, 3, 1, '#120c1c');
        }
        for (let u = 0.02; u < 0.97; u += 0.05) dot(u, 0.9, 1.5, 1.5, '#1f1630');
      },
    },
  },

  light: {
    floatcandles: {
      icon: (b) => {
        b.rect(2, 17, 20, 2, '#8a6a4a'); b.rect(4, 19, 16, 1, '#5a3727');
        for (const [x, top] of [[4, 9], [10, 5], [16, 11]] as const) {
          b.rect(x, top, 4, 17 - top, '#f4ecd8'); b.rect(x + 3, top, 1, 17 - top, '#d8ccb0'); b.rect(x - 1, top + 1, 1, 2, '#f4ecd8');
          b.rect(x + 1, top - 1, 1, 1, '#3a2a1e'); b.rect(x + 1, top - 4, 2, 3, FLICK); b.rect(x + 1, top - 3, 1, 2, GLOW); b.rect(x + 2, top - 5, 1, 1, '#ff9a3c');
        }
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(255,150,60,.06)');
        const pts: [number, number][] = [];
        for (let g = 0.7; g < cols - 0.3; g += 1.5) pts.push([g, 0.3]);
        for (let g = 1.4; g < rows - 0.3; g += 1.5) pts.push([0.3, g]);
        pts.forEach(([gx, gy], k) => {
          const [x, y0] = Q(P, gx, gy, 36), y = y0 + Math.round(Math.sin((t + k * 5) / 6));
          b.rect(x - 2, y - 5, 5, 5, 'rgba(255,210,110,.22)');
          b.rect(x - 1, y, 3, 5, '#f4ecd8'); b.rect(x + 1, y + 1, 1, 4, '#d8ccb0'); b.rect(x, y - 1, 1, 1, '#3a2a1e');
          const f = (t + k) % 4;
          b.rect(x, y - 3, 1, 2, f < 2 ? GLOW : FLICK); b.rect(x + (f === 1 ? 1 : f === 3 ? -1 : 0), y - 4, 1, 1, '#ff9a3c');
        });
      },
    },
    jacklights: {
      icon: (b) => {
        const wy = (x: number) => 3 + Math.round(Math.abs(Math.sin(x / 3.5)) * 3);
        for (let x = 1; x < 23; x++) b.rect(x, wy(x), 1, 1, '#5a4a3a');
        for (const x of [3, 9, 15, 21]) { b.rect(x, wy(x) + 1, 1, 7 - wy(x), '#5a4a3a'); pumpkin(b, x, 13, 5, 4, 0); } // 줄 끝을 철사 맨 아래(6)보다 내려 칸 틈이 안 생기게
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(255,120,30,.07)');
        const z = (g: number) => 42 - Math.abs(Math.sin((g * Math.PI) / 0.9)) * 3;
        for (let g = 0.1; g < cols - 0.1; g += 0.08) { const [x, y] = Q(P, g, 0, z(g)); b.rect(x, y, 1, 1, '#3a2a1e'); }
        for (let g = 0.1; g < rows - 0.1; g += 0.08) { const [x, y] = Q(P, 0, g, z(g)); b.rect(x, y, 1, 1, '#3a2a1e'); }
        let k = 0;
        for (let g = 0.9; g < cols - 0.3; g += 0.9) { const [x, y] = Q(P, g, 0, 42); pumpkin(b, x, y + 6, 5, 4, t + k++ * 3); }
        for (let g = 0.9; g < rows - 0.3; g += 0.9) { const [x, y] = Q(P, 0, g, 42); pumpkin(b, x, y + 6, 5, 4, t + k++ * 3); }
      },
    },
  },

  fx: {
    bats: {
      icon: (b) => { bat(b, 12, 4, true, BAT, RED); bat(b, 5, 10, false, BAT, RED); bat(b, 19, 11, true, BAT, RED); b.rect(9, 15, 6, 3, '#5a3a6a'); b.rect(10, 14, 4, 1, '#5a3a6a'); },
      burst: (b, P, _sk, gx, gy, f) => {
        const [cx, cy] = Q(P, gx, gy, 8);
        if (f < 0.3) { const s = Math.round(8 + f * 20); b.rect(cx - Math.round(s / 2), cy - Math.round(s / 3), s, Math.round(s / 1.5), 'rgba(60,30,80,.55)'); }
        if (f < 0.95) for (let n = 0; n < 7; n++) {
          const a = -Math.PI / 2 + (n - 3) * 0.45, r = 3 + f * 22;
          bat(b, Math.round(cx + Math.cos(a) * r * 1.3), Math.round(cy + Math.sin(a) * r - f * 6), (n + Math.floor(f * 16)) % 2 === 0, BAT, RED);
        }
      },
    },
    ghosts: {
      icon: (b) => { ghost(b, 3, 7); ghost(b, 10, 2); ghost(b, 16, 9); },
      burst: (b, P, sk, gx, gy, f) => {
        const [cx, cy] = Q(P, gx, gy, 8);
        if (f < 0.25) { const s = Math.round(8 + f * 24); b.rect(cx - Math.round(s / 2), cy - Math.round(s / 3), s, Math.round(s / 1.5), sk.paper); }
        const a = (Math.max(0, 1 - f) * 0.8 + 0.15).toFixed(2);
        for (let n = 0; n < 3; n++) {
          const x = cx - 13 + n * 10 + Math.round(Math.sin(f * 8 + n * 2) * 2), y = cy - 10 - Math.round(f * 20) - (n % 2) * 4;
          ghost(b, x, y, `rgba(238,244,255,${a})`, `rgba(42,42,64,${a})`);
        }
      },
    },
  },

  title: { pumpkinboss: '#ff8a1f', candybug: '#8a4fff' },

  desk: {
    candybowl: {
      icon: (b) => {
        b.rect(3, 3, 1, 8, '#3a3344'); b.rect(20, 3, 1, 8, '#3a3344'); b.rect(4, 2, 16, 1, '#3a3344');
        b.rect(6, 6, 3, 3, '#e5484d'); b.rect(9, 5, 3, 4, '#7cc48a'); b.rect(12, 6, 3, 3, '#a77be0'); b.rect(15, 6, 3, 3, GLOW); b.rect(5, 7, 1, 1, '#e5484d'); b.rect(18, 7, 1, 1, GLOW);
        b.rect(5, 9, 14, 10, OR); b.rect(4, 10, 16, 8, OR); b.rect(5, 18, 14, 1, ORD); b.rect(5, 9, 14, 1, ORL);
        b.rect(7, 11, 2, 2, '#3a1f0a'); b.rect(15, 11, 2, 2, '#3a1f0a'); b.rect(8, 15, 8, 1, '#3a1f0a'); b.rect(9, 16, 6, 1, '#3a1f0a'); b.rect(11, 15, 1, 1, OR);
      },
      prop: (b, x, y, t, typing) => {
        b.rect(x - 3, y - 7, 2, 2, '#e5484d'); b.rect(x - 1, y - 8, 2, 3, '#7cc48a'); b.rect(x + 1, y - 7, 3, 2, '#a77be0');
        b.rect(x - 3, y - 5, 7, 5, OR); b.rect(x - 4, y - 4, 9, 3, OR); b.rect(x - 3, y - 1, 7, 1, ORD);
        b.rect(x - 2, y - 4, 1, 1, '#3a1f0a'); b.rect(x + 2, y - 4, 1, 1, '#3a1f0a'); b.rect(x - 1, y - 2, 3, 1, '#3a1f0a');
        b.rect(x - 4, y - 9, 1, 4, '#3a3344'); b.rect(x + 4, y - 9, 1, 4, '#3a3344'); b.rect(x - 3, y - 10, 7, 1, '#3a3344');
        if (typing) { const k = t % 4; b.rect(x + (k % 2), y - 11 - (k < 2 ? k : 3 - k), 1, 1, ['#e5484d', GLOW, '#a77be0', '#7cc48a'][k]!); }
      },
    },
  },

  scene: {
    // ── 벽(캐릭터 뒤) ──
    'hw-webs': {
      draw: (b, P) => {
        const web = (x0: number, y0: number, dirs: [number, number][]) => {
          for (const [dx, dy] of dirs) seg(b, x0, y0, x0 + dx, y0 + dy, WEB);
          for (const f of [0.35, 0.65, 0.95]) for (let i = 0; i + 1 < dirs.length; i++) { const [ax, ay] = dirs[i]!, [bx, by] = dirs[i + 1]!; seg(b, x0 + ax * f, y0 + ay * f, x0 + bx * f, y0 + by * f + 1, WEB); }
        };
        const [cx, cy] = Q(P, 0, 0, 43);
        web(cx, cy, [[-22, 11], [-14, 16], [-5, 19], [5, 19], [14, 16], [22, 11]]);
        const [hx, hy] = Q(P, 4.65, 0, 43);
        web(hx, hy, [[-12, -5], [-7, 7], [1, 11], [8, 9], [12, 6]]);
      },
    },
    'hw-spider': {
      draw: (b, P, _sk, t) => {
        for (const [gx, gy, ph, d] of [[6.4, 0, 0, 6], [0, 5.2, 9, 12]] as const) {
          const [x, top] = Q(P, gx, gy, 43), drop = d + Math.round((Math.sin((t + ph) / 7) + 1) * 4); // 책장 위는 짧게(책장 꼭대기 z 24 위에서 멈춤)
          for (let k = 1; k < drop; k++) b.rect(x, top + k, 1, 1, WEB);
          spr(b, x - 3, top + drop, SPIDER, { '#': '#1a1420', e: RED });
        }
      },
    },
    'hw-bats': {
      draw: (b, P, _sk, t, cols, rows) => {
        for (let k = 0; k < 4; k++) { const [x, y] = Q(P, 0.6 + ((t * 0.035 + k * 2.3) % (cols - 1.4)), 0, 31 + Math.round(Math.sin(t / 5 + k * 1.7) * 5)); bat(b, x, y, (t + k) % 4 < 2, BAT, RED); }
        for (let k = 0; k < 2; k++) { const [x, y] = Q(P, 0, 0.6 + ((t * 0.03 + k * 3.1) % (rows - 1.2)), 28 + Math.round(Math.cos(t / 6 + k) * 5)); bat(b, x, y, (t + k + 1) % 4 < 2, BAT, RED); }
      },
    },
    'hw-moon': {
      draw: (b, P, _sk, t) => {
        const [cx, cy] = Q(P, 6.1, 0, 34), a = (0.14 + 0.08 * Math.sin(t / 8)).toFixed(2);
        disc(b, cx, cy, 10, `rgba(255,60,60,${a})`); disc(b, cx, cy, 9, `rgba(255,60,60,${a})`);
        disc(b, cx, cy, 7, '#d42a35');
        b.rect(cx - 4, cy - 3, 3, 2, '#a81c28'); b.rect(cx + 2, cy + 1, 4, 3, '#a81c28'); b.rect(cx - 2, cy + 4, 2, 1, '#a81c28'); b.rect(cx + 1, cy - 6, 2, 1, '#a81c28');
        b.rect(cx - 6, cy - 2, 1, 4, '#ff6a6a');
      },
    },
    'hw-fog': {
      draw: (b, P, _sk, t, cols, rows) => {
        for (let k = 0; k < 7; k++) {
          const gx = 1.5 + ((k * 1.7 + t * 0.02) % (cols - 3)), gy = 1 + ((k * 2.3) % (rows - 2));
          const [x, y] = Q(P, gx, gy);
          b.rect(x - 18, y, 36, 2, 'rgba(210,215,235,.10)'); b.rect(x - 14, y - 2, 28, 2, 'rgba(210,215,235,.14)'); b.rect(x - 9, y - 4, 18, 2, 'rgba(210,215,235,.10)');
        }
      },
    },
    'hw-vines': {
      draw: (b, P, _sk, t, cols, rows) => {
        const V = '#3f6a2a', L = '#5f9a3f';
        const run = (pt: (g: number) => [number, number], n: number, pumps: number[]) => {
          const wav = (g: number) => Math.round(Math.sin(g * 4) * 1.5);
          for (let g = 0.1; g < n - 0.1; g += 0.09) { const [x, y] = pt(g); b.rect(x, y + wav(g), 1, 1, V); }
          for (let g = 0.4, k = 0; g < n - 0.2; g += 0.7, k++) { const [x, y] = pt(g); b.rect(x - 1, y + wav(g) + 1, 2, 2 + ((Math.floor(t / 6) + k) % 2), L); }
          for (const g of pumps) { const [x, y] = pt(g), yy = y + wav(g); b.rect(x, yy + 1, 1, 3, V); pumpkin(b, x, yy + 8, 5, 4); }
        };
        run((g) => Q(P, g, 0, 42), cols, [5.4, 6.8]);
        run((g) => Q(P, 0, g, 42), rows, [1.6, 5.4]);
      },
    },
    'hw-candycorn': {
      draw: (b, P) => {
        const put = (x: number, y: number, k: number) => spr(b, x - 2, y, k % 2 ? [...CORN].reverse() : CORN, CORN_PAL);
        [5.4, 6.2, 7.0].forEach((g, i) => [31, 39].forEach((z, j) => { const [x, y] = Q(P, g, 0, z); put(x, y, i + j + 1); }));
        [0.7, 1.5, 2.3, 4.5, 5.3, 6.1].forEach((g, i) => [17, 26, 35].forEach((z, j) => { const [x, y] = Q(P, 0, g, z); put(x, y, i + j); }));
      },
    },
    'hw-cats': {
      draw: (b, P, _sk, t) => {
        ([[6.0, 0], [7.2, 0], [0, 2.2]] as const).forEach(([gx, gy], k) => {
          const [x, y] = Q(P, gx, gy, 44), blink = (t + k * 13) % 36 < 2;
          spr(b, x - 4, y - 9, (t + k * 5) % 16 < 8 ? CAT_A : CAT_B, { '#': '#0e0b12', e: blink ? '#0e0b12' : GLOW });
        });
      },
    },
    'hw-eyes': {
      draw: (b, P, _sk, t) => {
        ([[0, 4.8, 30], [0, 5.9, 18], [0, 6.6, 34], [0, 1.2, 22], [5.5, 0, 34], [6.6, 0, 40]] as const).forEach(([gx, gy, z], k) => {
          const ph = (t + k * 11) % 44;
          if (ph > 32 || ph === 5) return;
          const [x, y] = Q(P, gx, gy, z), look = (Math.floor((t + k * 3) / 12) % 3) - 1, c = k % 2 ? GLOW : '#9ef05a';
          b.rect(x, y, 3, 2, c); b.rect(x + 6, y, 3, 2, c); b.rect(x + 1 + look, y, 1, 2, '#0e0b12'); b.rect(x + 7 + look, y, 1, 2, '#0e0b12');
        });
      },
    },
    'hw-broom': {
      draw: (b, P) => {
        const [x0, y0] = Q(P, 0.05, 2.4, 36), [x1, y1] = Q(P, 0.25, 2.75, 9);
        seg(b, x0, y0, x1, y1, '#6a4a2a'); seg(b, x0 + 1, y0, x1 + 1, y1, '#8a6a3a');
        for (let r = 0; r < 9; r++) b.rect(x1 - 2 - Math.floor(r / 2), y1 + r, 5 + 2 * Math.floor(r / 2), 1, r % 3 === 2 ? '#b8903a' : '#d9b35a');
        b.rect(x1 - 2, y1 + 1, 5, 1, '#8a2f3f');
      },
    },
    'hw-herbs': {
      draw: (b, P, _sk, t) => {
        const [ax, ay] = Q(P, 5.1, 0, 41), [bx, by] = Q(P, 7.2, 0, 41);
        seg(b, ax, ay, bx, by, '#6a4a2a');
        [5.4, 5.9, 6.4, 6.9].forEach((g, k) => {
          const [x, y] = Q(P, g, 0, 41), sw = (Math.floor(t / 8) + k) % 2, c = ['#5f9a3f', '#8a6abf', '#9a8a3a', '#4d7a2f'][k]!;
          b.rect(x, y + 1, 1, 3, '#6a4a2a'); b.rect(x - 1 + sw, y + 4, 3, 5, c); b.rect(x - 2 + sw, y + 7, 5, 3, c); b.rect(x - 1, y + 3, 3, 1, '#c9a66a');
        });
      },
    },
    'hw-potions': {
      draw: (b, P, _sk, t) => {
        const LQ = ['#39f3a0', '#c08cff', '#ff6bd6', '#ffcf4f', '#6bd6ff', '#ff5a5a'];
        const shelf = (a: [number, number], c: [number, number], bottles: [number, number][], k0: number) => {
          seg(b, a[0], a[1], c[0], c[1], '#6a4a2a'); seg(b, a[0], a[1] + 1, c[0], c[1] + 1, '#4a321c');
          bottles.forEach(([x, y], k) => potion(b, x, y, (k + k0) % 3, LQ[(k + k0 * 2) % LQ.length]!, t + k * 4 + k0));
        };
        // 책장 위 뒤 벽 한 칸 + 왼쪽 벽 두 칸(시계 양옆)
        shelf(Q(P, 5.1, 0, 29), Q(P, 7.2, 0, 29), [5.35, 5.85, 6.35, 6.85].map((g) => Q(P, g, 0, 29)), 0);
        shelf(Q(P, 0, 0.5, 26), Q(P, 0, 2.9, 26), [0.8, 1.4, 2.0, 2.6].map((g) => Q(P, 0, g, 26)), 1);
        shelf(Q(P, 0, 4.2, 26), Q(P, 0, 6.5, 26), [4.5, 5.1, 5.7, 6.3].map((g) => Q(P, 0, g, 26)), 2);
        const [px, py] = Q(P, 5.35, 0, 29), ph = t % 16;
        if (ph < 5) b.rect(px + (ph % 4 < 2 ? 0 : 1), py - 10 - ph, 1, 1, ph < 3 ? '#9ef0c0' : 'rgba(158,240,192,.5)'); // 벽 위 끝(z 44) 안에서
      },
    },
    'hw-sarcophagus': {
      draw: (b, P, _sk, t) => {
        const [x, y] = Q(P, 0, 2.2, 1), G = '#e0b94f', B = '#2f5aa8', F = '#d9a85a';
        b.rect(x - 4, y - 12, 9, 12, G); b.rect(x - 5, y - 24, 11, 12, G); b.rect(x - 5, y - 31, 11, 7, B);
        for (let r = 0; r < 3; r++) b.rect(x - 5, y - 30 + r * 2, 11, 1, G);
        b.rect(x - 2, y - 31, 5, 7, F); b.rect(x - 1, y - 24, 3, 2, '#3a2a12');
        const glow = t % 64 > 50;
        b.rect(x - 1, y - 28, 1, 1, glow ? RED : '#2a1c0e'); b.rect(x + 1, y - 28, 1, 1, glow ? RED : '#2a1c0e');
        b.rect(x - 5, y - 19, 11, 2, B); b.rect(x - 3, y - 17, 7, 1, '#c99a2e');
        for (let r = 0; r < 3; r++) b.rect(x - 3, y - 11 + r * 3, 7, 1, B);
      },
    },
    'hw-torches': {
      draw: (b, P, _sk, t) => {
        ([[5.5, 0, 30], [6.9, 0, 30], [0, 0.8, 22], [0, 4.6, 22]] as const).forEach(([gx, gy, z], k) => { const [x, y] = Q(P, gx, gy, z); torch(b, x, y, t, k); });
      },
    },
    'hw-ghosts': {
      draw: (b, P, _sk, t) => {
        const spots: [number, number, number][] = [[0, 1.6, 32], [0, 6.3, 26], [5.1 + ((t * 0.02) % 2), 0, 41]];
        spots.forEach(([gx, gy, z], k) => {
          const [x, y] = Q(P, gx, gy, z), bob = Math.round(Math.sin((t + k * 9) / 6) * 2), a = (0.6 + 0.3 * Math.sin((t + k * 7) / 10)).toFixed(2);
          ghost(b, x - 3, y + bob, `rgba(238,244,255,${a})`, GHOST_EYE);
        });
      },
    },
    'hw-porthole': {
      draw: (b, P, _sk, t) => {
        ([[6.1, 0, 35], [0, 5.4, 25]] as const).forEach(([gx, gy, z], k) => {
          const [cx, cy] = Q(P, gx, gy, z);
          disc(b, cx, cy, 7, '#c9a66a'); disc(b, cx, cy, 5, '#0a2a33');
          for (const [dx, dy] of [[0, -6], [6, 0], [0, 6], [-6, 0]] as const) b.rect(cx + dx, cy + dy, 1, 1, '#8a6a3a');
          b.rect(cx - 3, cy - 3, 2, 1, 'rgba(160,255,220,.5)');
          const ph = (t + k * 20) % 64;
          if (ph >= 6 && ph < 22) { b.rect(cx - 2, cy - 2, 5, 5, '#d8fff0'); b.rect(cx - 1, cy - 3, 3, 1, '#d8fff0'); b.rect(cx - 1, cy - 1, 1, 2, '#0a2a33'); b.rect(cx + 1, cy - 1, 1, 2, '#0a2a33'); b.rect(cx, cy + 2, 1, 1, '#0a2a33'); }
        });
      },
    },
    'hw-lanterns': {
      draw: (b, P, _sk, t, cols, rows) => {
        let k = 0;
        for (let g = 0.7; g < cols - 0.3; g += 2) { const [x, y] = Q(P, g, 0, 44); pumpkin(b, x, y, 7, 6, t + k++ * 5); }
        for (let g = 1.5; g < rows - 0.3; g += 2) { const [x, y] = Q(P, 0, g, 44); pumpkin(b, x, y, 7, 6, t + k++ * 7); }
      },
    },
    'hw-portraits': {
      draw: (b, P, _sk, t) => {
        const [x, y] = Q(P, 6.1, 0, 43);
        b.rect(x - 7, y, 15, 19, '#c9a66a'); b.rect(x - 5, y + 2, 11, 15, '#2a1f3a');
        b.rect(x - 3, y + 4, 7, 2, '#3a2a1e'); b.rect(x - 2, y + 5, 5, 5, '#e8dcc8'); b.rect(x - 4, y + 11, 9, 6, '#5a1f2f'); b.rect(x - 1, y + 11, 3, 2, '#e8dcc8');
        const look = [0, 1, 0, -1][Math.floor(t / 10) % 4]!, eye = t % 80 > 72 ? RED : '#1a1420';
        b.rect(x - 1 + look, y + 7, 1, 1, eye); b.rect(x + 1 + look, y + 7, 1, 1, eye);
        const [sx, sy] = Q(P, 0, 5.6, 36);
        b.rect(sx - 5, sy, 11, 13, '#c9a66a'); b.rect(sx - 4, sy + 1, 9, 11, '#1a2238'); b.rect(sx + 1, sy + 3, 3, 3, '#fff6c2'); b.rect(sx - 4, sy + 8, 9, 4, '#0e1420'); b.rect(sx - 2, sy + 7, 3, 1, '#0e1420');
      },
    },
    'hw-candelabra': {
      draw: (b, P, _sk, t) => {
        ([[0, 2.6, 18], [0, 4.5, 18]] as const).forEach(([gx, gy, z], k) => { const [x, y] = Q(P, gx, gy, z); candelabra(b, x, y, t, k); });
      },
    },
    'hw-banners': {
      draw: (b, P) => {
        ([[5.5, 0, 42], [6.9, 0, 42], [0, 1.2, 41], [0, 6.0, 41]] as const).forEach(([gx, gy, z]) => { const [x, y] = Q(P, gx, gy, z); banner(b, x, y); });
      },
    },
    // ── 바닥(방 앞 왼쪽 모서리 — 앞에 아무것도 없어 깊이는 맨 뒤로) ──
    'hw-pumpkins': {
      k: 50,
      draw: (b, P, _sk, t, _cols, rows) => {
        const [x, y] = Q(P, 0.7, rows - 1.1);
        b.rect(x - 13, y - 13, 26, 18, 'rgba(255,150,40,.12)');
        pumpkin(b, x, y, 11, 8, t); pumpkin(b, x - 8, y + 4, 7, 6, t + 4); pumpkin(b, x + 7, y + 5, 7, 6, t + 8); pumpkin(b, x - 1, y + 7, 5, 4);
      },
    },
    'hw-cauldron': {
      k: 50,
      draw: (b, P, _sk, t, _cols, rows) => { const [x, y] = Q(P, 0.6, rows - 0.8); b.rect(x - 9, y - 1, 18, 2, 'rgba(0,0,0,.25)'); cauldron(b, x, y, t); },
    },
    'hw-tombs': {
      k: 50,
      draw: (b, P, _sk, t, _cols, rows) => {
        const [ax, ay] = Q(P, 0.35, rows - 1.5), [bx, by] = Q(P, 1.05, rows - 1.2);
        tomb(b, ax, ay); tomb(b, bx, by);
        const ph = t % 48, [hx, hy] = Q(P, 0.55, rows - 0.6);
        if (ph < 20) {
          const up = Math.min(ph, 20 - ph, 6);
          if (up > 0) { b.rect(hx, hy - up, 2, up, '#7aa05a'); b.rect(hx - 1, hy - up - 2, 4, 2, '#7aa05a'); b.rect(hx - 1, hy - up - 4, 1, 2, '#7aa05a'); b.rect(hx + 1, hy - up - 4, 1, 2, '#7aa05a'); b.rect(hx + 2, hy - up - 3, 1, 1, '#7aa05a'); }
          b.rect(hx - 2, hy, 6, 1, '#3a2a1e');
        }
        const [cx, cy] = Q(P, 1.0, rows - 0.4); tomb(b, cx, cy);
      },
    },
    'hw-dancers': {
      k: 50,
      draw: (b, P, sk, t, _cols, rows) => {
        ([[0.35, rows - 0.75], [1.45, rows - 0.45]] as const).forEach(([gx, gy], k) => {
          const [x, y] = Q(P, gx, gy), pose = (Math.floor(t / 3) + k * 2) % 4;
          b.rect(x - 5, y - 1, 10, 2, 'rgba(0,0,0,.3)');
          skeleton(b, x, y - (pose % 2 ? 1 : 0), pose, sk.line);
        });
      },
    },
  },

  skin: {
    pumpkinpatch: S('호박밭', 'Pumpkin Patch', {
      bg: '#2a1a12', floor: ['#5a3a22', '#523520'], grain: '#3f2716', wallL: '#4a2f45', wallR: '#563753', wallTop: OR,
      line: '#1a0f0a', pets: ['#ffb36b', '#fff1a6', '#c9f0c1', '#ffd0a8'], pat: OR, leaf: ['#5f9a3f', '#3f7a2a'], pot: ORD, sky: '#ff9a5a', frame: '#3a2416',
      shelf: '#5a3727', books: [OR, '#5f9a3f', '#ffd27a', '#8a4fff'], paper: '#fff6e6', label: 'dark', weather: 'leaf',
    }, ['hw-vines', 'hw-pumpkins']),
    graveyard: S('달밤 묘지', 'Moonlit Graveyard', {
      bg: '#10141a', floor: ['#2f3d33', '#2a372e'], grain: '#3d4d40', wallL: '#262b36', wallR: '#2e3440', wallTop: '#9aa6b8',
      deskTop: '#5a5f6a', deskL: '#454a55', deskR: '#363a44', line: '#07070f', pets: ['#e6ecf5', '#c9f0c1', '#d6c9ff', '#fff1a6'], pat: '#7a8a9a',
      leaf: ['#4a5a44', '#36442f'], pot: '#454a55', sky: '#1a2238', frame: '#4a5260', shelf: '#3a3f4a', books: ['#6a7480', '#8a7aa0', '#5a7060'],
      cooler: '#c9cfd8', water: '#9ab8d0', paper: '#e6ecf5', label: 'dark', stars: true, weather: 'star',
    }, ['hw-fog', 'hw-tombs']),
    candycorn: S('사탕 옥수수', 'Candy Corn', {
      bg: '#fff6e0', floor: ['#ffd84d', '#ffcf33'], grain: '#f0b020', wallL: '#fff3e3', wallR: '#fffaf0', wallTop: OR,
      deskTop: '#ff9a3c', deskL: '#e07a20', deskR: '#c26515', pets: ['#ffffff', '#ffd9a8', '#ffc6d9', '#e6d4ff'], pat: OR,
      leaf: [OR, '#e06a10'], pot: '#ffd84d', sky: '#ffe7b3', frame: '#e07a20', shelf: '#c26515', books: [OR, '#ffd84d', '#ffffff', '#8a4fff'], weather: 'confetti',
    }, ['hw-candycorn']),
    blackcat: S('검은 고양이 골목', 'Black Cat Alley', {
      bg: '#0c0a12', floor: ['#3a3540', '#34303a'], grain: '#4a4550', wallL: '#4a2a26', wallR: '#552f2a', wallTop: '#1a1418',
      deskTop: '#3a3540', deskL: '#2a262f', deskR: '#201d24', line: '#07070f', pets: ['#ffe07a', '#e6e6e6', '#c9b3ff', '#ffb3b3'], pat: '#ffe07a',
      leaf: ['#3a5a3a', '#2a4a2a'], pot: '#2a262f', sky: '#1a1a33', frame: '#2a2026', shelf: '#2a262f', books: ['#ffe07a', '#7a6a8a', '#a04a3a'],
      cooler: '#9a9aa8', water: '#6a8ab0', paper: '#e6e6ee', label: 'dark', stars: true,
    }, ['hw-eyes', 'hw-cats']),
    cobweb: S('거미줄 다락', 'Cobweb Attic', {
      bg: '#1e1a16', floor: ['#6a5640', '#62503b'], grain: '#4f3f2e', wallL: '#5a4a3a', wallR: '#665443', wallTop: '#3a2e22',
      deskTop: '#7a6248', deskL: '#5f4b37', deskR: '#4c3c2c', line: '#1a140e', pets: ['#e8e0d0', '#ffd9a8', '#c9c0e6', '#d0e8d0'], pat: '#a89070',
      leaf: ['#6a6a4a', '#4f4f36'], pot: '#5f4b37', sky: '#5a5a6a', frame: '#3a2e22', shelf: '#4c3c2c', books: ['#8a6a5a', '#6a7a8a', '#9a8a5a'],
      cooler: '#d8d0c0', water: '#a0b8c8', paper: '#efe6d0', label: 'dark', planks: true,
    }, ['hw-webs', 'hw-spider']),
    witchhut: S('마녀의 오두막', "Witch's Hut", {
      bg: '#141a12', floor: ['#3f3a2a', '#3a3526'], grain: '#2f2a1e', wallL: '#2f4a2f', wallR: '#365436', wallTop: '#8a4fff',
      deskTop: '#5a4a3a', deskL: '#45382b', deskR: '#362b21', line: '#0a0d08', pets: ['#b6ff5c', '#e6d4ff', '#ffd9a8', '#9ff0e0'], pat: '#8a4fff',
      leaf: ['#6a8a3a', '#4a6a2a'], pot: '#45382b', sky: '#3a2a55', frame: '#2a1f3a', shelf: '#362b21', books: ['#8a4fff', '#b6ff5c', ORD],
      paper: '#efe8d8', label: 'dark', stars: true, weather: 'leaf',
    }, ['hw-herbs', 'hw-broom', 'hw-cauldron']),
    potionlab: S('물약 실험실', 'Potion Lab', {
      bg: '#061414', floor: ['#1f3a3a', '#1b3434'], grain: '#2a4a4a', wallL: '#173030', wallR: '#1d3a3a', wallTop: '#39f3a0',
      deskTop: '#c9d6d0', deskL: '#9aaaa4', deskR: '#7a8a84', mon: '#1a2a2a', line: '#030808', on: ['#39f3a0', '#b6ff5c', '#c08cff'],
      pets: ['#b6ff5c', '#9ff8ff', '#ffb3f0', '#fff1a6'], pat: '#39f3a0', leaf: ['#39a070', '#2a7a55'], pot: '#7a8a84', sky: '#0a2a2a', frame: '#39a070',
      shelf: '#2a4a4a', books: ['#39f3a0', '#c08cff', '#ffcf4f'], cooler: '#c9d6d0', water: '#39f3a0', paper: '#e6fff4', label: 'dark', weather: 'bubble',
    }, ['hw-potions']),
    mummytomb: S('미라 무덤', 'Mummy Tomb', {
      bg: '#1a140a', floor: ['#7a6038', '#725a34'], grain: '#5a4628', wallL: '#6a5432', wallR: '#77603a', wallTop: '#3a6aa8',
      deskTop: '#a8884e', deskL: '#8a6e3e', deskR: '#735a32', line: '#1a1208', pets: ['#f0ead8', '#ffd27a', '#bfe3ff', '#ffc6a8'], pat: '#3a6aa8',
      leaf: ['#6a8a3a', '#4a6a2a'], pot: '#8a6e3e', sky: '#ffcf7a', frame: '#3a6aa8', shelf: '#8a6e3e', books: ['#3a6aa8', '#e0b94f', '#b3321f'],
      paper: '#f6eedc', label: 'dark', plate: ['#ffe07a', '#e0b94f', '#b3871f'], weather: 'ember',
    }, ['hw-sarcophagus', 'hw-torches']),
    ghostship: S('유령선', 'Ghost Ship', {
      bg: '#06100f', floor: ['#2f4a44', '#2a443e'], grain: '#1f3530', wallL: '#24403a', wallR: '#2a4a43', wallTop: '#9ff0d0',
      deskTop: '#3f5a50', deskL: '#2f4a42', deskR: '#243b34', line: '#020807', pets: ['#d0fff0', '#9ff8ff', '#e6d4ff', '#fff1a6'], pat: '#9ff0d0',
      leaf: ['#3f6a5a', '#2a4a40'], pot: '#2f4a42', sky: '#0a1f2a', frame: '#4a6a5a', shelf: '#243b34', books: ['#9ff0d0', '#6a8a7a', '#c9b3ff'],
      paper: '#e0fff6', label: 'dark', planks: true, stars: true,
    }, ['hw-porthole', 'hw-ghosts']),
    lanternsquare: S('잭오랜턴 광장', "Jack-o'-Lantern Square", {
      bg: '#120a14', floor: ['#4a3a3a', '#433434'], grain: '#5a4848', wallL: '#2a1a35', wallR: '#321f40', wallTop: OR,
      deskTop: '#6a4a2a', deskL: '#553a20', deskR: '#442e19', line: '#0a0508', pets: ['#ffb36b', '#ffe07a', '#c9b3ff', '#ffc6d9'], pat: OR,
      leaf: [OR, ORD], pot: '#553a20', sky: '#2a1540', frame: '#553a20', shelf: '#442e19', books: [OR, '#ffe07a', '#8a4fff'],
      paper: '#fff1dc', label: 'dark', stars: true, weather: 'ember',
    }, ['hw-lanterns', 'hw-pumpkins']),
    hauntedmanor: S('유령 저택', 'Haunted Manor', {
      bg: '#100a18', floor: ['#3a2028', '#341c24'], grain: '#4a2a34', wallL: '#2e2244', wallR: '#382a52', wallTop: '#c9a66a',
      deskTop: '#4a2e22', deskL: '#3a241a', deskR: '#2c1b13', line: '#08050c', pets: ['#e6e0ff', '#ffd9a8', '#c9f0e0', '#ffc6d9'], pat: '#c9a66a',
      leaf: ['#4a5a3a', '#36442a'], pot: '#3a241a', sky: '#1a1430', frame: '#c9a66a', shelf: '#2c1b13', books: ['#8a2f3f', '#2f4f8a', '#c9a66a'],
      paper: '#efe6ff', label: 'dark', stars: true, plate: ['#ffe07a', '#e0b94f', '#b3871f'],
    }, ['hw-portraits', 'hw-candelabra', 'hw-ghosts']),
    skeletonball: S('해골 무도회', 'Skeleton Ball', {
      bg: '#0e0a16', floor: ['#e8e8ee', '#2a2a33'], grain: '#4a4a55', wallL: '#2a1a3a', wallR: '#341f48', wallTop: '#e8e8ee',
      deskTop: '#1a1a22', deskL: '#121218', deskR: '#0c0c10', line: '#07070f', pets: ['#f4f4f8', '#ffd27a', '#c9b3ff', '#9ff0e0'], pat: '#e8e8ee',
      leaf: ['#8a4fff', '#6a2fdf'], pot: '#1a1a22', sky: '#1a0f2a', frame: '#e8e8ee', shelf: '#121218', books: ['#e8e8ee', '#8a4fff', OR],
      label: 'dark', weather: 'confetti',
    }, ['hw-candelabra', 'hw-dancers']),
    vampirecastle: S('흡혈귀 성', 'Vampire Castle', {
      bg: '#0a0408', floor: ['#3a3238', '#332c31'], grain: '#4a4048', wallL: '#2a2228', wallR: '#332a31', wallTop: '#b3121f',
      deskTop: '#5a0f1a', deskL: '#450b14', deskR: '#33080f', mon: '#1a1418', line: '#050204', on: ['#ff3b4a', '#ffcf4f', '#ff8a9a'],
      pets: ['#f0e6ee', '#ffb3b3', '#d6c9ff', '#fff1a6'], pat: '#b3121f', leaf: ['#5a1a2a', '#3a0f1a'], pot: '#450b14', sky: '#2a0510', frame: '#e0b94f',
      shelf: '#33080f', books: ['#b3121f', '#e0b94f', '#2a2228', '#5a0f1a'], paper: '#f6eef0', label: 'dark', stars: true,
      plate: ['#ffe07a', '#e0b94f', '#b3871f'], weather: 'ember',
    }, ['hw-banners', 'hw-candelabra', 'hw-bats']),
    bloodmoon: S('핏빛 달밤', 'Blood Moon Night', {
      bg: '#12040a', floor: ['#2a1828', '#251524'], grain: '#3a2034', wallL: '#1f1030', wallR: '#28143d', wallTop: '#ff3b3b',
      deskTop: '#2a1a1f', deskL: '#1f1317', deskR: '#170e11', line: '#050102', on: ['#ff3b3b', '#ff8a5a', '#ffcf9a'],
      pets: ['#ffd0d0', '#e6d4ff', '#ffe0b3', '#d0f0ff'], pat: '#ff3b3b', leaf: ['#6a1a2a', '#4a0f1a'], pot: '#1f1317', sky: '#5a0a14', frame: '#46101b',
      shelf: '#170e11', books: ['#ff3b3b', '#6a1a2a', '#ffcf9a'], paper: '#ffecec', label: 'dark', stars: true, weather: 'ember',
    }, ['hw-moon', 'hw-fog', 'hw-bats']),
  },
};
