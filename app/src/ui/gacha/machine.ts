// 뽑기 연출 — 클래식 캡슐 머신(시안 v3 M-1) + 10연뽑 선반. 시안 docs/design-drafts/pixel-office/body/gacha_page.js 를 옮긴 것.
// 한 번 뽑기 시간표(ms): 0 동전 날아감 → 500 손잡이 세 바퀴(덜덜·전구·캡슐 뒤섞임) → 2100 배출구 → 2200 캡슐 튕김 → 3300 뜸 → 펑 → 아이템
import type { Rarity } from '../../domain/gacha';
import type { Brush } from '../office/draw';
import { drawItem, scaled } from './icons';

type B = Brush;
export const RC: Record<Rarity, string> = { 흔함: '#c8c8c8', 보통: '#5aa0e6', 희귀: '#a86be0', 전설: '#ffc93c' };
const RC2: Record<Rarity, string> = { 흔함: '#8a8a8a', 보통: '#2f6fb0', 희귀: '#6d3aa6', 전설: '#d6931a' };
const O = '#2a1c14';

type Part = { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; c: string; s: number };
/** 연출 상태 — 뽑을 때마다 새로 */
export type Show = {
  kind: 'one' | 'ten';
  t0: number;
  rarity: Rarity;
  item: string;
  items: { id: string; rarity: Rarity }[];
  parts: Part[];
  shake: number;
  cap: { x: number; y: number } | null;
  flags: Set<string>;
  /** 이름 카드를 띄울 때 한 번 */
  onCard: () => void;
};
export const newShow = (kind: Show['kind'], items: { id: string; rarity: Rarity }[], onCard: () => void): Show => ({
  kind, t0: performance.now(), rarity: items[items.length - 1]!.rarity, item: items[items.length - 1]!.id, items, parts: [], shake: 0, cap: null, flags: new Set(), onCard,
});

/** 건너뛰기 — 시계를 끝 너머로 돌려 다음 프레임에 결과(펑·카드)가 바로 나온다. 결과는 이미 저장돼 있다 */
export const skipShow = (s: Show, now: number) => { s.t0 = Math.min(s.t0, now - 60_000); };

// ───────── 도구 ─────────
const disc = (b: B, cx: number, cy: number, r: number, c: string) => { for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8)); b.rect(cx - w, cy + dy, w * 2 + 1, 1, c); } };
const ellipse = (b: B, cx: number, cy: number, rx: number, ry: number, c: string) => { for (let dy = -ry; dy <= ry; dy++) { const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)))); b.rect(cx - w, cy + dy, w * 2 + 1, 1, c); } };
const FONT: Record<string, string> = { 0: '111101101101111', 1: '010110010010111', G: '111100101101111', A: '010101111101101', C: '111100100100111', H: '101101111101101' };
const text = (b: B, s: string, x: number, y: number, c: string) => [...s].forEach((ch, i) => { const f = FONT[ch]; if (f) [...f].forEach((v, k) => v === '1' && b.rect(x + i * 4 + (k % 3), y + Math.floor(k / 3), 1, 1, c)); });
function capsule(b: B, x: number, y: number, r: number, top: string, tilt = 0) {
  disc(b, x, y, r, O); disc(b, x, y, r - 1, '#f6f3ee');
  for (let dy = -(r - 1); dy <= tilt; dy++) { const w = Math.floor(Math.sqrt((r - 1) * (r - 1) - dy * dy + (r - 1) * 0.8)); b.rect(x - w, y + dy, w * 2 + 1, 1, top); }
  b.rect(x - r + 1, y + tilt, (r - 1) * 2 + 1, 1, 'rgba(0,0,0,.25)');
  b.rect(x - Math.round(r / 2), y - Math.round(r / 2), 2, 2, 'rgba(255,255,255,.85)');
}
function capsuleHalf(b: B, x: number, y: number, c: string, top: boolean) {
  for (let dy = top ? -8 : 0; dy <= (top ? 0 : 8); dy++) { const w = Math.floor(Math.sqrt(64 - dy * dy + 6)); b.rect(x - w - 1, y + dy, w * 2 + 3, 1, O); b.rect(x - w, y + dy, w * 2 + 1, 1, c); }
}
function burst(parts: Part[], x: number, y: number, n: number, colors: string[], speed = 1.6, g = 0.05) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * speed; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8, g, life: 0, max: 40 + Math.random() * 30, c: colors[i % colors.length]!, s: Math.random() < 0.3 ? 2 : 1 }); }
}
export function stepParts(b: B, parts: Part[]) {
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985; p.life++; if (p.life < p.max) b.rect(Math.round(p.x), Math.round(p.y), p.s, p.s, p.c); }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i]!.life >= parts[i]!.max) parts.splice(i, 1);
}
/** 0..1 → 튀는 높이 비율(세 번 튐) */
export const bounce = (t: number) => {
  if (t < 0.45) return 1 - (t / 0.45) ** 2;
  if (t < 0.75) { const u = (t - 0.6) / 0.15; return 0.3 * (1 - u * u); }
  if (t < 0.92) { const u = (t - 0.835) / 0.085; return 0.08 * (1 - u * u); }
  return 0;
};
const hex2 = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

