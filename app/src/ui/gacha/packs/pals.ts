// 꾸밈 팩(상시 뽑기) — 모자 8 · 창밖 8 · 펑 대신 6 · 칭호 8 · 반장 액션 5 · 펫 친구 5. 그림체·좌표 뜻은 types.ts, 뽑기 풀은 domain/catalog/pals.ts
import type { Skin } from '../../office/skins';
import { BASE, type BossCtx, type Dot, type Pack, type R } from './types';

const O = '#2a1c14', W = '#ffffff';
const RAIN = ['#e5484d', '#ff9a3c', '#ffd27a', '#7cc48a', '#5aa0e6', '#a77be0'];
/** 겉선 두르기 — 사각형들을 한 칸 크게 line 색으로 먼저 칠하고 안을 c 로(흰 모자가 밝은 벽에 묻히지 않게) */
function lined(b: R, rs: [number, number, number, number][], c: string, line: string) {
  for (const [x, y, w, h] of rs) b.rect(x - 1, y - 1, w + 2, h + 2, line);
  for (const [x, y, w, h] of rs) b.rect(x, y, w, h, c);
}
/** 십자 반짝이 — s = 팔 길이(0 이면 한 점) */
function star(b: R, x: number, y: number, s: number, c: string) {
  b.rect(x - s, y, s * 2 + 1, 1, c); b.rect(x, y - s, 1, s * 2 + 1, c);
  if (s > 1) { b.rect(x - 1, y - 1, 3, 3, c); b.rect(x, y, 1, 1, W); }
}
/** 매 프레임 같은 값(무작위 대신) */
function hash(n: number) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// ── 모자 — (x, y) = 캐릭터 16×16 왼쪽 위, 머리 꼭대기 y+1. 귀 사이(y+1~y+2 가운데)를 덮어 틈이 안 나게 ──
const HAT: NonNullable<Pack['hat']> = {
  cap: (b, x, y) => {
    const C = '#e5484d', D = '#b8363b';
    b.rect(x + 5, y - 3, 7, 1, C); b.rect(x + 4, y - 2, 9, 3, C); b.rect(x + 3, y + 1, 11, 1, C);
    b.rect(x + 2, y + 2, 16, 1, D); b.rect(x + 8, y - 4, 1, 1, D); // 챙(오른쪽으로 삐죽)·꼭지 단추
    b.rect(x + 7, y - 1, 3, 2, W); b.rect(x + 5, y - 2, 1, 2, '#ff8a8e');
  },
  party: (b, x, y) => {
    for (let k = 0; k < 9; k++) { const w = 1 + Math.floor(k / 2) * 2; b.rect(x + 8 - Math.floor(w / 2), y - 6 + k, w, 1, Math.floor(k / 2) % 2 ? '#ffd27a' : '#5aa0e6'); }
    b.rect(x + 7, y - 8, 3, 2, '#ff6bd6'); b.rect(x + 6, y + 1, 1, 1, '#ff6bd6'); b.rect(x + 10, y - 1, 1, 1, '#ff6bd6');
  },
  sprout: (b, x, y) => {
    b.rect(x + 8, y - 3, 1, 6, '#4d9a57'); // 줄기가 머리 꼭대기(y+3)까지 내려온다
    b.rect(x + 5, y - 3, 3, 2, '#7cc48a'); b.rect(x + 4, y - 4, 2, 1, '#7cc48a'); b.rect(x + 6, y - 2, 2, 1, '#9ad08a');
    b.rect(x + 9, y - 4, 3, 2, '#7cc48a'); b.rect(x + 11, y - 5, 2, 1, '#7cc48a'); b.rect(x + 9, y - 3, 2, 1, '#9ad08a');
  },
  flower: (b, x, y) => {
    b.rect(x + 2, y + 1, 13, 2, '#4d9a57'); b.rect(x + 5, y, 1, 1, '#7cc48a'); b.rect(x + 9, y, 1, 1, '#7cc48a');
    for (const [dx, c] of [[2, '#f49ab8'], [6, '#ffd27a'], [10, W], [13, '#c08cf0']] as const) {
      b.rect(x + dx + 1, y - 1, 1, 3, c); b.rect(x + dx, y, 3, 1, c); b.rect(x + dx + 1, y, 1, 1, '#b8663f');
    }
  },
  detective: (b, x, y) => {
    const C = '#7a5c3e', D = '#5b4430';
    b.rect(x + 5, y - 3, 7, 1, C); b.rect(x + 4, y - 2, 9, 2, C); b.rect(x + 7, y - 3, 3, 1, D); // 가운데 움푹
    b.rect(x + 5, y - 2, 1, 2, '#9a7a56'); b.rect(x + 4, y, 9, 1, O); b.rect(x + 11, y - 2, 1, 2, '#e5484d'); // 띠·깃털
    b.rect(x + 1, y + 1, 15, 1, D); b.rect(x + 2, y + 2, 13, 1, D);
  },
  chef: (b, x, y) => {
    lined(b, [[x + 3, y - 7, 4, 1], [x + 8, y - 8, 4, 2], [x + 2, y - 6, 13, 4], [x + 4, y - 2, 9, 4]], W, '#b9b9c8');
    b.rect(x + 3, y - 3, 11, 1, '#e2e2ea'); b.rect(x + 6, y - 1, 1, 3, '#e2e2ea'); b.rect(x + 10, y - 1, 1, 3, '#e2e2ea');
  },
  pirate: (b, x, y) => {
    const K = '#2b2b33';
    b.rect(x + 5, y - 4, 7, 1, K); b.rect(x + 4, y - 3, 9, 3, K); b.rect(x + 1, y, 15, 2, K); b.rect(x, y - 1, 2, 1, K); b.rect(x + 15, y - 1, 2, 1, K);
    b.rect(x + 1, y + 2, 15, 1, '#e0b94f'); // 금테
    b.rect(x + 7, y - 3, 3, 3, W); b.rect(x + 7, y - 2, 1, 1, K); b.rect(x + 9, y - 2, 1, 1, K); b.rect(x + 6, y, 1, 1, W); b.rect(x + 10, y, 1, 1, W);
  },
  space: (b, x, y) => {
    const G = 'rgba(170,220,255,.55)', E = '#dbe8f5', S = '#9fb0c8';
    b.rect(x + 3, y - 2, 10, 1, G); b.rect(x + 1, y - 1, 14, 1, G); b.rect(x, y, 16, 10, G); // 유리(얼굴이 비친다)
    b.rect(x + 3, y - 3, 10, 1, E); b.rect(x + 1, y - 2, 2, 1, E); b.rect(x + 13, y - 2, 2, 1, E); b.rect(x, y - 1, 1, 1, E); b.rect(x + 15, y - 1, 1, 1, E);
    b.rect(x - 1, y, 1, 10, S); b.rect(x + 16, y, 1, 10, S);
    b.rect(x + 2, y + 1, 1, 3, 'rgba(255,255,255,.85)'); b.rect(x + 3, y, 2, 1, 'rgba(255,255,255,.85)');
    b.rect(x - 1, y + 10, 18, 2, '#c0c6d8'); b.rect(x - 1, y + 11, 18, 1, '#8a90a8'); b.rect(x + 7, y + 10, 2, 1, '#e5484d');
    b.rect(x + 12, y - 5, 1, 2, S); b.rect(x + 11, y - 7, 2, 2, '#e5484d');
  },
};

