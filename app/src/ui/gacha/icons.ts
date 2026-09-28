// 뽑기 아이템 아이콘 — 정면 도트, 대략 24×20 칸 안에 (0,0) 기준으로 그린다. 시안 v2 P(뽑기 풀) 그림을 옮긴 것
import { itemOf } from '../../domain/gacha';
import { pet, type Brush } from '../office/draw';
import { skinOf, SKINS } from '../office/skins';

type R = Pick<Brush, 'rect'>;
const O = '#2a1c14';
const WOOD = SKINS.wood!;

/** (ox, oy) 에서 s 배로 — 뽑기 공개 때 두 배로 키운다 */
export const scaled = (b: R, ox: number, oy: number, s: number): R => ({ rect: (x, y, w, h, c) => b.rect(ox + x * s, oy + y * s, w * s, h * s, c) });

function bear(b: R) { pet(b, WOOD, 'bear', 4, 3, '#ffc6d9'); }

function skinThumb(b: R, name: string) {
  const sk = skinOf(name);
  // 아주 작은 방: 벽 두 면 + 바닥 마름모 + 책상 하나
  for (let y = 0; y < 10; y++) { b.rect(2 + 0, 2 + y, 10, 1, sk.wallL); b.rect(12, 2 + y, 10, 1, sk.wallR); }
  b.rect(12, 2, 1, 10, sk.wallTop); b.rect(2, 2, 20, 1, sk.wallTop);
  for (let k = 0; k < 6; k++) { const w = 20 - k * 3; b.rect(12 - w / 2, 12 + k, w, 1, sk.floor[k % 2]!); }
  b.rect(8, 11, 8, 3, sk.deskTop); b.rect(8, 14, 8, 1, sk.deskL);
  b.rect(10, 7, 3, 4, sk.pets[0]!); b.rect(10, 7, 3, 1, sk.line);
  if (sk.stars) { b.rect(5, 4, 1, 1, '#ffffff'); b.rect(17, 5, 1, 1, '#ffffff'); }
  b.rect(15, 4, 4, 3, sk.sky); b.rect(15, 4, 4, 1, sk.frame);
}