// ───────── 개봉: 뜸 → 펑 → 아이템 ─────────
function reveal(b: B, s: Show, W: number, H: number, at: number) {
  const r = s.rarity, big = r === '희귀' || r === '전설';
  const { x: cx, y: cy } = s.cap!;
  const WAIT = big ? 1500 : 700;
  if (at < WAIT) {
    if (big) { b.rect(0, 0, W, H, `rgba(10,8,20,${Math.min(0.55, at / 1500)})`); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + at / 300, len = 6 + ((at / 60 + k * 3) % 14); b.rect(Math.round(cx + Math.cos(a) * len), Math.round(cy + Math.sin(a) * len * 0.6), 1, 1, RC[r]); } }
    const amp = (at / WAIT) * (big ? 3 : 1.5), wob = Math.round(Math.sin(at / (big ? 45 : 70)) * amp);
    if (big && at > WAIT * 0.5 && Math.floor(at / 90) % 2) disc(b, cx, cy, 11, RC[r] + '66');
    capsule(b, cx + wob, cy, 9, RC[r]);
    if (big && at > WAIT * 0.6) { const h = Math.round((at - WAIT * 0.6) / 30); for (let k = -1; k <= 1; k++) b.rect(cx + wob + k * 5, cy - 1 - h, 1, h, RC[r]); }
    return;
  }
  const t = at - WAIT;
  if (!s.flags.has('pop')) { s.flags.add('pop'); burst(s.parts, cx, cy, big ? 70 : 30, r === '전설' ? ['#ffc93c', '#ffffff', '#ff8a3d', '#fff1a6'] : [RC[r], '#ffffff', RC2[r]], big ? 2.4 : 1.5); s.shake = big ? 10 : 4; }
  b.rect(0, 0, W, H, `rgba(12,8,24,${Math.min(big ? 0.62 : 0.45, t / 300)})`);
  const rise = Math.min(1, t / 700), ix = Math.round(cx + (W / 2 - cx) * rise), iy = Math.round(cy + (62 - cy) * rise + Math.sin(t / 250) * 2);
  if (r === '전설') for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2 + t / 900; for (let d = 22; d < 80; d += 3) b.rect(Math.round(ix + Math.cos(a) * d), Math.round(iy + Math.sin(a) * d * 0.8), 1, 1, k % 2 ? '#ffc93c77' : '#ffffff55'); }
  if (big) { const a = Math.min(1, t / 400); b.rect(ix - 16, 0, 32, H, RC[r] + hex2(a * 0.19)); b.rect(ix - 7, 0, 14, H, RC[r] + hex2(a * 0.33)); }
  else disc(b, ix, iy, 22, RC[r] + '33');
  if (t < 220) b.rect(0, 0, W, H, `rgba(255,255,255,${(1 - t / 220) * (big ? 0.95 : 0.6)})`);
  const f = Math.min(1, t / 500);
  if (f < 1) { capsuleHalf(b, cx - Math.round(f * 26), cy - Math.round(Math.sin(f * Math.PI) * 26), RC[r], true); capsuleHalf(b, cx + Math.round(f * 18), cy + Math.round(f * 6), '#f6f3ee', false); }
  drawItem(scaled(b, ix - 24, iy - 20, 2), s.item);
  if (t > 500 && Math.floor(t / 120) % 3 === 0) { const a = Math.random() * Math.PI * 2; b.rect(ix + Math.round(Math.cos(a) * 28), iy + Math.round(Math.sin(a) * 20), 1, 3, '#ffffff'); }
  if (t > 700 && !s.flags.has('card')) {
    s.flags.add('card'); s.onCard();
    if (r === '전설') for (let k = 0; k < 4; k++) setTimeout(() => burst(s.parts, 30 + Math.random() * (W - 60), 20 + Math.random() * 40, 24, ['#ffc93c', '#e5484d', '#5aa0e6', '#7cc48a', '#ffffff'], 1.8, 0.04), k * 350);
  }
}