// ── 창밖 — icon 은 창 안(2..21, 2..15), scene 은 창 안 0..1(점 하나 = 2화소, 벽 따라 비스듬) ──
const U = 0.0514, V = 0.08; // 창 안 한 점(2화소)이 u·v 로 얼마인지
/** 창 밖으로 나가는 점은 안 그린다(가로지르는 것) */
const clip = (dot: Dot): Dot => (u, v, w, h, c) => { if (u >= 0 && u + w * U <= 1.03 && v >= 0 && v + h * V <= 1.06) dot(u, v, w, h, c); };
/** 창 가장자리에서 잘라 그린다(통째로 안 사라지게) — 폭은 1화소(0.5) 단위 */
const trim = (dot: Dot): Dot => (u, v, w, h, c) => {
  if (u < 0) { w -= -u / U; u = 0; }
  if (u + w * U > 1) w = (1 - u) / U;
  w = Math.floor(w * 2) / 2;
  if (w > 0) dot(u, v, w, h, c);
};
/** 세로 줄로 띠 칠하기 — 위 a(u) 에서 아래 z(u) 까지 */
function band(dot: Dot, a: (u: number) => number, z: (u: number) => number, c: string) {
  for (let u = 0; u < 0.98; u += U * 0.9) { const top = a(u); dot(u, top, 1, Math.max(1, Math.round((z(u) - top) / V) + 1), c); }
}
const to1 = () => 1;
/** 구름 — 가로지르며 흘러간다 */
function cloud(d: Dot, u: number, v: number, c = W) { d(u, v, 4, 1, c); d(u + U, v - V, 2, 1, c); }
const drift = (u0: number, t: number, s: number) => ((u0 + t * s) % 1.3) - 0.15;