const FURN: Record<string, (b: R) => void> = {
  sofa: (b) => { b.rect(1, 8, 22, 7, '#d9786b'); b.rect(2, 3, 20, 6, '#c96a5e'); b.rect(0, 6, 3, 9, '#b85f53'); b.rect(21, 6, 3, 9, '#b85f53'); b.rect(1, 15, 2, 2, '#5a3727'); b.rect(21, 15, 2, 2, '#5a3727'); b.rect(4, 5, 16, 1, '#e08f84'); },
  board: (b) => { b.rect(2, 1, 20, 13, O); b.rect(3, 2, 18, 11, '#ffffff'); b.rect(5, 4, 8, 1, '#e5484d'); b.rect(6, 7, 11, 1, '#5aa0e6'); b.rect(5, 10, 6, 1, '#7cc48a'); b.rect(4, 14, 1, 5, O); b.rect(19, 14, 1, 5, O); },
  lamp: (b) => { b.rect(6, 1, 12, 6, '#fff1a6'); b.rect(6, 7, 12, 1, '#e0b94f'); b.rect(11, 8, 2, 10, '#555555'); b.rect(8, 18, 8, 2, O); b.rect(4, 9, 16, 1, 'rgba(255,241,166,.5)'); },
  vending: (b) => { b.rect(5, 0, 14, 20, '#e5484d'); b.rect(5, 0, 14, 1, '#ff7378'); b.rect(7, 2, 8, 11, '#bfe5ff'); for (let r = 0; r < 3; r++) for (let q = 0; q < 2; q++) b.rect(8 + q * 4, 3 + r * 3, 2, 2, ['#ffd27a', '#9ef0a4', '#ffc6d9'][(r + q) % 3]!); b.rect(16, 4, 2, 2, '#9ef0a4'); b.rect(7, 15, 8, 3, O); },
  tank: (b) => { b.rect(2, 4, 20, 12, O); b.rect(3, 5, 18, 10, '#8fd0ff'); b.rect(3, 5, 18, 2, '#bfe5ff'); b.rect(8, 9, 5, 3, '#ff9a3c'); b.rect(6, 10, 2, 1, '#ff9a3c'); b.rect(14, 7, 1, 1, '#ffffff'); b.rect(4, 12, 4, 3, '#4d9a57'); b.rect(1, 16, 22, 3, '#8d5d3d'); },
  cattower: (b) => { b.rect(4, 17, 16, 3, '#c99e70'); b.rect(10, 6, 4, 11, '#e8d9c0'); b.rect(5, 2, 14, 4, '#b8663f'); b.rect(5, 6, 14, 1, '#86472b'); b.rect(13, 9, 5, 2, '#c99e70'); },
  arcade: (b) => { b.rect(6, 0, 12, 20, '#5b3fa8'); b.rect(6, 0, 12, 1, '#7d5fd0'); b.rect(8, 2, 8, 6, '#0b1a26'); b.rect(10, 4, 2, 2, '#39f3ff'); b.rect(13, 5, 1, 1, '#ff4fd8'); b.rect(7, 10, 10, 3, '#2c254c'); b.rect(9, 9, 1, 2, O); b.rect(9, 8, 2, 1, '#e5484d'); b.rect(13, 10, 2, 1, '#ffc93c'); },
  trophy: (b) => { b.rect(7, 1, 10, 8, '#e0b94f'); b.rect(5, 2, 2, 4, '#e0b94f'); b.rect(17, 2, 2, 4, '#e0b94f'); b.rect(8, 2, 1, 4, '#fff1a6'); b.rect(11, 9, 2, 4, '#c99a2e'); b.rect(8, 13, 8, 2, '#c99a2e'); b.rect(6, 15, 12, 4, '#5a3727'); },
};
/** 모자만 — (x, y) = 캐릭터(16×16 도트) 왼쪽 위. 사무실 반장 머리에도 이걸로 씌운다 */
const HATS: Record<string, (b: R, x: number, y: number) => void> = {
  crown: (b, x, y) => { b.rect(x + 4, y - 3, 9, 3, '#e0b94f'); b.rect(x + 4, y - 5, 1, 2, '#e0b94f'); b.rect(x + 8, y - 5, 1, 2, '#e0b94f'); b.rect(x + 12, y - 5, 1, 2, '#e0b94f'); b.rect(x + 8, y - 2, 1, 1, '#e5484d'); },
  headset: (b, x, y) => { b.rect(x + 2, y - 1, 13, 1, O); b.rect(x + 1, y, 2, 6, '#3b3742'); b.rect(x + 14, y, 2, 6, '#3b3742'); b.rect(x + 15, y + 6, 1, 3, O); },
  beanie: (b, x, y) => { b.rect(x + 3, y - 3, 11, 5, '#6ea6d9'); b.rect(x + 3, y + 1, 11, 1, '#4d86b8'); b.rect(x + 8, y - 5, 2, 2, '#ffffff'); },
  straw: (b, x, y) => { b.rect(x - 1, y + 1, 19, 1, '#e0b94f'); b.rect(x + 4, y - 2, 9, 3, '#e0b94f'); b.rect(x + 4, y, 9, 1, '#d9786b'); },
};
export const drawHat = (b: R, id: string, x: number, y: number) => HATS[id.slice(4)]?.(b, x, y);
const HAT: Record<string, (b: R) => void> = Object.fromEntries(Object.keys(HATS).map((k) => [k, (b: R) => { bear(b); HATS[k]!(b, 4, 3); }]));
const WIN: Record<string, [string, (b: R) => void]> = {
  rain: ['#8a99ad', (b) => { for (let k = 0; k < 7; k++) b.rect(4 + ((k * 5) % 16), 3 + ((k * 3) % 10), 1, 3, '#dbe6f2'); }],
  night: ['#101a44', (b) => { b.rect(6, 4, 1, 1, '#ffffff'); b.rect(12, 8, 1, 1, '#ffffff'); b.rect(8, 11, 1, 1, '#ffffff'); b.rect(15, 3, 4, 4, '#fff6c2'); }],
  snow: ['#cfe0f0', (b) => { for (let k = 0; k < 9; k++) b.rect(3 + ((k * 7) % 18), 3 + ((k * 5) % 11), 1, 1, '#ffffff'); }],
  blossom: ['#ffe3ec', (b) => { for (let k = 0; k < 7; k++) b.rect(3 + ((k * 9) % 17), 3 + ((k * 4) % 11), 2, 1, '#f49ab8'); }],
  sunset: ['#ff9a6b', (b) => { b.rect(2, 2, 20, 4, '#ff7a8a'); b.rect(9, 8, 6, 4, '#ffe07a'); b.rect(2, 13, 20, 3, '#8a4a6a'); }],
  aurora: ['#0b1433', (b) => { for (let x = 2; x < 22; x++) { b.rect(x, 6 + Math.round(Math.sin(x / 2) * 2), 1, 2, '#7cf0b0'); b.rect(x, 9 + Math.round(Math.cos(x / 3) * 2), 1, 1, '#c08cf0'); } }],
  city: ['#141a3a', (b) => { for (const [x, h] of [[2, 6], [6, 9], [10, 5], [14, 10], [18, 7]] as const) { b.rect(x, 16 - h, 4, h, '#2a2f55'); b.rect(x + 1, 17 - h, 1, 1, '#ffd27a'); } }],
  rainbow: ['#bfe5ff', (b) => { ['#e5484d', '#ff9a3c', '#ffd27a', '#7cc48a', '#5aa0e6'].forEach((c, i) => { for (let x = 3 + i; x < 21 - i; x++) b.rect(x, 5 + i + Math.round(Math.abs(x - 12) ** 1.5 / 8), 1, 1, c); }); }],
  fireworks: ['#0e0f2a', (b) => { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.rect(8 + Math.round(Math.cos(a) * 4), 7 + Math.round(Math.sin(a) * 4), 1, 1, '#ffc93c'); b.rect(16 + Math.round(Math.cos(a) * 3), 10 + Math.round(Math.sin(a) * 3), 1, 1, '#ff6bd6'); } }],
  meteor: ['#070a1f', (b) => { for (const [x, y] of [[4, 4], [15, 3], [19, 9], [7, 12]] as const) b.rect(x, y, 1, 1, '#ffffff'); for (let k = 0; k < 6; k++) b.rect(8 + k, 5 + k, 1, 1, k > 3 ? '#ffffff' : '#9ab8ff'); }],
};
function windowIcon(b: R, name: string) {
  const [sky, draw] = WIN[name]!;
  b.rect(1, 1, 22, 16, '#8a6a4a'); b.rect(2, 2, 20, 14, sky); draw(b);
  b.rect(11, 2, 1, 14, '#8a6a4a'); b.rect(2, 9, 20, 1, '#8a6a4a');
}
function cat(b: R) {
  const F = '#f4a261', D = '#c97d3f';
  b.rect(2, 8, 14, 7, F); b.rect(12, 3, 8, 7, F); b.rect(12, 2, 2, 2, F); b.rect(18, 2, 2, 2, F);
  b.rect(14, 5, 1, 2, O); b.rect(17, 5, 1, 2, O); b.rect(15, 7, 2, 1, '#e5484d');
  b.rect(0, 6, 2, 5, F); b.rect(4, 9, 2, 5, D); b.rect(9, 9, 2, 5, D); b.rect(3, 15, 2, 2, D); b.rect(13, 15, 2, 2, D);
}
function fx(b: R, name: string) {
  const col = { heart: '#f49ab8', petal: '#ffc6d9', firework: '#e0b94f' }[name] ?? '#ffffff';
  for (let n = 0; n < 10; n++) { const a = (n / 10) * Math.PI * 2; const x = 12 + Math.cos(a) * 9, y = 10 + Math.sin(a) * 7; b.rect(Math.round(x), Math.round(y), 2, 2, name === 'firework' ? ['#e0b94f', '#e5484d', '#5aa0e6'][n % 3]! : col); }
  if (name === 'heart') { b.rect(9, 7, 3, 2, col); b.rect(13, 7, 3, 2, col); b.rect(9, 9, 7, 2, col); b.rect(10, 11, 5, 1, col); b.rect(11, 12, 3, 1, col); }
  else b.rect(11, 9, 3, 3, '#ffffff');
}
function action(b: R, name: string) {
  bear(b);
  if (name === 'dance') { b.rect(2, 9, 2, 4, '#ffc6d9'); b.rect(21, 7, 2, 4, '#ffc6d9'); b.rect(21, 0, 2, 2, '#ffd27a'); b.rect(23, -2, 1, 3, '#ffd27a'); }
  else { b.rect(19, 12, 4, 4, '#ffffff'); b.rect(23, 13, 1, 2, '#ffffff'); b.rect(20, 9, 1, 2, '#ffffff'); b.rect(22, 8, 1, 2, '#ffffff'); }
}