// ───────── 캡슐 머신 ─────────
const GLOBE = (() => {
  const out: { x: number; y: number; c: string }[] = [];
  const cols = ['#e5484d', '#5aa0e6', '#ffc93c', '#7cc48a', '#a86be0', '#ff8a3d', '#f49ab8'];
  let i = 0;
  for (let row = 0; row < 6; row++) {
    const y = 26 - row * 9, half = Math.floor(Math.sqrt(Math.max(0, 34 * 34 - y * y)) / 9);
    for (let k = -half; k <= half; k++) { if (row > 3 && Math.abs(k) > half - 1) continue; out.push({ x: k * 9 + (row % 2 ? 4 : 0), y, c: cols[i++ % cols.length]! }); }
  }
  return out.filter((p) => p.x * p.x + p.y * p.y < 30 * 30);
})();

/** 기다리는 기계(s 없음)의 그림이 now 에 따라 바뀌는 것 — 전구 박자(260ms)·유리 반짝임 자리. 같으면 같은 그림이라 다시 안 그려도 된다
 *  (상점 QA 19: 열어만 둬도 매 프레임 그려 CPU 초당 50ms). drawMachine 의 시간 쓰는 곳을 바꾸면 여기도 — 테스트가 그림과 대 본다 */
export function idleKey(now: number): string {
  const glint = (now / 2400) % 1;
  return `${Math.floor(now / 260) % 3}:${glint < 0.2 ? `${Math.round(glint * 300)},${Math.round(glint * 40)}` : '-'}`;
}