const WINDOW: NonNullable<Pack['window']> = {
  sea: {
    sky: '#9fdcff',
    icon: (b) => {
      b.rect(17, 3, 3, 3, '#fff1a6'); b.rect(13, 5, 4, 1, W); b.rect(14, 4, 2, 1, W);
      b.rect(6, 4, 2, 4, W); b.rect(5, 6, 1, 2, W); b.rect(4, 8, 6, 1, '#8d5d3d');
      b.rect(2, 10, 20, 4, '#3f8fd6'); b.rect(2, 12, 20, 2, '#2f74b8'); for (let x = 2; x < 22; x += 4) b.rect(x, 10, 2, 1, '#e8f6ff');
      b.rect(2, 13, 20, 1, '#bfe8ff'); b.rect(2, 14, 20, 2, '#f2d79b');
    },
    scene: (t, dot) => {
      const d = clip(dot), crest = (u: number) => 0.52 + Math.sin(u * 14 + t / 4) * 0.025;
      dot(0.8, 0.06, 3, 3, '#fff1a6');
      for (const [u0, v] of [[0.1, 0.16], [0.6, 0.26]] as const) cloud(d, drift(u0, t, 0.0015), v);
      const bu = drift(0, t, 0.003); d(bu, 0.45, 3, 1, '#8d5d3d'); d(bu + U, 0.29, 1, 2, W); // 돛단배
      band(dot, crest, to1, '#3f8fd6'); band(dot, () => 0.74, to1, '#2f74b8');
      for (let u = 0; u < 0.98; u += U * 0.9) dot(u, crest(u), 1, 0.5, '#e8f6ff'); // 물마루
      for (let k = 0; k < 4; k++) { const ph = ((t + k * 9) % 36) / 36; d((k * 0.27 + ph * 0.1) % 0.9, 0.6 + ph * 0.24, 2, 0.5, `rgba(255,255,255,${(1 - ph).toFixed(2)})`); }
      band(dot, (u) => 0.88 + Math.sin(u * 9 - t / 5) * 0.03, to1, '#f2d79b');
    },
  },
  plane: {
    sky: '#a8d8ff',
    icon: (b) => {
      b.rect(4, 4, 5, 2, W); b.rect(5, 3, 3, 1, W); b.rect(15, 12, 5, 2, W); b.rect(16, 11, 3, 1, W);
      for (let k = 0; k < 11; k++) b.rect(2 + k, 13 - Math.floor(k * 0.6), 2, 1, 'rgba(255,255,255,.85)');
      b.rect(13, 6, 7, 2, W); b.rect(20, 7, 1, 1, W); b.rect(13, 4, 2, 2, '#e5484d'); b.rect(16, 8, 3, 1, '#c8d0dc'); b.rect(15, 6, 4, 1, '#5aa0e6');
    },
    scene: (t, dot) => {
      const d = clip(dot);
      for (const [u0, v, s] of [[0.1, 0.65, 0.0015], [0.6, 0.85, 0.001], [0.4, 0.15, 0.0008]] as const) cloud(d, drift(u0, t, s), v);
      const ph = (t % 160) / 160, u = -0.2 + ph * 1.4, v = 0.45 - ph * 0.25;
      for (let k = 1; k < 12; k++) d(u - k * U, v + V * 0.25 + k * 0.0093, 1, 0.5, `rgba(255,255,255,${(0.9 - k * 0.07).toFixed(2)})`); // 꼬리 구름
      d(u, v, 3, 1, W); d(u, v - V, 1, 1, '#e5484d'); d(u + U, v + V, 1, 0.5, '#c8d0dc'); d(u + U * 0.5, v, 2, 0.5, '#5aa0e6');
    },
  },
  sunflower: {
    sky: '#8fd3ff',
    icon: (b) => {
      b.rect(18, 3, 3, 3, '#fff1a6'); b.rect(2, 11, 20, 5, '#4d9a57');
      for (const x of [4, 9, 13, 17]) b.rect(x, 12, 2, 1, '#ffc93c');
      for (const [x, y] of [[3, 5], [8, 6], [14, 5], [18, 7]] as const) { b.rect(x + 1, y + 3, 1, 5, '#2f6b35'); b.rect(x, y, 3, 3, '#ffc93c'); b.rect(x + 1, y + 1, 1, 1, '#8d5d3d'); }
    },
    scene: (t, dot) => {
      const d = clip(dot);
      dot(0.85, 0.06, 2, 2, '#fff1a6'); cloud(d, drift(0.2, t, 0.001), 0.18);
      band(dot, () => 0.62, to1, '#4d9a57');
      for (let k = 0; k < 8; k++) dot(0.03 + k * 0.122, 0.7, 1, 0.5, '#ffc93c'); // 뒷줄
      for (let k = 0; k < 5; k++) {
        const u = 0.04 + k * 0.2, v = 0.46 + (k % 2) * 0.1, sw = (Math.floor((t + k * 5) / 6) % 2) * U * 0.5;
        dot(u + U * 0.5, v + V * 2, 0.5, 4, '#2f6b35'); dot(u + sw, v, 2, 2, '#ffc93c'); dot(u + sw + U * 0.5, v + V * 0.5, 1, 1, '#8d5d3d');
      }
      const bu = 0.5 + Math.sin(t / 9) * 0.3, bv = 0.3 + Math.sin(t / 4.5) * 0.08; d(bu, bv, 1, 1, '#ffd27a'); d(bu + U * 0.5, bv, 0.5, 1, O); // 꿀벌
    },
  },
  balloon: {
    sky: '#bfe5ff',
    icon: (b) => {
      b.rect(3, 12, 6, 2, W); b.rect(4, 11, 3, 1, W); b.rect(16, 13, 5, 2, W);
      b.rect(5, 5, 3, 3, '#5aa0e6'); b.rect(6, 8, 1, 1, '#8d5d3d');
      b.rect(14, 2, 5, 1, '#e5484d'); b.rect(13, 3, 7, 4, '#e5484d'); b.rect(14, 7, 5, 1, '#e5484d'); b.rect(16, 2, 1, 6, '#ffd27a');
      b.rect(14, 8, 1, 2, O); b.rect(18, 8, 1, 2, O); b.rect(14, 10, 5, 2, '#8d5d3d');
    },
    scene: (t, dot) => {
      const d = clip(dot);
      for (const [u0, v, s] of [[0.05, 0.7, 0.0012], [0.55, 0.15, 0.0008]] as const) cloud(d, drift(u0, t, s), v);
      const ball = (u: number, v: number, c: string) => {
        d(u + U * 0.5, v, 2, 1, c); d(u, v + V, 3, 2, c); d(u + U, v, 1, 3, '#ffd27a'); d(u + U * 0.5, v + V * 3, 2, 0.5, c);
        d(u + U * 0.5, v + V * 3.5, 0.5, 1, O); d(u + U * 2, v + V * 3.5, 0.5, 1, O); d(u + U * 0.5, v + V * 4.5, 2, 1, '#8d5d3d');
      };
      const fu = 0.12 + Math.sin(t / 70 + 2) * 0.05, fv = 0.42 + Math.sin(t / 15) * 0.03; d(fu, fv, 1, 1, '#5aa0e6'); d(fu + U * 0.25, fv + V, 0.5, 0.5, '#8d5d3d');
      ball(0.4 + Math.sin(t / 50) * 0.18, 0.2 + Math.sin(t / 12) * 0.04, '#e5484d');
      band(dot, (u) => 0.86 + Math.sin(u * 5) * 0.05, to1, '#7cc48a');
    },
  },
  peak: {
    sky: '#cfe6f5',
    icon: (b) => {
      const mt = (cx: number, top: number, c: string) => { for (let r = 0; top + r < 16; r++) { const l = Math.max(2, cx - r), rr = Math.min(21, cx + r); b.rect(l, top + r, rr - l + 1, 1, r < 3 ? W : c); } };
      b.rect(3, 4, 4, 1, W); b.rect(4, 3, 2, 1, W);
      mt(16, 5, '#9aa8c4'); mt(8, 3, '#7a8aa8'); b.rect(7, 6, 1, 1, W); b.rect(10, 6, 1, 1, W);
      b.rect(2, 13, 20, 3, '#5d8a6a'); b.rect(2, 12, 6, 1, '#5d8a6a'); b.rect(15, 12, 7, 1, '#5d8a6a');
    },
    scene: (t, dot) => {
      const d = clip(dot);
      const mt = (cu: number, top: number, slope: number, c: string) => {
        for (let u = 0; u < 0.98; u += U * 0.9) {
          const v = top + Math.abs(u - cu) * slope;
          if (v >= 1) continue;
          dot(u, v, 1, Math.round((1 - v) / V) + 1, c);
          if (v < top + 0.16) dot(u, v, 1, Math.ceil((top + 0.16 - v) / V), W); // 눈 모자
        }
      };
      cloud(d, drift(0.3, t, 0.0007), 0.12);
      mt(0.72, 0.28, 1.3, '#9aa8c4'); mt(0.3, 0.12, 1.5, '#7a8aa8');
      cloud(d, drift(0.8, t, 0.0011), 0.45, 'rgba(255,255,255,.85)');
      for (let k = 0; k < 3; k++) if ((t + k * 7) % 20 < 4) dot(0.26 + k * 0.05, 0.18 + k * 0.03, 0.5, 0.5, '#fff6c2'); // 눈 반짝
      band(dot, (u) => 0.84 + Math.sin(u * 7) * 0.04, to1, '#5d8a6a');
    },
  },
  whale: {
    sky: '#c9b8f0',
    icon: (b) => {
      const B = '#5a7fd6';
      b.rect(3, 13, 6, 2, '#ffd6e8'); b.rect(4, 12, 3, 1, '#ffd6e8'); b.rect(15, 12, 6, 2, '#ffd6e8'); b.rect(19, 3, 1, 1, W); b.rect(4, 10, 1, 1, W);
      b.rect(6, 4, 10, 4, B); b.rect(16, 5, 2, 3, B); b.rect(4, 5, 2, 2, B); b.rect(2, 3, 3, 2, B); b.rect(2, 7, 3, 2, B);
      b.rect(8, 7, 8, 1, '#bcd0ff'); b.rect(15, 5, 1, 1, O); b.rect(14, 6, 1, 1, '#f49ab8');
      b.rect(13, 2, 1, 1, W); b.rect(15, 2, 1, 1, W); b.rect(14, 3, 1, 1, W);
    },
    scene: (t, dot) => {
      const d = clip(dot), B = '#5a7fd6';
      for (const [u0, v, s] of [[0.1, 0.8, 0.0012], [0.6, 0.65, 0.0009], [0.35, 0.12, 0.0006]] as const) cloud(d, drift(u0, t, s), v, '#ffd6e8');
      for (let k = 0; k < 5; k++) if ((t + k * 5) % 18 < 13) dot((k * 0.23 + 0.05) % 1, (k * 0.17) % 0.5, 0.5, 0.5, W);
      const u = -0.45 + ((t % 300) / 300) * 1.7, v = 0.35 + Math.sin(t / 20) * 0.03;
      const e = trim(dot), f = t % 8 < 4 ? 0 : 0.5;
      e(u + U, v - V * 0.5, 5, 0.5, B); e(u, v, 7, 3, B); e(u + U * 7, v + V * 0.5, 1, 2, B); e(u + U * 1.5, v + V * 2, 5.5, 1, '#bcd0ff');
      e(u + U * 3, v + V * 3, 1.5, 0.5, B); e(u - U, v + V, 1, 1, B); e(u - U * 2, v - f * V, 1, 1.5, B); e(u - U * 2, v + V * (1.5 + f), 1, 1.5, B); // 지느러미·꼬리
      e(u + U * 6, v + V, 0.5, 0.5, O); e(u + U * 5.5, v + V * 1.5, 0.5, 0.5, '#f49ab8');
      if (t % 40 < 16) { e(u + U * 5, v - V * 1.5, 0.5, 1, W); e(u + U * 4.5, v - V * 2, 0.5, 0.5, W); e(u + U * 5.5, v - V * 2, 0.5, 0.5, W); } // 물 뿜기
    },
  },
  storm: {
    sky: '#2c3350',
    icon: (b) => {
      b.rect(2, 2, 20, 3, '#1c2136'); b.rect(4, 5, 6, 1, '#1c2136'); b.rect(15, 5, 5, 1, '#1c2136');
      for (const [x, y] of [[3, 7], [6, 11], [9, 6], [18, 10], [20, 6], [4, 13], [17, 13]] as const) b.rect(x, y, 1, 2, '#8a99ad');
      for (const [x, y, w] of [[14, 5, 2], [13, 6, 2], [12, 7, 4], [14, 8, 2], [13, 10, 2], [12, 11, 2], [12, 12, 1], [12, 13, 1]] as const) b.rect(x, y, w, 1, '#fff6a0');
    },
    scene: (t, dot) => {
      const d = clip(dot), cyc = t % 48, n = Math.floor(t / 48);
      if (cyc < 2) band(dot, () => 0, to1, 'rgba(255,255,255,.28)'); // 번쩍
      for (let k = 0; k < 14; k++) d((k * 0.071 + t * 0.012) % 0.97, (k * 0.19 + t * 0.11) % 0.95, 0.5, 1.5, '#8a99ad');
      if (cyc < 5) {
        const bu = 0.15 + ((n * 0.37) % 0.7), pt = (s: number) => bu + ((s * 7 + n) % 3 - 1) * U * 1.5;
        for (let s = 0; s < 6; s++) for (let q = 0; q < 4; q++) d(pt(s) + (pt(s + 1) - pt(s)) * (q / 4), 0.1 + (s + q / 4) * 0.14, 1, 1, '#fff6a0'); // 이어진 번개
      }
      band(dot, () => 0, (u) => 0.14 + Math.sin(u * 11 + t / 30) * 0.05, '#1c2136');
    },
  },
  galaxy: {
    sky: '#0a0a26',
    icon: (b) => {
      const C = ['#c08cf0', '#7fd1ff', '#ff9ad6', '#fff1c8'];
      for (let x = 2; x < 22; x++) { const y = 14 - Math.floor((x - 2) * 0.55); b.rect(x, y - 1, 1, 3, '#2a2060'); b.rect(x, y + ((x * 7) % 3) - 1, 1, 1, C[x % 4]!); }
      for (const [x, y] of [[4, 4], [9, 3], [19, 4], [6, 9], [14, 14], [20, 9]] as const) b.rect(x, y, 1, 1, W);
      b.rect(16, 10, 4, 4, '#e0a36b'); b.rect(19, 10, 1, 4, '#b8663f'); b.rect(14, 12, 8, 1, '#fff1c8');
    },
    scene: (t, dot) => {
      const C = ['#c08cf0', '#7fd1ff', '#ff9ad6', '#fff1c8', '#9ef0e0'];
      for (let k = 0; k < 12; k++) if ((t + k * 5) % 20 < 14) dot((k * 0.29 + 0.03) % 0.97, (k * 0.37) % 0.95, 0.5, 0.5, W);
      for (let k = 0; k < 35; k++) {
        const u = (k / 35) * 0.96, vc = 0.1 + u * 0.78; // 벽이 오른쪽으로 내려가서 왼쪽 위 → 오른쪽 아래로 그어야 비스듬히 보인다
        dot(u, vc - V * 0.5, 1, 1.5, 'rgba(90,70,170,.55)');
        if ((k * 3 + t) % 9 < 7) dot(u, vc + ((k * 37) % 7 - 3) * 0.03, 0.5, 0.5, C[(k + Math.floor(t / 4)) % C.length]!);
      }
      const pu = 0.1, pv = 0.6 + Math.sin(t / 40) * 0.02;
      dot(pu + U * 0.5, pv, 2, 3, '#e0a36b'); dot(pu, pv + V * 0.5, 3, 2, '#e0a36b'); dot(pu + U * 2, pv + V * 0.5, 0.5, 2, '#b8663f'); dot(pu - U, pv + V * 1.25, 5, 0.5, '#fff1c8'); // 고리 행성
    },
  },
};