export function drawItem(b: R, id: string) {
  const it = itemOf(id);
  if (!it) return;
  const name = id.slice(id.indexOf('.') + 1);
  switch (it.kind) {
    case 'skin': return skinThumb(b, name);
    case 'furn': return FURN[name]?.(b);
    case 'hat': return HAT[name]?.(b);
    case 'window': return windowIcon(b, name);
    case 'friend': return cat(b);
    case 'fx': return fx(b, name);
    case 'action': return action(b, name);
  }
}

/** 창밖 풍경 — 사무실 창문 안에 그린다. at(u, v) = 창 안의 점(0..1). t = 프레임 */
export const WINDOW_SKY: Record<string, string> = { rain: '#8a99ad', night: '#101a44', snow: '#cfe0f0', blossom: '#ffe3ec', sunset: '#ff9a6b', aurora: '#0b1433', city: '#141a3a', rainbow: '#bfe5ff', fireworks: '#0e0f2a', meteor: '#070a1f' };
export function windowScene(id: string, t: number, dot: (u: number, v: number, w: number, h: number, c: string) => void) {
  const name = id.slice(7);
  if (name === 'rain') for (let k = 0; k < 8; k++) dot(((k * 0.37) % 1), (((k * 0.23) + t * 0.08) % 1), 1, 3, '#dbe6f2');
  if (name === 'snow') for (let k = 0; k < 10; k++) dot((((k * 0.31) + Math.sin(t / 8 + k) * 0.03) % 1 + 1) % 1, (((k * 0.17) + t * 0.02) % 1), 1, 1, '#ffffff');
  if (name === 'blossom') for (let k = 0; k < 8; k++) dot((((k * 0.29) + t * 0.01) % 1), (((k * 0.13) + t * 0.025) % 1), 2, 1, '#f49ab8');
  if (name === 'night') { for (let k = 0; k < 6; k++) if ((t + k * 5) % 16 < 12) dot((k * 0.41) % 1, (k * 0.27) % 0.6, 1, 1, '#ffffff'); dot(0.8, 0.15, 3, 3, '#fff6c2'); }
  if (name === 'sunset') { for (let u = 0; u <= 1; u += 0.05) { dot(u, 0.08, 1, 2, '#ff7a8a'); dot(u, 0.9, 1, 2, '#8a4a6a'); } dot(0.45, 0.5 + Math.sin(t / 30) * 0.03, 4, 3, '#ffe07a'); }
  if (name === 'aurora') for (let u = 0; u <= 1; u += 0.04) { dot(u, 0.3 + Math.sin(u * 7 + t / 6) * 0.12, 1, 2, '#7cf0b0'); dot(u, 0.55 + Math.cos(u * 5 + t / 8) * 0.1, 1, 1, '#c08cf0'); }
  if (name === 'city') for (let k = 0; k < 6; k++) { const u = k / 6, h = [0.4, 0.6, 0.3, 0.7, 0.5, 0.45][k]!; for (let v = 1 - h; v < 1; v += 0.08) dot(u + 0.02, v, 2, 1, '#2a2f55'); if ((t + k * 7) % 20 < 14) dot(u + 0.05, 1 - h + 0.1, 1, 1, '#ffd27a'); }
  if (name === 'rainbow') ['#e5484d', '#ff9a3c', '#ffd27a', '#7cc48a', '#5aa0e6'].forEach((c, i) => { for (let u = 0.05; u <= 0.95; u += 0.04) dot(u, 0.2 + i * 0.1 + Math.abs(u - 0.5) ** 1.6 * 1.2, 1, 1, c); });
  if (name === 'fireworks') for (let k = 0; k < 2; k++) { const ph = ((t + k * 13) % 26) / 26, cu = [0.3, 0.7][k]!, cv = [0.35, 0.5][k]!; if (ph < 0.8) for (let n = 0; n < 8; n++) { const a = (n / 8) * Math.PI * 2; dot(cu + Math.cos(a) * ph * 0.25, cv + Math.sin(a) * ph * 0.35, 1, 1, ['#ffc93c', '#ff6bd6'][k]!); } }
  if (name === 'meteor') { for (let k = 0; k < 6; k++) if ((t + k * 3) % 14 < 10) dot((k * 0.37) % 1, (k * 0.23) % 0.8, 1, 1, '#ffffff'); const ph = (t % 40) / 40; if (ph < 0.4) for (let k = 0; k < 5; k++) dot(0.1 + ph * 2 - k * 0.04, 0.1 + ph * 1.5 - k * 0.03, 1, 1, k === 0 ? '#ffffff' : '#9ab8ff'); }
}