/** s 가 없으면 기다리는 기계(전구·반짝임만) */
export function drawMachine(b: B, W: number, H: number, s: Show | null, now: number) {
  const t = s ? now - s.t0 : -1;
  const sh = s && s.shake > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
  if (s && s.shake > 0) s.shake--;
  const cr = t >= 500 && t < 1700 ? (t - 500) / 1200 : t >= 1700 ? 1 : 0;
  const crankA = (1 - (1 - cr) ** 2) * Math.PI * 3;
  const rumble = t >= 500 && t < 2100 ? (Math.floor(now / 50) % 2 ? 1 : -1) : 0;
  const X = Math.round(W / 2) + sh + rumble, gy = 62;
  // 무대: 오락실 벽 + 점 조명 + 바닥
  b.rect(0, 0, W, H, '#241a36');
  for (let y = 0; y < H - 30; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < W; x += 12) b.rect(x, y, 1, 1, '#34284c');
  b.rect(0, H - 34, W, 34, '#2e2244');
  ellipse(b, W / 2, 166, 70, 9, '#3a2a4a'); ellipse(b, W / 2, 166, 52, 6, '#4a3860');
  b.rect(X - 38, 158, 8, 8, O); b.rect(X + 30, 158, 8, 8, O);
  // 몸통 + 나사
  b.rect(X - 42, 100, 84, 60, '#3a1216'); b.rect(X - 41, 101, 82, 58, '#e5484d'); b.rect(X - 41, 101, 6, 58, '#ff7378'); b.rect(X + 32, 101, 9, 58, '#b8323a');
  for (const [rx, ry] of [[-37, 106], [36, 106], [-37, 152], [36, 152]] as const) { b.rect(X + rx, ry, 2, 2, '#ffd9a8'); b.rect(X + rx + 1, ry + 1, 1, 1, '#b8323a'); }
  // 앞판 · 투입구 · 가격
  b.rect(X - 30, 112, 60, 40, '#3a1216'); b.rect(X - 29, 113, 58, 38, '#c93b43'); b.rect(X - 29, 113, 58, 2, '#d94a52');
  text(b, 'GACHA', X - 26, 118, '#ffd9a8');
  const slotLit = t >= 450 && t < 800;
  b.rect(X - 25, 128, 9, 14, '#d9dde3'); b.rect(X - 22, 130, 3, 10, slotLit ? '#fff1a6' : O); b.rect(X - 25, 128, 9, 1, '#ffffff');
  text(b, '100', X - 28, 145, '#ffd9a8');
  // 손잡이
  const kx = X + 13, ky = 134;
  disc(b, kx, ky, 11, O); disc(b, kx, ky, 10, '#d9dde3'); disc(b, kx, ky, 7, '#b9bec6');
  for (let k = 0; k < 3; k++) { const a = crankA + (k * Math.PI * 2) / 3; b.line([kx, ky], [kx + Math.cos(a) * 9, ky + Math.sin(a) * 9], '#3b3742'); }
  disc(b, kx, ky, 2, '#e5484d'); b.rect(kx - 6, ky - 7, 2, 2, '#ffffff');
  // 배출구 덮개
  const flap = t >= 2100 && t < 2700 ? Math.min(1, (t - 2100) / 150) : 0;
  b.rect(X - 10, 150, 20, 9, O); b.rect(X - 9, 151, 18, 7, '#140c08'); b.rect(X - 9, 151, 18, Math.round(7 * (1 - flap)), '#8a8f97');
  // 금색 띠 + 전구(뽑는 동안 빨리 돈다)
  b.rect(X - 44, 96, 88, 6, '#3a1216'); b.rect(X - 43, 97, 86, 4, '#e0b94f'); b.rect(X - 43, 97, 86, 1, '#fff1a6');
  const fast = t >= 500 && t < 2200;
  for (let k = 0; k < 9; k++) { const on = fast ? Math.floor(now / 70 + k) % 2 : Math.floor(now / 260 + k) % 3 === 0; b.rect(X - 40 + k * 10, 98, 3, 2, on ? '#fffbe0' : '#b3871f'); }
  // 유리 구 + 캡슐(뽑는 동안 뒤섞임)
  disc(b, X, gy, 38, '#3a1216'); disc(b, X, gy, 37, '#d8f0ff');
  const jig = t >= 500 && t < 2000 ? 2 : 0, spin = cr * 1.8;
  GLOBE.forEach((p, i) => {
    const a = Math.atan2(p.y, p.x) + (jig ? Math.sin(now / 90 + i) * 0.15 : 0) + spin * (i % 2 ? 0.2 : -0.2), d = Math.hypot(p.x, p.y);
    const px = Math.round(Math.cos(a) * d + (jig ? Math.sin(now / 60 + i * 2) * jig : 0));
    const py = Math.round(Math.sin(a) * d + (jig ? Math.cos(now / 70 + i) * jig : Math.sin(now / 900 + i) * 0.4));
    if (px * px + py * py < 31 * 31) capsule(b, X + px, gy + py, 5, p.c);
  });
  for (let k = 0; k < 14; k++) { const a = Math.PI * 1.1 + k * 0.05; b.rect(Math.round(X + Math.cos(a) * 31), Math.round(gy + Math.sin(a) * 31), 2, 2, 'rgba(255,255,255,.75)'); }
  b.rect(X + 18, gy + 18, 3, 3, 'rgba(255,255,255,.5)');
  const glint = (now / 2400) % 1; if (glint < 0.2) b.rect(X - 30 + Math.round(glint * 300), gy - 20 + Math.round(glint * 40), 2, 6, 'rgba(255,255,255,.8)');
  // 뚜껑
  b.rect(X - 22, 20, 44, 8, '#3a1216'); b.rect(X - 21, 21, 42, 6, '#e5484d'); b.rect(X - 21, 21, 42, 1, '#ff7378'); b.rect(X - 23, 27, 46, 3, '#e0b94f');
  disc(b, X, 16, 5, '#3a1216'); disc(b, X, 16, 4, '#e0b94f'); b.rect(X - 2, 13, 2, 2, '#fff1a6');
  if (!s) return;
  // 동전 날아옴 → 반짝
  if (t >= 0 && t < 500) { const f = t / 500, cx = Math.round(18 + (X - 21 - 18) * f), cy = Math.round(176 - 60 * Math.sin(f * Math.PI) - (176 - 132) * f); b.rect(cx - 2, cy - 3, [5, 3, 1, 3][Math.floor(now / 60) % 4]!, 6, '#e0b94f'); }
  if (t >= 500 && !s.flags.has('coin')) { s.flags.add('coin'); burst(s.parts, X - 21, 130, 10, ['#fff1a6', '#e0b94f'], 0.9); }
  const tick = Math.floor(crankA / (Math.PI / 2));
  if (t > 500 && t < 1700 && !s.flags.has('tick' + tick)) { s.flags.add('tick' + tick); burst(s.parts, kx + 10, ky - 6, 3, ['#ffffff'], 0.8, 0.02); }
  // 캡슐이 나와서 세 번 튄다 → 뜸 → 펑
  if (t >= 2200) {
    const f = Math.min(1, (t - 2200) / 1100), base = 164;
    const x = Math.round(X + (160 - X) * Math.min(1, f * 1.3));
    const y = Math.round(base - bounce(f) * 20 - (f < 0.1 ? (0.1 - f) * 60 : 0));
    if (!s.cap || t < 3300) s.cap = { x, y: base - 8 };
    ellipse(b, s.cap.x, base + 1, 7, 2, 'rgba(0,0,0,.25)');
    if (t < 3300) capsule(b, x, y - 8, 9, RC[s.rarity], Math.round(Math.sin(f * 20) * 2));
    else reveal(b, s, W, H, t - 3300);
  }
}