// ── 펑 대신 — 세션이 생기거나 사라진 자리. f = 0..1 ──
function bub(b: R, x: number, y: number, s: number) {
  const E = '#7fc4e8';
  b.rect(x + 1, y, s - 2, 1, E); b.rect(x + 1, y + s - 1, s - 2, 1, E); b.rect(x, y + 1, 1, s - 2, E); b.rect(x + s - 1, y + 1, 1, s - 2, E);
  b.rect(x + 1, y + 1, s - 2, s - 2, 'rgba(210,244,255,.6)'); b.rect(x + 1, y + 1, 1, 1, W);
}
function coin(b: R, x: number, y: number, ph: number) {
  const w = [3, 2, 1, 2][ph]!;
  if (w === 1) return b.rect(x, y - 1, 1, 3, '#b3871f');
  b.rect(x - 1, y - 1, w, 3, '#e0b94f'); b.rect(x - 1, y + 1, w, 1, '#b3871f'); b.rect(x - 1, y - 1, 1, 1, '#fff1a6');
}
const LEAF = ['#7cc48a', '#4d9a57', '#e0a020', '#d9786b'];
function leaf(b: R, x: number, y: number, flip: boolean, c: string) {
  if (flip) { b.rect(x, y, 2, 1, c); b.rect(x + 1, y + 1, 2, 1, c); } else { b.rect(x + 1, y, 2, 1, c); b.rect(x, y + 1, 2, 1, c); }
}
const NOTE = ['#ff6bd6', '#5aa0e6', '#7cc48a', '#ffb33b'];
function note(b: R, x: number, y: number, two: boolean, c: string) {
  b.rect(x, y, 2, 2, c); b.rect(x + 1, y - 4, 1, 4, c);
  if (two) { b.rect(x + 4, y, 2, 2, c); b.rect(x + 5, y - 4, 1, 4, c); b.rect(x + 1, y - 4, 5, 1, c); } else b.rect(x + 2, y - 4, 1, 2, c);
}
const GL = ['#ffffff', '#7cf0b0', '#fff1a6'];

const FX: NonNullable<Pack['fx']> = {
  stardust: {
    icon: (b) => {
      star(b, 11, 9, 3, '#ffc93c');
      for (const [x, y, s, c] of [[4, 4, 1, '#ff9ad6'], [18, 3, 1, '#ffc93c'], [3, 14, 1, '#7fd1ff'], [19, 14, 1, '#ff9ad6'], [9, 17, 0, '#ffc93c'], [17, 9, 0, '#7fd1ff'], [6, 9, 0, '#ffc93c'], [13, 2, 0, '#ff9ad6']] as const) star(b, x, y, s, c);
    },
    burst: (b, P, _sk, gx, gy, f) => {
      const [cx, cy] = P(gx, gy, 8);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + f * 2.4, r = 3 + f * 18;
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.6 - f * 8);
        star(b, x, y, f < 0.75 && (k + Math.floor(f * 16)) % 3 === 0 ? 1 : 0, ['#ffc93c', '#ff9ad6', '#7fd1ff', W][k % 4]!);
      }
      if (f < 0.3) star(b, Math.round(cx), Math.round(cy) - 2, 2, '#ffc93c');
    },
  },
  bubble: {
    icon: (b) => { for (const [x, y, s] of [[2, 8, 7], [11, 1, 8], [15, 12, 6], [8, 15, 4], [20, 6, 3]] as const) bub(b, x, y, s); },
    burst: (b, P, _sk, gx, gy, f) => {
      const [cx, cy] = P(gx, gy, 8);
      for (let k = 0; k < 8; k++) {
        const end = 0.62 + (k % 4) * 0.1, x = Math.round(cx + (k - 3.5) * 4 * Math.min(1, f * 3) + Math.sin(f * 7 + k) * 2), y = Math.round(cy - 2 - f * (16 + (k % 3) * 5));
        if (f < end) bub(b, x, y, 3 + (k % 3) + Math.round(f * 2));
        else if (f < end + 0.08) for (const [dx, dy] of [[-2, 0], [3, 0], [0, -2], [0, 3]] as const) b.rect(x + dx + 1, y + dy + 1, 1, 1, '#bfe8ff'); // 톡
      }
    },
  },
  coin: {
    icon: (b) => {
      const big = (x: number, y: number) => { b.rect(x + 1, y, 4, 6, '#e0b94f'); b.rect(x, y + 1, 6, 4, '#e0b94f'); b.rect(x + 2, y + 2, 2, 2, '#c99a2e'); b.rect(x + 1, y + 1, 1, 1, '#fff1a6'); b.rect(x + 1, y + 5, 4, 1, '#b3871f'); };
      big(9, 7); big(2, 11); big(16, 12); b.rect(5, 3, 2, 6, '#b3871f'); b.rect(18, 3, 3, 5, '#e0b94f'); b.rect(18, 7, 3, 1, '#b3871f');
      star(b, 14, 3, 1, '#fff1a6'); star(b, 21, 17, 0, W);
    },
    burst: (b, P, _sk, gx, gy, f) => {
      const [cx, cy] = P(gx, gy, 8);
      for (let k = 0; k < 9; k++) {
        const H = 14 + (k % 3) * 5, x = Math.round(cx + (k - 4) * 1.7 * f * 8), y = Math.round(cy - 4 - H * 4 * f * (1 - f) + f * 8);
        coin(b, x, y, (Math.floor(f * 24) + k) % 4);
      }
      if (f > 0.3 && f < 0.6) star(b, Math.round(cx), Math.round(cy) - 22, 1, '#fff1a6');
    },
  },
  leaf: {
    icon: (b) => {
      const big = (x: number, y: number, c: string) => { b.rect(x + 3, y, 3, 1, c); b.rect(x + 1, y + 1, 4, 1, c); b.rect(x, y + 2, 3, 1, c); b.rect(x - 1, y + 3, 1, 1, '#8d5d3d'); };
      big(4, 3, LEAF[0]!); big(14, 2, LEAF[2]!); big(9, 9, LEAF[1]!); big(17, 12, LEAF[3]!); big(3, 14, LEAF[2]!);
      leaf(b, 12, 16, true, LEAF[0]!); leaf(b, 20, 6, false, LEAF[1]!);
    },
    burst: (b, P, _sk, gx, gy, f) => {
      const [cx, cy] = P(gx, gy, 8);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, r = 3 + Math.min(f, 0.5) * 24;
        const x = Math.round(cx + Math.cos(a) * r + Math.sin(f * 9 + k) * 3), y = Math.round(cy - 6 + Math.sin(a) * r * 0.5 + f * f * 16);
        leaf(b, x, y, (Math.floor(f * 10) + k) % 2 === 0, LEAF[k % 4]!);
      }
    },
  },
  note: {
    icon: (b) => {
      const big = (x: number, y: number, c: string) => { b.rect(x, y + 6, 3, 2, c); b.rect(x + 1, y + 8, 2, 1, c); b.rect(x + 2, y, 1, 6, c); b.rect(x + 3, y, 2, 1, c); b.rect(x + 4, y + 1, 1, 2, c); };
      big(3, 3, NOTE[0]!); big(15, 9, NOTE[1]!);
      b.rect(10, 7, 2, 2, NOTE[2]!); b.rect(15, 1, 2, 2, NOTE[2]!); b.rect(11, 1, 1, 6, NOTE[2]!); b.rect(16, -1, 1, 3, NOTE[2]!); b.rect(11, 0, 6, 1, NOTE[2]!); // 이은 음표
      note(b, 4, 17, false, NOTE[3]!);
    },
    burst: (b, P, _sk, gx, gy, f) => {
      const [cx, cy] = P(gx, gy, 8);
      for (let k = 0; k < 6; k++) {
        const s = f * 1.2 - k * 0.06;
        if (s <= 0 || s >= 1) continue;
        note(b, Math.round(cx + (k - 2.5) * 5 + Math.sin(s * 9 + k) * 3), Math.round(cy - 2 - s * (18 + (k % 3) * 4)), k % 2 === 0, NOTE[k % 4]!);
      }
    },
  },
  glitch: {
    icon: (b) => {
      b.rect(5, 6, 14, 9, '#1b1430');
      for (const [x, y, w, h] of [[4, 2, 9, 2], [10, 5, 10, 2], [2, 8, 7, 3], [12, 9, 6, 2], [6, 12, 12, 2], [3, 16, 5, 1], [15, 15, 6, 2]] as const) {
        b.rect(x - 1, y, w, h, '#ff2bd6'); b.rect(x + 1, y, w, h, '#00f0ff'); b.rect(x, y, w, h, GL[(x + y) % 3]!);
      }
    },
    burst: (b, P, _sk, gx, gy, f) => {
      const [x0, y0] = P(gx, gy, 8), cx = Math.round(x0), cy = Math.round(y0);
      if (f < 0.72) {
        const step = Math.floor(f * 18), spread = 4 + f * 18;
        for (let k = 0; k < 12; k++) {
          const h = hash(k * 31 + step * 17), w = 2 + (h % 7), hh = 1 + ((h >>> 11) % 2);
          const x = Math.round(cx - spread - w / 2 + ((h >>> 3) % Math.round(spread * 2))), y = Math.round(cy - 10 - spread * 0.4 + ((h >>> 7) % Math.round(10 + spread * 0.8)));
          b.rect(x - 1, y, w, hh, '#ff2bd6'); b.rect(x + 1, y, w, hh, '#00f0ff'); b.rect(x, y, w, hh, GL[(h >>> 13) % 3]!);
        }
      } else { // 옛 화면 꺼지듯 한 줄로 줄어든다
        const s = 1 - (f - 0.72) / 0.28;
        b.rect(Math.round(cx - 20 * s), cy - 6, Math.max(1, Math.round(40 * s)), 1, W);
        if (s < 0.4) b.rect(cx - 1, cy - 7, 3, 3, W);
      }
    },
  },
};