// ───────── 10연뽑 선반 ─────────
export function drawTen(b: B, W: number, H: number, s: Show, now: number) {
  const t = now - s.t0;
  b.rect(0, 0, W, H, '#1c1630');
  b.rect(10, 96, W - 20, 6, '#8d5d3d'); b.rect(10, 102, W - 20, 3, '#5a3727');
  const rank: Record<Rarity, number> = { 흔함: 0, 보통: 1, 희귀: 2, 전설: 3 };
  // 여는 순서: 등급 낮은 것부터, 제일 높은 건 맨 끝(뜸)
  const order = [...s.items.keys()].sort((a, c) => rank[s.items[a]!.rarity] - rank[s.items[c]!.rarity] || a - c);
  const best = order[order.length - 1]!, bestR = s.items[best]!.rarity, drama = rank[bestR] >= 2;
  s.items.forEach(({ id, rarity: r }, i) => {
    const x = 24 + i * 28, drop = t - i * 120;
    if (drop < 0) return;
    const f = Math.min(1, drop / 500), y = Math.round(88 - bounce(f) * 50 - (f < 0.05 ? 40 : 0));
    const openAt = 1800 + order.indexOf(i) * 260 + (i === best && drama ? 900 : 0), o = t - openAt;
    if (o < 0) {
      if (i === best && drama && t > 1800 + 8 * 260 && Math.floor(now / 90) % 2) disc(b, x, y, 11, RC[r] + '66');
      capsule(b, x, y + (o > -400 && r !== '흔함' ? Math.round(Math.sin(now / 50)) : 0), 8, '#8a8f97');
      return;
    }
    if (!s.flags.has('p' + i)) { s.flags.add('p' + i); burst(s.parts, x, y, r === '전설' ? 50 : r === '희귀' ? 24 : 10, [RC[r], '#ffffff'], r === '전설' ? 2.2 : 1.2); if (r === '전설') s.shake = 12; }
    if (r === '희귀' || r === '전설') b.rect(x - 8, 0, 16, y, RC[r] + (r === '전설' ? '55' : '33'));
    disc(b, x, y - 4, 7, RC[r] + '44');
    drawItem(scaled(b, x - 12, Math.round(y - 14 - Math.min(1, o / 300) * 10), 1), id);
    b.rect(x - 11, 108, 22, 3, RC[r]);
  });
  if (t > 1800 + 9 * 260 + (drama ? 900 : 0) + 700 && !s.flags.has('card')) { s.flags.add('card'); s.onCard(); }
}