// ── 칭호 — 도감 띠 색(글자는 카탈로그 이름) ──
const TITLE: NonNullable<Pack['title']> = {
  tdd: '#5aa0e6', rollback: '#8a99ad', inbox: '#3fbfb0', hotfix: '#ff7a3c', refactor: '#f49ab8', poet: '#c9a26b', offwork: '#9ad04a', friday: '#ff3d7f',
};

// ── 반장 액션 — 매 프레임 불린다. 크게 움직이는 건 idle(말풍선 없음)일 때만. 캐릭터 = (px-8, py-17) 16×16 ──
/** 겉선 두른 팔·발(채움은 캐릭터 색) */
const paw = (b: R, x: number, y: number, w: number, h: number, c: BossCtx) => { b.rect(x, y, w, h, c.sk.line); b.rect(x + 1, y + 1, w - 2, h - 2, c.fill); };
/** 글자 그림(# = 칠) — 종이색 + 선색 겉선으로 어느 벽에서도 보이게(겉선이 획 사이를 메워 구멍이 없다) */
function glyph(b: R, rows: string[], x: number, y: number, c: string, line: string) {
  rows.forEach((row, r) => [...row].forEach((ch, i) => { if (ch === '#') b.rect(x + i - 1, y + r - 1, 3, 3, line); }));
  rows.forEach((row, r) => [...row].forEach((ch, i) => { if (ch === '#') b.rect(x + i, y + r, 1, 1, c); }));
}
const Z3 = ['###', '..#', '.#.', '###'], Z4 = ['####', '...#', '..#.', '.#..', '####'];
const BALL = ['#e5484d', '#ffd27a', '#5aa0e6'];
/** 도감 아이콘 — 곰(4,3)에 맞춘 자리로 boss 를 한 프레임 그린다 */
const pose = (boss: (b: R, c: BossCtx) => void, t: number) => (b: R) => boss(b, { hx: 12, hy: -2, px: 12, py: 20, t, fill: '#ffc6d9', sk: BASE, idle: true });

const stretch = (b: R, c: BossCtx) => {
  const p = c.t % 72;
  if (!c.idle || p >= 16) return;
  const lift = p < 3 ? p * 2 : p > 12 ? (16 - p) * 2 : 6, top = c.py - 12 - lift;
  for (const x of [c.px - 9, c.px + 6]) { paw(b, x, top + 3, 3, c.py - 11 - top, c); paw(b, x - 1, top, 5, 4, c); } // 팔 + 손(머리 옆에 붙여 틈 없이)
  if (lift === 6 && c.t % 4 < 2) { b.rect(c.px - 14, top + 1, 2, 1, c.sk.line); b.rect(c.px + 12, top + 1, 2, 1, c.sk.line); star(b, c.hx, c.hy - 1, 1, '#ffd27a'); }
};
const doze = (b: R, c: BossCtx) => {
  const p = c.t % 112;
  if (!c.idle || p >= 96) return;
  if (p < 84) {
    for (let k = 0; k < 3; k++) {
      const a = (p + k * 28) % 84;
      if (a < 70) glyph(b, a > 40 ? Z4 : Z3, c.hx + 5 + Math.floor(a / 7), c.hy + 4 - Math.floor(a / 4), c.sk.paper, c.sk.line);
    }
  } else { // 화들짝
    b.rect(c.hx - 2, c.hy - 9, 4, 11, c.sk.paper); b.rect(c.hx - 1, c.hy - 8, 2, 6, '#d9462f'); b.rect(c.hx - 1, c.hy - 1, 2, 2, '#d9462f');
    if (c.t % 4 < 2) { b.rect(c.hx - 10, c.hy + 4, 1, 3, c.sk.line); b.rect(c.hx + 10, c.hy + 4, 1, 3, c.sk.line); }
    b.rect(c.hx + 7, c.hy + 6, 2, 3, '#8fd0ff'); b.rect(c.hx + 8, c.hy + 5, 1, 1, '#8fd0ff');
  }
};
const phone = (b: R, c: BossCtx) => {
  const p = c.t % 128;
  if (!c.idle || p >= 72) return;
  if (p < 12) { // 울림 — 책상 위에서 부르르
    const j = c.t % 2, x = c.px + 9 + j, y = c.py - 9;
    b.rect(x, y, 3, 5, '#2e2a30'); b.rect(x + 1, y + 1, 1, 2, '#7fd1ff');
    if (c.t % 4 < 2) { b.rect(x - 2, y, 1, 3, c.sk.line); b.rect(x + 4, y, 1, 3, c.sk.line); }
    return;
  }
  b.rect(c.px + 6, c.py - 16, 3, 7, '#2e2a30'); b.rect(c.px + 7, c.py - 15, 1, 1, '#7fd1ff');
  paw(b, c.px + 4, c.py - 10, 5, 5, c);
  if (Math.floor(p / 8) % 2) { // 수다 — 점 셋이 차오른다
    const n = 1 + (Math.floor(p / 3) % 3);
    b.rect(c.hx - 13, c.hy - 2, 9, 5, c.sk.paper); b.rect(c.hx - 12, c.hy - 3, 7, 1, c.sk.paper); b.rect(c.hx - 6, c.hy + 3, 2, 1, c.sk.paper);
    for (let k = 0; k < n; k++) b.rect(c.hx - 11 + k * 2, c.hy, 1, 1, c.sk.line);
  }
};
const juggle = (b: R, c: BossCtx) => {
  if (!c.idle) return;
  const lx = c.px - 10, rx = c.px + 6, hy = c.py - 11; // 손은 머리 옆에 붙여(틈 없이)
  for (let k = 0; k < 3; k++) {
    const ph = ((c.t + k * 8) % 24) / 24;
    let x: number, y: number;
    if (ph < 0.66) { const s = ph / 0.66; x = lx + 1 + s * 17; y = hy - 2 - Math.sin(s * Math.PI) * 16; } // 높이 넘기고
    else { const s = (ph - 0.66) / 0.34; x = rx + 1 - s * 17; y = hy - 1; } // 아래로 건넨다
    const bx = Math.round(x), by = Math.round(y);
    b.rect(bx, by, 3, 3, BALL[k]!); b.rect(bx, by, 1, 1, W);
  }
  paw(b, lx, hy, 4, 4, c); paw(b, rx, hy, 4, 4, c);
};
/** 든 손 — 팔(x 부터 4칸) + 손바닥(손가락 금 둘). y = 손 꼭대기 */
const palm = (b: R, x: number, y: number, c: BossCtx) => { paw(b, x, y + 5, 4, 9, c); paw(b, x - 1, y, 6, 6, c); b.rect(x + 1, y + 1, 1, 2, c.sk.line); b.rect(x + 3, y + 1, 1, 2, c.sk.line); };
const highfive = (b: R, c: BossCtx) => {
  const p = c.t % 56;
  if (!c.idle || p >= 36) return;
  const cx = c.px + 13, cy = c.py - 20;
  palm(b, c.px + 6, c.py - 22, c); // 번쩍 든 손(머리 옆에 붙여)
  const gx = p < 10 ? c.px + 30 - p * 1.6 : p < 22 ? c.px + 14 : c.px + 14 + (p - 22) * 1.6, x = Math.round(gx);
  b.rect(x + 6, cy - 1, 9, 3, '#ffd27a'); b.rect(x, cy - 2, 7, 6, c.sk.line); b.rect(x + 1, cy - 1, 5, 4, W); b.rect(x + 2, cy - 1, 1, 2, c.sk.line); b.rect(x + 4, cy - 1, 1, 2, c.sk.line); // 날아온 하얀 장갑
  if (p >= 10 && p < 22) { // 짝!
    const r = Math.min(6, (p - 10) + 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) for (let s = 3; s <= r; s++) b.rect(cx + dx * s, cy + dy * s, 1, 1, '#ffd27a');
    star(b, cx, cy, 2, '#fff1a6');
  }
  if (p >= 10) for (let k = 0; k < 10; k++) { // 색종이
    const a = (k / 10) * Math.PI * 2, r = (p - 10) * 1.3;
    b.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.7 + (p - 10) ** 2 * 0.04), 2, 1, RAIN[k % RAIN.length]!);
  }
};
const ACTION: NonNullable<Pack['action']> = {
  stretch: { icon: pose(stretch, 8), boss: stretch },
  doze: { icon: (b) => { glyph(b, Z3, 21, 7, W, O); glyph(b, Z4, 19, 0, W, O); }, boss: doze },
  phone: { icon: pose(phone, 30), boss: phone },
  juggle: { icon: pose(juggle, 3), boss: juggle },
  highfive: { icon: (b) => { // 짝 직전 — 손이 칸 밖으로 안 나가게 따로
    const c: BossCtx = { hx: 12, hy: -2, px: 12, py: 20, t: 0, fill: '#ffc6d9', sk: BASE, idle: true };
    palm(b, 18, -2, c); star(b, 13, 0, 1, '#ffd27a'); star(b, 25, 6, 1, '#fff1a6');
    for (const [x, y, k] of [[1, 2, 0], [24, -1, 4], [2, 15, 3], [24, 12, 5], [14, -3, 1]] as const) b.rect(x, y, 2, 1, RAIN[k]!);
  }, boss: highfive },
};

// ── 펫 친구 — (x, y) = 발 가운데, 12×10 안, 오른쪽 보기가 기본(flip = 왼쪽). 도감 아이콘은 같은 그림을 두 배로 ──
type Part = [number, number, number, number, string];
function parts(b: R, x: number, y: number, flip: boolean, ps: Part[]) {
  const x0 = x - 6, y0 = y - 10;
  for (const [dx, dy, w, h, c] of ps) b.rect(flip ? x0 + 12 - dx - w : x0 + dx, y0 + dy, w, h, c);
}
const x2 = (b: R): R => ({ rect: (x, y, w, h, c) => b.rect(x * 2, y * 2, w * 2, h * 2, c) });
type Walk = (b: R, x: number, y: number, flip: boolean, t: number, sk: Skin) => void;
const pal = (walk: Walk, t: number) => ({ icon: (b: R) => walk(x2(b), 6, 10, false, t, BASE), walk });

const dog: Walk = (b, x, y, flip, t, sk) => {
  const F = '#e0b07a', D = '#a8743f', s = t % 4 < 2 ? 0 : 1;
  parts(b, x, y, flip, [
    ...(s ? [[0, 2, 1, 2, F], [1, 3, 1, 1, F]] : [[1, 1, 1, 3, F]]) as Part[], // 꼬리 흔들
    [1, 4, 8, 3, F], [2, 6, 5, 1, '#f2d0a0'], [7, 1, 4, 4, F], [11, 3, 1, 2, F], [11, 3, 1, 1, sk.line], [7, 1, 2, 3, D], [9, 2, 1, 1, sk.line], [7, 4, 2, 1, '#e5484d'],
    [1, 7, 1, 2 + s, D], [3, 7, 1, 3 - s, D], [6, 7, 1, 2 + s, D], [8, 7, 1, 3 - s, D],
  ]);
};
const hamster: Walk = (b, x, y, flip, t, sk) => {
  const F = '#f0b870', h = t % 6 < 3 ? 0 : 1, s = t % 4 < 2 ? 0 : 1;
  parts(b, x, y - h, flip, [
    [3, 3, 6, 1, F], [2, 4, 8, 5, F], [1, 6, 1, 1, F], [6, 6, 3, 2, '#fff1d8'], [6, 2, 2, 2, F], [7, 3, 1, 1, '#f49ab8'],
    [8, 4, 1, 1, sk.line], [10, 5, 1, 1, '#f49ab8'], [9, 6, 1, 1, '#ffb0a0'], [3 + s, 9, 1, 1, '#f49ab8'], [7 - s, 9, 1, 1, '#f49ab8'],
  ]);
};
const turtle: Walk = (b, x, y, flip, t, sk) => {
  const S = '#4d9a57', K = '#9ad08a', s = Math.floor(t / 4) % 2;
  parts(b, x, y, flip, [
    [0, 6, 1, 1, K], [2, 7, 2, 1 + s, K], [7, 7, 2, 2 - s, K], [9, 5, 3, 2, K], [11, 5, 1, 1, sk.line],
    [3, 3, 6, 1, S], [2, 4, 8, 2, S], [3, 4, 2, 1, '#7cc48a'], [6, 4, 2, 1, '#7cc48a'], [5, 5, 1, 1, '#7cc48a'], [1, 6, 10, 1, '#35743f'],
  ]);
};
const parrot: Walk = (b, x, y, flip, t, sk) => {
  const R = '#e5484d', B = '#5aa0e6', h = [0, 1, 2, 1, 0, 0, 0, 0][t % 8]!;
  parts(b, x, y - h, flip, [
    [2, 7, 2, 1, B], [1, 8, 2, 1, B], [0, 9, 2, 1, '#ffd27a'], // 꼬리
    [6, 2, 4, 3, R], [10, 3, 1, 1, '#f2e6c8'], [10, 4, 1, 1, '#3b3742'], [8, 3, 1, 1, sk.line], [5, 5, 4, 4, R],
    ...(h ? [[3, 3, 3, 3, B], [3, 3, 1, 1, '#ffd27a']] : [[4, 5, 3, 3, B], [4, 8, 2, 1, '#ffd27a']]) as Part[], // 날개 파닥
    [6, 9, 1, 1, '#7a6a5a'], [8, 9, 1, 1, '#7a6a5a'],
  ]);
};
const robovac: Walk = (b, x, y, flip, t) => {
  const Wh = '#ececf2', rim: [number, number][] = [[3, 5], [5, 5], [7, 5], [9, 6], [10, 7], [8, 8], [5, 8], [2, 8], [1, 7], [2, 6]];
  const lit = rim[t % rim.length]!, flag = RAIN[Math.floor(t / 4) % RAIN.length]!;
  parts(b, x, y, flip, [
    [4, 1, 1, 4, '#3b3742'], [5, 1, 3, 2, flag], // 깃발 안테나
    [3, 5, 6, 1, Wh], [1, 6, 10, 2, Wh], [2, 8, 8, 1, '#9aa0b8'], [3, 9, 6, 1, '#6a7088'], [5, 6, 2, 1, '#3b3742'],
    [8, 6, 1, 1, t % 8 < 4 ? '#39f3ff' : '#1f6a78'], [lit[0], lit[1], 1, 1, RAIN[Math.floor(t / 2) % RAIN.length]!],
    [11, t % 2 ? 7 : 8, 1, 1, '#3b3742'], [0, 3 + (t % 3), 1, 1, '#fff1a6'], [1, 1 + ((t + 1) % 3), 1, 1, '#ffffff'], // 솔·반짝 자국
  ]);
};
const FRIEND: NonNullable<Pack['friend']> = {
  dog: pal(dog, 0), hamster: pal(hamster, 0), turtle: pal(turtle, 0), parrot: pal(parrot, 0), robovac: pal(robovac, 2),
};

export const PALS: Pack = { hat: HAT, window: WINDOW, fx: FX, title: TITLE, action: ACTION, friend: FRIEND };
