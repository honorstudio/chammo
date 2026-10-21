// 그림 팩 — 집기 팩(상시): 가구 14 · 책상 소품 9 · 조명 8. 뽑기 풀은 domain/catalog/home.ts
import type { Pack, Pz, R } from './types';

type Pt = [number, number];
const O = '#2a1c14';
const RAIN = ['#e5484d', '#ff9a3c', '#ffd27a', '#7cc48a', '#5aa0e6', '#a77be0'];

/** 다각형을 rect 로 칠한다 — brush.poly 와 같은 화소 중심 규칙(가장자리 2:1 계단) */
function poly(b: R, pts: Pt[], c: string) {
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yy = y + 0.5, xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % pts.length]!;
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + ((yy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const a = Math.round(xs[k]!), e = Math.round(xs[k + 1]!); if (e > a) b.rect(a, y, e - a, 1, c); }
  }
}
/** 한 화소 굵기 선 */
function line(b: R, p: Pt, q: Pt, c: string) {
  let [x0, y0] = [Math.round(p[0]), Math.round(p[1])];
  const [x1, y1] = [Math.round(q[0]), Math.round(q[1])];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    b.rect(x0, y0, 1, 1, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** 상자 앞면(gy 평면, 왼쪽 아래를 본다) 위 띠 — 가로 a..e 칸, 높이 z0..z1 */
function pane(b: R, P: Pz, a: number, e: number, gy: number, z0: number, z1: number, c: string) {
  const [x0, y0] = P(a, gy, z1), n = Math.round((e - a) * 12);
  for (let i = 0; i < n; i++) b.rect(x0 + i, y0 + i / 2, 1, z1 - z0, c);
}
/** 작은 Z(3×3) */
const zee = (b: R, x: number, y: number, c: string) => { b.rect(x, y, 3, 1, c); b.rect(x + 1, y + 1, 1, 1, c); b.rect(x, y + 2, 3, 1, c); };
/** 음표 하나 */
const note = (b: R, x: number, y: number, c: string) => { b.rect(x, y + 3, 2, 2, c); b.rect(x + 1, y, 1, 3, c); b.rect(x + 2, y, 1, 1, c); };

export const HOME: Pack = {
  furn: {
    beanbag: {
      icon: (b) => {
        const c = '#8a6ad1', d = '#6f52b3', h = '#a98ce6';
        b.rect(8, 4, 8, 2, c); b.rect(5, 6, 14, 3, c); b.rect(3, 9, 18, 7, c); b.rect(4, 16, 16, 2, d); b.rect(6, 18, 12, 1, d);
        b.rect(9, 8, 6, 3, d); b.rect(7, 5, 4, 1, h); b.rect(5, 9, 2, 3, h);
      },
      room: (b, P, box, sk, gx, gy) => {
        box(gx + 0.12, gy + 0.18, 0.66, 0.6, 0, 3, '#8a6ad1', '#6f52b3', '#59409a', sk.line);
        box(gx + 0.17, gy + 0.23, 0.56, 0.5, 3, 3, '#8a6ad1', '#6f52b3', '#59409a');
        box(gx + 0.24, gy + 0.28, 0.42, 0.38, 6, 2, '#9c80e0', '#7a5dc0', '#634aa6');
        box(gx + 0.32, gy + 0.34, 0.26, 0.24, 8, 1, '#a98ce6', '#7a5dc0', '#634aa6');
        const [x, y] = P(gx + 0.5, gy + 0.5, 9); b.rect(x - 2, y, 4, 1, '#6f52b3'); b.rect(x - 4, y - 1, 2, 1, '#c3a8f2');
      },
    },
    corkboard: {
      icon: (b) => {
        b.rect(2, 1, 20, 14, '#8d5d3d'); b.rect(3, 2, 18, 12, '#c99a5e');
        b.rect(4, 3, 5, 4, '#ffd84d'); b.rect(5, 5, 3, 1, '#c9a83a'); b.rect(10, 4, 5, 5, '#ffffff'); b.rect(11, 5, 3, 3, '#6ea6d9');
        b.rect(16, 3, 4, 4, '#ffc6d9'); b.rect(5, 9, 6, 4, '#9ef0a4'); b.rect(6, 11, 4, 1, '#6bbf7a'); b.rect(14, 9, 5, 4, '#ffd84d');
        for (const [x, y, c] of [[6, 3, '#e5484d'], [12, 4, '#e5484d'], [18, 3, '#5aa0e6'], [7, 9, '#5aa0e6'], [16, 9, '#e5484d']] as const) b.rect(x, y, 1, 1, c);
        b.rect(5, 15, 2, 5, '#6f4531'); b.rect(17, 15, 2, 5, '#6f4531');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.18, gy + 0.3, 0.04, 0.04, 0, 6, '#6f4531', '#6f4531', '#5a3727'); box(gx + 0.78, gy + 0.3, 0.04, 0.04, 0, 6, '#6f4531', '#6f4531', '#5a3727');
        box(gx + 0.1, gy + 0.3, 0.8, 0.06, 6, 18, '#8d5d3d', '#c99a5e', '#a97c4e', sk.line);
        const F = gy + 0.36;
        pane(b, P, gx + 0.1, gx + 0.9, F, 23, 24, '#8d5d3d'); pane(b, P, gx + 0.1, gx + 0.9, F, 6, 7, '#8d5d3d');
        pane(b, P, gx + 0.16, gx + 0.34, F, 16, 21, '#ffd84d');
        pane(b, P, gx + 0.4, gx + 0.56, F, 18 - (t % 24 < 4 ? 1 : 0), 22, '#ffc6d9');
        pane(b, P, gx + 0.62, gx + 0.82, F, 9, 15, '#ffffff'); pane(b, P, gx + 0.65, gx + 0.79, F, 10, 14, '#6ea6d9');
        pane(b, P, gx + 0.2, gx + 0.38, F, 8, 13, '#9ef0a4');
        for (const [g, z, c] of [[0.24, 21, '#e5484d'], [0.48, 22, '#5aa0e6'], [0.72, 15, '#e5484d'], [0.28, 13, '#5aa0e6']] as const) { const [x, y] = P(gx + g, F, z); b.rect(x, y, 1, 1, c); }
      },
    },
    fridge: {
      icon: (b) => {
        b.rect(6, 0, 12, 19, '#e9edf2'); b.rect(6, 0, 12, 1, '#ffffff'); b.rect(17, 0, 1, 19, '#c9cfd9'); b.rect(6, 7, 12, 1, '#b9c0cc');
        b.rect(15, 2, 1, 4, '#8a93a0'); b.rect(15, 9, 1, 6, '#8a93a0');
        b.rect(8, 2, 2, 2, '#e5484d'); b.rect(9, 9, 4, 5, '#ffffff'); b.rect(10, 9, 2, 1, '#ffd84d'); b.rect(10, 11, 2, 1, '#c9cfd9'); b.rect(8, 15, 2, 2, '#5aa0e6');
        b.rect(7, 19, 2, 1, '#3b3742'); b.rect(15, 19, 2, 1, '#3b3742');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.2, gy + 0.2, 0.5, 0.5, 0, 28, '#f4f6f9', '#dfe3ea', '#c3c9d2', sk.line);
        const F = gy + 0.7;
        pane(b, P, gx + 0.2, gx + 0.7, F, 18, 19, '#b9c0cc');
        let [x, y] = P(gx + 0.62, F, 25); b.rect(x, y, 1, 4, '#8a93a0');
        [x, y] = P(gx + 0.62, F, 16); b.rect(x, y, 1, 6, '#8a93a0');
        [x, y] = P(gx + 0.3, F, 24); b.rect(x, y, 2, 2, '#e5484d');
        [x, y] = P(gx + 0.36, F, 14); b.rect(x, y, 3, 4, '#ffffff'); b.rect(x + 1, y, 1, 1, '#ffd84d');
        if (t % 32 < 3) { [x, y] = P(gx + 0.7, gy + 0.45, 28); b.rect(x - 1, y - 3, 1, 1, '#ffffff'); } // 윙 하는 반짝
      },
    },
    monstera: {
      icon: (b) => {
        const L1 = '#4d9a57', L2 = '#5aae64', S = '#35743f';
        b.rect(11, 8, 2, 5, S); b.rect(8, 9, 3, 1, S); b.rect(13, 7, 3, 1, S);
        b.rect(1, 6, 8, 5, L1); b.rect(2, 5, 7, 1, L1); b.rect(2, 11, 6, 1, L1); b.rect(1, 8, 3, 1, S); b.rect(5, 10, 3, 1, S);
        b.rect(15, 4, 8, 6, L1); b.rect(16, 3, 6, 1, L1); b.rect(16, 10, 6, 1, L1); b.rect(20, 6, 3, 1, S); b.rect(19, 8, 4, 1, S);
        b.rect(8, 0, 7, 5, L2); b.rect(9, 5, 5, 1, L2); b.rect(11, 1, 1, 3, S);
        b.rect(6, 13, 12, 2, '#f4efe6'); b.rect(7, 15, 10, 4, '#e8e2d6'); b.rect(8, 19, 8, 1, '#c9c2b4');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.3, gy + 0.3, 0.3, 0.3, 0, 7, '#f4efe6', '#e8e2d6', '#c9c2b4', sk.line);
        const [L1, L2] = sk.leaf, [x, y] = P(gx + 0.45, gy + 0.45, 7), s = t % 16 < 8 ? 0 : 1;
        b.rect(x, y - 16, 1, 16, L2); b.rect(x - 4, y - 8, 4, 1, L2); b.rect(x + 1, y - 11, 4, 1, L2);
        b.rect(x - 11, y - 11, 8, 6, L1); b.rect(x - 10, y - 12, 6, 1, L1); b.rect(x - 11, y - 9, 3, 1, L2); b.rect(x - 7, y - 7, 3, 1, L2);
        b.rect(x + 4, y - 15, 8, 6, L1); b.rect(x + 5, y - 16, 6, 1, L1); b.rect(x + 9, y - 13, 3, 1, L2); b.rect(x + 8, y - 11, 4, 1, L2);
        b.rect(x - 8, y - 19, 7, 5, L1); b.rect(x - 8, y - 17, 3, 1, L2);
        b.rect(x - 2 + s, y - 24, 7, 6, L1); b.rect(x - 1 + s, y - 25, 5, 1, L1); b.rect(x + 1 + s, y - 23, 1, 4, L2);
      },
    },
    safe: {
      icon: (b) => {
        b.rect(4, 2, 16, 16, '#5d6470'); b.rect(4, 2, 16, 1, '#7a828f'); b.rect(19, 2, 1, 16, '#4a505a');
        b.rect(6, 4, 12, 12, '#6f7784'); b.rect(6, 4, 12, 1, '#8a93a0');
        b.rect(9, 7, 5, 5, '#c9ccd2'); b.rect(10, 8, 3, 3, '#9aa0ab'); b.rect(11, 7, 1, 2, '#3b3742');
        b.rect(15, 8, 1, 4, '#e0b94f'); b.rect(14, 9, 1, 2, '#e0b94f');
        b.rect(5, 6, 1, 2, '#3b3742'); b.rect(5, 12, 1, 2, '#3b3742');
        b.rect(5, 18, 3, 1, '#3b3742'); b.rect(16, 18, 3, 1, '#3b3742');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.2, gy + 0.2, 0.5, 0.5, 0, 14, '#7a828f', '#5d6470', '#4a505a', sk.line);
        const F = gy + 0.7;
        pane(b, P, gx + 0.25, gx + 0.65, F, 2, 12, '#6f7784');
        const [x, y] = P(gx + 0.4, F, 9); b.rect(x - 1, y - 1, 3, 3, '#c9ccd2'); b.rect(x, y - 1 + (Math.floor(t / 8) % 2), 1, 1, '#3b3742');
        const [hx, hy] = P(gx + 0.58, F, 9); b.rect(hx, hy - 1, 1, 3, '#e0b94f');
        if (t % 24 < 2) b.rect(hx, hy - 1, 1, 1, '#fff1a6');
      },
    },
    pingpong: {
      icon: (b) => {
        b.rect(1, 8, 22, 4, '#2f8f5b'); b.rect(1, 8, 22, 1, '#ffffff'); b.rect(11, 8, 2, 4, '#ffffff'); b.rect(1, 12, 22, 1, '#1d5a39');
        b.rect(10, 5, 4, 3, '#f4f4f4'); b.rect(10, 5, 4, 1, '#c8ccd4');
        b.rect(3, 13, 2, 6, '#3b3742'); b.rect(19, 13, 2, 6, '#3b3742');
        b.rect(2, 0, 3, 1, '#e5484d'); b.rect(1, 1, 5, 3, '#e5484d'); b.rect(2, 4, 3, 1, '#e5484d'); b.rect(4, 5, 2, 2, '#c99e70');
        b.rect(16, 2, 2, 2, '#ffffff'); b.rect(15, 9, 3, 1, '#256f47');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        for (const [a, c] of [[0.1, 0.2], [0.72, 0.2], [0.1, 0.62], [0.72, 0.62]] as const) box(gx + a, gy + c, 0.06, 0.06, 0, 7, '#3b3742', '#3b3742', '#2e2a30');
        box(gx + 0.05, gy + 0.15, 0.8, 0.6, 7, 2, '#2f8f5b', '#256f47', '#1d5a39', sk.line);
        const [a0, a1] = [P(gx + 0.05, gy + 0.45, 9), P(gx + 0.85, gy + 0.45, 9)]; line(b, a0, a1, '#ffffff');
        box(gx + 0.43, gy + 0.15, 0.04, 0.6, 9, 3, '#f4f4f4', '#dddddd', '#c8ccd4');
        const ph = (t % 16) / 16, u = ph < 0.5 ? ph * 2 : 2 - ph * 2, hop = Math.sin(((u * 2) % 1) * Math.PI);
        const [x, y] = P(gx + 0.12 + u * 0.66, gy + 0.45, 10 + Math.round(hop * 7));
        b.rect(x, y - 2, 2, 2, '#ffffff');
      },
    },
    espresso: {
      icon: (b) => {
        b.rect(6, 1, 3, 2, '#f4f4f4'); b.rect(10, 1, 3, 2, '#f4f4f4');
        b.rect(4, 3, 16, 15, '#c8ccd4'); b.rect(4, 3, 16, 2, '#a7adb8'); b.rect(19, 5, 1, 13, '#a7adb8');
        b.rect(14, 6, 4, 4, '#3b3742'); b.rect(15, 7, 2, 2, '#ffffff'); b.rect(16, 7, 1, 1, '#e5484d');
        b.rect(6, 10, 9, 5, '#9aa0ab'); b.rect(7, 7, 6, 2, '#3b3742'); b.rect(9, 9, 2, 1, '#3b3742'); b.rect(9, 10, 1, 2, '#5a3727');
        b.rect(8, 12, 4, 3, '#ffffff'); b.rect(12, 13, 1, 1, '#ffffff');
        b.rect(5, 15, 14, 2, '#3b3742'); b.rect(4, 17, 16, 2, '#8a93a0');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.1, gy + 0.2, 0.7, 0.55, 0, 13, sk.deskTop, sk.deskL, sk.deskR, sk.line);
        box(gx + 0.2, gy + 0.3, 0.45, 0.35, 13, 10, '#d8dce4', '#b9bec8', '#9aa0ab', sk.line);
        const F = gy + 0.65;
        pane(b, P, gx + 0.3, gx + 0.52, F, 14, 19, '#8a93a0');
        pane(b, P, gx + 0.32, gx + 0.48, F, 19, 21, '#3b3742');
        let [x, y] = P(gx + 0.38, F, 17); b.rect(x, y, 3, 3, '#ffffff');
        if (t % 4 < 2) b.rect(x + 1, y - 2, 1, 2, '#5a3727');
        [x, y] = P(gx + 0.56, F, 22); b.rect(x, y, 2, 2, '#ffffff');
        for (let k = 0; k < 3; k++) { const ph = (t + k * 3) % 9; if (ph < 6) { const [sx, sy] = P(gx + 0.35 + k * 0.08, gy + 0.45, 24 + ph * 2); b.rect(sx + (ph % 2), sy, 1, 2, 'rgba(255,255,255,.75)'); } }
      },
    },
    treadmill: {
      icon: (b) => {
        b.rect(8, 4, 15, 2, '#8d5d3d'); b.rect(8, 6, 15, 1, '#6f4531');
        b.rect(11, 0, 7, 4, '#3b3742'); b.rect(12, 1, 5, 2, '#7fd1ff');
        b.rect(17, 7, 2, 8, '#9aa0ab'); b.rect(13, 9, 4, 1, '#9aa0ab');
        b.rect(1, 15, 21, 3, '#2e2a30'); b.rect(1, 15, 21, 1, '#555555');
        for (const x of [4, 10, 16]) b.rect(x, 16, 2, 1, '#555555');
        b.rect(2, 18, 3, 2, '#3b3742'); b.rect(17, 18, 3, 2, '#3b3742');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.05, gy + 0.25, 0.8, 0.45, 0, 3, '#3b3742', '#2e2a30', '#25222a', sk.line);
        for (let k = 0; k < 4; k++) { const [x, y] = P(gx + 0.1 + ((k * 0.18 + (t % 8) * 0.0225) % 0.62), gy + 0.47, 3); b.rect(x, y, 2, 1, '#555555'); }
        box(gx + 0.74, gy + 0.3, 0.05, 0.05, 3, 16, '#9aa0ab', '#8a93a0', '#6f7784'); box(gx + 0.74, gy + 0.6, 0.05, 0.05, 3, 16, '#9aa0ab', '#8a93a0', '#6f7784');
        box(gx + 0.55, gy + 0.22, 0.3, 0.55, 19, 2, sk.deskTop, sk.deskL, sk.deskR, sk.line);
        box(gx + 0.62, gy + 0.35, 0.18, 0.28, 21, 1, '#c8ccd4', '#9aa0ab', '#8a93a0');
        box(gx + 0.78, gy + 0.35, 0.03, 0.28, 22, 5, '#3b3742', '#2e2a30', '#3b3742');
        if (t % 6 < 3) { const [x, y] = P(gx + 0.8, gy + 0.36, 27); b.rect(x, y, 1, 1, '#7cf0b0'); }
      },
    },
    turtletank: {
      icon: (b) => {
        b.rect(2, 3, 20, 13, O); b.rect(3, 4, 18, 11, '#8fd0ff'); b.rect(3, 4, 18, 2, '#bfe5ff'); b.rect(3, 12, 18, 3, '#e6d29a');
        b.rect(15, 10, 4, 3, '#9aa0ab'); b.rect(16, 9, 2, 1, '#9aa0ab');
        b.rect(8, 7, 4, 1, '#4d9a57'); b.rect(7, 8, 6, 3, '#4d9a57'); b.rect(9, 8, 2, 1, '#35743f'); b.rect(8, 9, 1, 1, '#35743f'); b.rect(11, 9, 1, 1, '#35743f');
        b.rect(13, 8, 2, 2, '#9ad08a'); b.rect(14, 8, 1, 1, O); b.rect(7, 11, 2, 1, '#9ad08a'); b.rect(11, 11, 2, 1, '#9ad08a');
        b.rect(17, 6, 1, 1, '#ffffff'); b.rect(1, 16, 22, 3, '#8d5d3d'); b.rect(1, 16, 22, 1, '#a97c4e');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.05, gy + 0.3, 0.8, 0.4, 0, 6, sk.deskTop, sk.deskL, sk.deskR, sk.line);
        box(gx + 0.05, gy + 0.3, 0.8, 0.4, 6, 12, '#bfe5ff', '#8fd0ff', '#6ab8ee', sk.line);
        pane(b, P, gx + 0.05, gx + 0.85, gy + 0.7, 6, 8, '#e6d29a');
        const [rx, ry] = P(gx + 0.68, gy + 0.7, 10); b.rect(rx, ry, 3, 2, '#9aa0ab');
        const f = (t % 48) / 48, u = f < 0.5 ? f * 2 : 2 - f * 2, flip = f >= 0.5, [x, y] = P(gx + 0.12 + u * 0.5, gy + 0.7, 11);
        b.rect(x, y, 4, 2, '#4d9a57'); b.rect(x + 1, y - 1, 2, 1, '#4d9a57'); b.rect(flip ? x - 1 : x + 4, y, 1, 1, '#9ad08a');
        if (t % 4 < 2) { b.rect(x, y + 2, 1, 1, '#9ad08a'); b.rect(x + 3, y + 2, 1, 1, '#9ad08a'); }
        if (t % 12 < 6) b.rect(x + 2, y - 4 - (t % 6), 1, 1, '#ffffff');
      },
    },
    printer3d: {
      icon: (b) => {
        b.rect(3, 0, 18, 2, '#4a4652'); b.rect(3, 2, 2, 13, '#3b3742'); b.rect(19, 2, 2, 13, '#3b3742'); b.rect(5, 2, 14, 13, '#dfe6ee');
        b.rect(5, 4, 14, 1, '#9aa0ab'); b.rect(10, 4, 4, 3, '#e0b94f'); b.rect(11, 7, 2, 1, '#c99a2e');
        b.rect(10, 9, 4, 1, '#ff9a3c'); b.rect(9, 10, 6, 1, '#ff9a3c'); b.rect(8, 11, 8, 2, '#ff9a3c'); b.rect(8, 12, 8, 1, '#e07b25');
        b.rect(6, 13, 12, 2, '#9aa0ab'); b.rect(3, 15, 18, 4, '#2e2a30'); b.rect(5, 16, 4, 2, '#7fd1ff'); b.rect(15, 16, 2, 2, '#7cf0b0');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        const post = (a: number, c: number) => box(gx + a, gy + c, 0.06, 0.06, 4, 18, '#3b3742', '#3b3742', '#2e2a30');
        box(gx + 0.15, gy + 0.2, 0.6, 0.55, 0, 4, '#3b3742', '#2e2a30', '#25222a', sk.line);
        post(0.15, 0.2); post(0.69, 0.2);
        box(gx + 0.25, gy + 0.3, 0.4, 0.35, 4, 1, '#9aa0ab', '#8a93a0', '#6f7784');
        const n = Math.min(10, Math.floor((t % 72) / 6));
        if (n > 0) box(gx + 0.38, gy + 0.4, 0.15, 0.15, 5, n, '#ff9a3c', '#e07b25', '#c4661a');
        const u = [0, 1, 2, 3, 3, 2, 1, 0][t % 8]! * 0.05;
        box(gx + 0.15, gy + 0.42, 0.6, 0.05, 8 + n, 1, '#9aa0ab', '#8a93a0', '#6f7784');
        box(gx + 0.3 + u, gy + 0.38, 0.14, 0.14, 6 + n, 3, '#e0b94f', '#c99a2e', '#b3871f');
        post(0.15, 0.69); post(0.69, 0.69);
        box(gx + 0.15, gy + 0.2, 0.6, 0.55, 22, 2, '#4a4652', '#3b3742', '#2e2a30', sk.line);
        const [x, y] = P(gx + 0.3, gy + 0.75, 3); b.rect(x, y, 3, 1, '#7fd1ff');
      },
    },
    piano: {
      icon: (b) => {
        b.rect(2, 2, 20, 16, '#2a2230'); b.rect(1, 1, 22, 2, '#3b3242'); b.rect(3, 3, 1, 6, '#4a3f58');
        b.rect(8, 4, 8, 5, '#ffffff'); b.rect(9, 5, 6, 1, '#9aa0ab'); b.rect(9, 7, 6, 1, '#9aa0ab');
        b.rect(1, 10, 22, 3, '#f4f4f4'); for (const k of [3, 5, 9, 11, 13, 17, 19]) b.rect(k, 10, 1, 2, '#1a1520');
        for (let k = 2; k < 23; k += 2) b.rect(k, 12, 1, 1, '#d8d8d8');
        b.rect(1, 13, 22, 1, '#3b3242'); b.rect(2, 15, 20, 1, '#4a3f58');
        b.rect(10, 17, 1, 1, '#e0b94f'); b.rect(13, 17, 1, 1, '#e0b94f'); b.rect(3, 18, 2, 2, '#2a2230'); b.rect(19, 18, 2, 2, '#2a2230');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.1, gy + 0.15, 0.7, 0.35, 0, 22, '#3b3242', '#2a2230', '#1e1824', sk.line);
        box(gx + 0.1, gy + 0.5, 0.7, 0.18, 9, 2, '#f4f4f4', '#dddddd', '#c8ccd4', sk.line);
        for (let k = 0; k < 7; k++) { const [x, y] = P(gx + 0.15 + k * 0.09, gy + 0.55, 11); b.rect(x, y, 1, 1, '#1a1520'); }
        pane(b, P, gx + 0.3, gx + 0.6, gy + 0.5, 15, 19, '#ffffff');
        for (let k = 0; k < 2; k++) {
          const ph = ((t + k * 12) % 24) / 24; if (ph > 0.8) continue;
          const [x, y] = P(gx + 0.35 + k * 0.25, gy + 0.4, 24 + Math.round(ph * 14)); note(b, x + Math.round(Math.sin(ph * 6) * 2), y - 5, k ? '#ffd27a' : '#bfe5ff');
        }
      },
    },
    crttv: {
      icon: (b) => {
        b.rect(8, 0, 1, 1, '#3b3742'); b.rect(9, 1, 1, 1, '#3b3742'); b.rect(15, 0, 1, 1, '#3b3742'); b.rect(14, 1, 1, 1, '#3b3742'); b.rect(10, 2, 4, 1, '#3b3742');
        b.rect(2, 3, 20, 13, '#a8744a'); b.rect(2, 3, 20, 1, '#c4905f');
        b.rect(4, 5, 12, 9, '#3b3742'); ['#ffffff', '#ffd27a', '#7fd1ff', '#7cc48a', '#ff6bd6'].forEach((c, i) => b.rect(5 + i * 2, 6, 2, 5, c)); b.rect(5, 11, 10, 2, '#1c2838');
        b.rect(17, 6, 3, 3, '#3b3742'); b.rect(18, 7, 1, 1, '#e0b94f'); b.rect(17, 10, 3, 3, '#3b3742'); b.rect(18, 11, 1, 1, '#e0b94f');
        b.rect(4, 16, 16, 1, '#6f4531'); b.rect(5, 17, 2, 3, '#6f4531'); b.rect(17, 17, 2, 3, '#6f4531');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.08, gy + 0.2, 0.74, 0.55, 0, 6, sk.deskTop, sk.deskL, sk.deskR, sk.line);
        box(gx + 0.12, gy + 0.25, 0.66, 0.45, 6, 15, '#c4905f', '#a8744a', '#8d5d3d', sk.line);
        const F = gy + 0.7, chan = Math.floor(t / 24) % 3;
        const [x0, y0] = P(gx + 0.16, F, 19), n = Math.round(0.42 * 12);
        for (let i = 0; i < n; i++) {
          const c = chan === 0 ? ['#ffffff', '#ffd27a', '#7fd1ff', '#7cc48a', '#ff6bd6'][Math.floor((i * 5) / n)]!
            : chan === 1 ? ((i + t) % 3 ? '#9aa0ab' : '#dfe6ee') : '#1c2838';
          b.rect(x0 + i, y0 + i / 2, 1, 9, c);
        }
        if (chan === 2) { const [x, y] = P(gx + 0.34, F, 15); b.rect(x, y + (t % 4 < 2 ? 0 : -1), 2, 2, '#ffd27a'); b.rect(x - 2, y + 3, 6, 1, '#7cc48a'); }
        let [x, y] = P(gx + 0.68, F, 17); b.rect(x, y, 1, 1, '#e0b94f'); [x, y] = P(gx + 0.68, F, 12); b.rect(x, y, 1, 1, '#e0b94f');
        const [ax, ay] = P(gx + 0.45, gy + 0.48, 21); line(b, [ax, ay], [ax - 4, ay - 7], '#3b3742'); line(b, [ax, ay], [ax + 4, ay - 8], '#3b3742');
      },
    },
    serverrack: {
      icon: (b) => {
        b.rect(5, 0, 14, 20, '#2b2f3a'); b.rect(5, 0, 14, 1, '#4a5162');
        const LED = ['#7cf0b0', '#39f3ff', '#ffc93c', '#7cf0b0', '#ff6b6b'];
        for (let r = 0; r < 5; r++) { b.rect(7, 2 + r * 3, 10, 2, '#3d4352'); b.rect(8, 2 + r * 3, 1, 1, LED[r]!); b.rect(10, 2 + r * 3, 1, 1, '#7cf0b0'); b.rect(12, 3 + r * 3, 4, 1, '#252934'); }
        b.rect(7, 17, 10, 2, '#1f222b'); b.rect(19, 1, 1, 18, '#1f222b');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.12, gy + 0.2, 0.66, 0.45, 0, 28, '#3d4352', '#2b2f3a', '#1f222b', sk.line);
        const F = gy + 0.65, LED = ['#7cf0b0', '#39f3ff', '#ffc93c'];
        for (let r = 0; r < 6; r++) {
          pane(b, P, gx + 0.16, gx + 0.74, F, 23 - r * 4, 26 - r * 4, '#3d4352');
          for (let q = 0; q < 4; q++) {
            const [x, y] = P(gx + 0.2 + q * 0.13, F, 25 - r * 4), on = (r + q + Math.floor(t / 2)) % 6 < 2 || (r * 5 + q * 3 + Math.floor(t / 5)) % 7 === 0;
            b.rect(x, y, 2, 1, on ? LED[(r + q) % 3]! : '#252934');
          }
        }
        const [bx, by] = P(gx + 0.45, gy + 0.42, 28); b.rect(bx - 1, by - 2, 2, 2, t % 8 < 4 ? '#7cf0b0' : '#2f6a4a');
      },
    },
    nappod: {
      icon: (b) => {
        const W = '#eef1f6';
        b.rect(4, 4, 16, 1, W); b.rect(2, 5, 20, 1, W); b.rect(1, 6, 22, 10, W); b.rect(1, 14, 22, 2, '#d5dae3'); b.rect(2, 16, 20, 1, '#b9c0cc');
        b.rect(6, 7, 11, 1, '#1b2140'); b.rect(5, 8, 13, 6, '#1b2140'); b.rect(5, 13, 13, 1, '#7fd1ff');
        b.rect(6, 10, 3, 2, '#ffffff'); b.rect(9, 10, 8, 3, '#a77be0'); b.rect(9, 10, 8, 1, '#c3a2f0');
        b.rect(2, 7, 1, 7, '#ff6bd6'); b.rect(21, 7, 1, 7, '#39f3ff');
        b.rect(4, 17, 3, 2, '#3b3742'); b.rect(17, 17, 3, 2, '#3b3742');
        zee(b, 19, 0, '#5aa0e6'); b.rect(16, 2, 2, 1, '#5aa0e6');
      },
      room: (b, P, box, sk, gx, gy, t) => {
        box(gx + 0.05, gy + 0.12, 0.8, 0.7, 0, 3, '#3b3742', '#2e2a30', '#25222a', sk.line);
        box(gx + 0.05, gy + 0.12, 0.8, 0.7, 3, 12, '#eef1f6', '#d5dae3', '#b9c0cc', sk.line);
        box(gx + 0.15, gy + 0.22, 0.6, 0.5, 15, 3, '#f7f9fc', '#e3e7ee', '#c9cfd9');
        const F = gy + 0.82, G = ['#ff6bd6', '#a77be0', '#5aa0e6', '#39f3ff', '#7cf0b0'];
        pane(b, P, gx + 0.15, gx + 0.7, F, 5, 13, '#1b2140');
        const [x0, y0] = P(gx + 0.05, F, 14);
        for (let i = 0; i < 10; i++) b.rect(x0 + i, y0 + i / 2, 1, 1, G[(Math.floor(i / 2) + Math.floor(t / 2)) % G.length]!);
        pane(b, P, gx + 0.15, gx + 0.7, F, 5, 6, G[Math.floor(t / 4) % G.length]!);
        let [x, y] = P(gx + 0.22, F, 9); b.rect(x, y, 3, 2, '#ffffff');
        [x, y] = P(gx + 0.38, F, 9); b.rect(x, y, 6, 3, '#a77be0');
        for (let k = 0; k < 3; k++) {
          const ph = ((t + k * 8) % 24) / 24, [zx, zy] = P(gx + 0.5, gy + 0.4, 22 + Math.round(ph * 16));
          if (ph < 0.85) zee(b, zx + Math.round(Math.sin(ph * 5) * 2), zy, ph < 0.6 ? '#bfe5ff' : 'rgba(191,229,255,.5)');
        }
      },
    },
  },

  desk: {
    mug: {
      icon: (b) => {
        b.rect(6, 8, 10, 11, '#f4f4f4'); b.rect(6, 8, 10, 1, '#5a3727'); b.rect(6, 12, 10, 3, '#5aa0e6'); b.rect(7, 19, 8, 1, '#d8d8d8'); b.rect(15, 9, 1, 10, '#dddddd');
        b.rect(16, 10, 4, 1, '#dddddd'); b.rect(19, 11, 1, 5, '#dddddd'); b.rect(16, 16, 4, 1, '#dddddd');
        b.rect(9, 3, 1, 3, '#dbe6f2'); b.rect(10, 1, 1, 3, '#dbe6f2'); b.rect(12, 4, 1, 2, '#dbe6f2'); b.rect(13, 1, 1, 3, '#dbe6f2');
      },
      prop: (b, x, y, t) => {
        b.rect(x - 3, y - 6, 5, 6, '#f4f4f4'); b.rect(x - 3, y - 7, 5, 1, '#5a3727'); b.rect(x - 3, y - 4, 5, 1, '#5aa0e6'); b.rect(x + 2, y - 5, 2, 4, '#dddddd');
        const s = t % 6 < 3; b.rect(x - 2 + (s ? 0 : 1), y - 10, 1, 2, '#dbe6f2'); b.rect(x + (s ? 0 : -1), y - 12, 1, 2, '#dbe6f2');
      },
    },
    postit: {
      icon: (b) => {
        const C = ['#ffd84d', '#ffc6d9', '#9ef0a4', '#8fd0ff', '#ff9a3c', '#ffd84d'];
        for (let k = 0; k < 6; k++) { const x = 6 + (k % 2), y = 16 - k * 3; b.rect(x, y, 12, 3, C[k]!); b.rect(x, y + 2, 12, 1, 'rgba(0,0,0,.12)'); }
        b.rect(9, 2, 6, 1, '#c9a83a'); b.rect(9, 3, 4, 1, '#c9a83a'); b.rect(17, 0, 2, 2, '#ffe680');
      },
      prop: (b, x, y, t, typing) => {
        const C = ['#ffd84d', '#ffc6d9', '#9ef0a4', '#8fd0ff', '#ff9a3c'];
        for (let k = 0; k < 5; k++) b.rect(x - 3 + (k % 2), y - 2 - k * 2, 6, 2, C[k]!);
        if (typing && t % 8 < 4) b.rect(x + 3, y - 11, 1, 1, '#ffd84d');
        else b.rect(x - 2, y - 11, 4, 1, '#ffd84d');
      },
    },
    fidget: {
      icon: (b) => {
        b.rect(7, 3, 14, 2, '#9cc6ef'); b.rect(5, 5, 14, 14, '#6ea6d9'); b.rect(19, 5, 2, 12, '#4d86b8');
        for (const [x, y] of [[7, 7], [10, 7], [7, 10], [10, 10]] as const) b.rect(x, y, 2, 2, '#f4f4f4');
        b.rect(13, 7, 4, 2, '#3b3742'); b.rect(13, 7, 2, 2, '#ffd27a'); b.rect(13, 12, 3, 3, '#3b3742'); b.rect(14, 13, 1, 1, '#e5484d');
        b.rect(7, 14, 4, 3, '#4d86b8'); b.rect(8, 15, 2, 1, '#f4f4f4');
      },
      prop: (b, x, y, t, typing) => {
        b.rect(x - 2, y - 7, 6, 1, '#9cc6ef'); b.rect(x - 3, y - 6, 6, 6, '#6ea6d9'); b.rect(x + 3, y - 6, 1, 5, '#4d86b8');
        const k = Math.floor(t / (typing ? 2 : 6)) % 4;
        b.rect(x - 2, y - 5, 1, 1, k === 0 ? '#e5484d' : '#f4f4f4'); b.rect(x, y - 5, 1, 1, k === 1 ? '#e5484d' : '#f4f4f4');
        b.rect(x - 2, y - 3, 2, 1, '#3b3742'); b.rect(x - 2 + (k > 1 ? 1 : 0), y - 3, 1, 1, '#ffd27a'); b.rect(x + 1, y - 3, 1, 2, '#3b3742');
      },
    },
    energycan: {
      icon: (b) => {
        b.rect(10, 0, 3, 1, '#9aa0ab'); b.rect(8, 1, 8, 2, '#c8ccd4'); b.rect(7, 3, 10, 15, '#2b2f3a'); b.rect(8, 18, 8, 1, '#9aa0ab');
        b.rect(7, 5, 10, 1, '#7cf0b0'); b.rect(7, 15, 10, 1, '#7cf0b0'); b.rect(8, 4, 1, 13, '#4a5162');
        b.rect(12, 7, 3, 1, '#ffd84d'); b.rect(11, 8, 3, 1, '#ffd84d'); b.rect(10, 9, 5, 1, '#ffd84d'); b.rect(11, 10, 3, 1, '#ffd84d'); b.rect(10, 11, 3, 1, '#ffd84d'); b.rect(10, 12, 2, 1, '#ffd84d');
      },
      prop: (b, x, y, t, typing) => {
        b.rect(x - 2, y - 9, 4, 1, '#c8ccd4'); b.rect(x - 2, y - 8, 4, 8, '#2b2f3a'); b.rect(x - 2, y - 7, 4, 1, '#7cf0b0');
        b.rect(x, y - 5, 1, 1, '#ffd84d'); b.rect(x - 1, y - 4, 2, 1, '#ffd84d'); b.rect(x - 1, y - 3, 1, 1, '#ffd84d');
        if (typing || t % 16 < 8) b.rect(x - 1 + (t % 2), y - 11 - (t % 2), 1, 1, '#dfe6ee');
      },
    },
    minifan: {
      icon: (b) => {
        b.rect(8, 1, 8, 1, '#9aa0ab'); b.rect(6, 2, 12, 1, '#9aa0ab'); b.rect(5, 3, 14, 9, '#9aa0ab'); b.rect(6, 12, 12, 1, '#9aa0ab'); b.rect(8, 13, 8, 1, '#9aa0ab');
        b.rect(8, 2, 8, 1, '#dbe6f2'); b.rect(6, 3, 12, 9, '#dbe6f2'); b.rect(8, 12, 8, 1, '#dbe6f2');
        b.rect(11, 3, 2, 4, '#5aa0e6'); b.rect(13, 6, 4, 2, '#5aa0e6'); b.rect(11, 8, 2, 4, '#5aa0e6'); b.rect(7, 6, 4, 2, '#5aa0e6'); b.rect(11, 6, 2, 2, '#3b3742');
        b.rect(11, 14, 2, 3, '#9aa0ab'); b.rect(8, 17, 8, 2, '#3b3742');
      },
      prop: (b, x, y, t) => {
        b.rect(x - 2, y - 1, 5, 1, '#3b3742'); b.rect(x, y - 5, 1, 4, '#9aa0ab');
        b.rect(x - 2, y - 12, 5, 1, '#9aa0ab'); b.rect(x - 3, y - 11, 7, 5, '#dbe6f2'); b.rect(x - 2, y - 6, 5, 1, '#9aa0ab');
        if (t % 2) { b.rect(x, y - 11, 1, 5, '#5aa0e6'); b.rect(x - 3, y - 9, 7, 1, '#5aa0e6'); }
        else { for (const d of [-2, -1, 1, 2]) { b.rect(x + d, y - 9 + d, 1, 1, '#5aa0e6'); b.rect(x + d, y - 9 - d, 1, 1, '#5aa0e6'); } }
        b.rect(x, y - 9, 1, 1, '#3b3742');
        if (t % 4 < 2) b.rect(x - 7, y - 10, 2, 1, 'rgba(219,230,242,.8)'); else b.rect(x - 6, y - 8, 2, 1, 'rgba(219,230,242,.8)');
      },
    },
    hourglass: {
      icon: (b) => {
        const W = '#8d5d3d', G = '#e6f3ff', S = '#e0b94f';
        b.rect(5, 1, 14, 2, W); b.rect(5, 17, 14, 2, W); b.rect(6, 3, 1, 14, W); b.rect(17, 3, 1, 14, W);
        for (const [y, x, w] of [[3, 8, 8], [4, 8, 8], [5, 9, 6], [6, 9, 6], [7, 10, 4], [8, 11, 2], [9, 11, 2], [10, 10, 4], [11, 9, 6], [12, 9, 6], [13, 8, 8], [14, 8, 8], [15, 8, 8], [16, 8, 8]] as const) b.rect(x, y, w, 1, G);
        b.rect(9, 6, 6, 1, S); b.rect(10, 7, 4, 1, S); b.rect(11, 8, 2, 1, S); b.rect(11, 9, 1, 4, S); b.rect(10, 13, 4, 1, S); b.rect(8, 14, 8, 3, S);
      },
      prop: (b, x, y, t) => {
        const W = '#8d5d3d', G = '#e6f3ff', S = '#e0b94f', f = Math.floor((t % 32) / 8);
        b.rect(x - 3, y - 11, 7, 1, W); b.rect(x - 3, y - 1, 7, 1, W);
        b.rect(x - 2, y - 10, 5, 2, G); b.rect(x - 1, y - 8, 3, 1, G); b.rect(x, y - 7, 1, 2, G); b.rect(x - 1, y - 5, 3, 1, G); b.rect(x - 2, y - 4, 5, 3, G);
        if (f < 3) b.rect(x - 2 + f, y - 9 + Math.min(f, 1), 5 - f * 2, 1, S);
        if (f < 3 && t % 2) b.rect(x, y - 6, 1, 1, S);
        b.rect(x - 2, y - 2, 5, 1, S); if (f > 0) b.rect(x - 1, y - 3, 3, 1, S); if (f > 2) b.rect(x, y - 4, 1, 1, S);
      },
    },
    bonsai: {
      icon: (b) => {
        b.rect(11, 8, 3, 5, '#6b4a2e'); b.rect(7, 7, 4, 2, '#6b4a2e'); b.rect(14, 5, 3, 2, '#6b4a2e');
        b.rect(2, 4, 8, 3, '#4d9a57'); b.rect(3, 3, 6, 1, '#7cc48a'); b.rect(13, 1, 9, 4, '#4d9a57'); b.rect(14, 0, 7, 1, '#7cc48a');
        b.rect(3, 14, 18, 1, '#5a80b8'); b.rect(4, 15, 16, 3, '#4a6fa5'); b.rect(5, 18, 14, 1, '#3a5584'); b.rect(5, 13, 14, 1, '#7cc48a');
      },
      prop: (b, x, y, t) => {
        b.rect(x - 4, y - 2, 8, 2, '#4a6fa5'); b.rect(x - 3, y - 3, 6, 1, '#7cc48a');
        b.rect(x - 1, y - 5, 2, 2, '#6b4a2e'); b.rect(x - 3, y - 6, 3, 1, '#6b4a2e'); b.rect(x + 1, y - 7, 1, 2, '#6b4a2e');
        b.rect(x - 5, y - 8, 4, 2, '#4d9a57'); b.rect(x - 4, y - 9, 2, 1, '#7cc48a'); b.rect(x + 1, y - 10, 5, 3, '#4d9a57'); b.rect(x + 2, y - 11, 3, 1, '#7cc48a');
        const ph = t % 32; if (ph < 10) b.rect(x + 4 + (ph % 3 === 0 ? 1 : 0), y - 7 + Math.floor(ph / 2), 1, 1, '#7cc48a');
      },
    },
    keycap: {
      icon: (b) => {
        b.rect(6, 4, 12, 5, '#7d5fd0'); b.rect(5, 9, 14, 1, '#6a4dbd'); b.rect(4, 10, 16, 8, '#5b3fa8'); b.rect(5, 18, 14, 1, '#2c254c');
        b.rect(7, 5, 4, 1, '#a98ce6'); b.rect(12, 6, 3, 2, '#ff9ac1'); b.rect(13, 6, 1, 1, '#ffd0e2');
        for (const [x, y] of [[8, 7], [16, 5], [10, 8], [15, 8]] as const) b.rect(x, y, 1, 1, '#fff1a6');
        b.rect(5, 11, 1, 5, '#7d5fd0'); b.rect(9, 13, 6, 2, '#46308a');
      },
      prop: (b, x, y, t, typing) => {
        const d = typing && t % 2 ? 1 : 0;
        if (typing) b.rect(x - 4, y - 1, 9, 1, `rgba(${['255,107,214', '57,243,255', '255,210,122', '124,240,176'][t % 4]},.6)`);
        b.rect(x - 3, y - 4 + d, 7, 3, '#5b3fa8'); b.rect(x - 2, y - 6 + d, 5, 2, '#7d5fd0');
        b.rect(x, y - 6 + d, 1, 1, '#ff9ac1'); b.rect(x - 1 + (Math.floor(t / 4) % 3), y - 5 + d, 1, 1, '#fff1a6');
      },
    },
    pocketpet: {
      icon: (b) => {
        const C = '#7cd8c4';
        b.rect(10, 0, 4, 1, '#c8ccd4'); b.rect(7, 1, 10, 1, C); b.rect(5, 2, 14, 1, C); b.rect(4, 3, 16, 15, C); b.rect(5, 18, 14, 1, '#5cb8a4'); b.rect(7, 19, 10, 1, '#5cb8a4'); b.rect(5, 3, 1, 6, '#a9eadb');
        b.rect(8, 4, 8, 8, '#3b4a3a'); b.rect(7, 5, 10, 6, '#3b4a3a'); b.rect(8, 5, 8, 6, '#c9e6b8');
        b.rect(10, 7, 4, 3, '#2e3b2a'); b.rect(10, 6, 1, 1, '#2e3b2a'); b.rect(13, 6, 1, 1, '#2e3b2a'); b.rect(11, 8, 1, 1, '#c9e6b8'); b.rect(13, 8, 1, 1, '#c9e6b8');
        b.rect(15, 5, 1, 1, '#ff6b9a'); b.rect(7, 14, 2, 2, '#ff6b9a'); b.rect(11, 15, 2, 2, '#ffd27a'); b.rect(15, 14, 2, 2, '#5aa0e6');
      },
      prop: (b, x, y, t, typing) => {
        b.rect(x - 3, y - 9, 7, 9, '#7cd8c4'); b.rect(x - 2, y - 8, 5, 4, '#c9e6b8');
        const sp = typing ? 2 : 4, hop = Math.floor(t / sp) % 2, cx = x - 2 + (Math.floor(t / (sp * 2)) % 2) * 2;
        b.rect(cx, y - 6 - hop, 2, 2, '#2e3b2a');
        b.rect(x - 2, y - 3, 1, 1, '#ff6b9a'); b.rect(x, y - 2, 1, 1, '#ffd27a'); b.rect(x + 2, y - 3, 1, 1, '#5aa0e6');
        if (t % 24 < 8) { b.rect(x + 1, y - 12, 1, 1, '#ff6b9a'); b.rect(x + 3, y - 12, 1, 1, '#ff6b9a'); b.rect(x + 1, y - 11, 3, 1, '#ff6b9a'); b.rect(x + 2, y - 10, 1, 1, '#ff6b9a'); }
        if (typing && t % 6 < 3) b.rect(x - 4, y - 11, 1, 1, '#fff1a6');
      },
    },
  },

  light: {
    dusk: {
      icon: (b) => {
        b.rect(1, 1, 22, 4, '#ff7a8a'); b.rect(1, 5, 22, 4, '#ff9a6b'); b.rect(1, 9, 22, 5, '#ffc27a');
        b.rect(9, 10, 6, 1, '#fff1a6'); b.rect(8, 11, 8, 1, '#fff1a6'); b.rect(7, 12, 10, 2, '#fff1a6');
        b.rect(1, 14, 22, 5, '#6a3a5a'); b.rect(3, 15, 6, 1, '#ff9a6b'); b.rect(14, 17, 7, 1, '#ff9a6b');
      },
      scene: (b, W, H, t) => {
        const n = 8, h = Math.ceil(H / n);
        for (let k = 0; k < n; k++) b.rect(0, k * h, W, h, `rgba(255,${110 + k * 14},${90 + k * 6},${(0.13 - k * 0.012).toFixed(3)})`);
        if (t % 48 < 24) b.rect(0, 0, W, Math.ceil(H / 3), 'rgba(255,120,140,.03)');
      },
    },
    moonbeam: {
      icon: (b) => {
        b.rect(1, 1, 22, 18, '#16204a'); b.rect(3, 2, 9, 8, '#8a6a4a'); b.rect(4, 3, 7, 6, '#2a3a7a'); b.rect(7, 3, 1, 6, '#8a6a4a'); b.rect(4, 5, 7, 1, '#8a6a4a');
        b.rect(8, 6, 2, 2, '#fff6c2');
        for (let y = 10; y < 19; y++) b.rect(4 + (y - 10), y, 7, 1, '#3e4c8c');
        b.rect(13, 17, 8, 2, '#4a5a9a');
      },
      scene: (b, W, H, t, P) => {
        b.rect(0, 0, W, H, 'rgba(30,50,130,.14)');
        const a = 0.15 + Math.sin(t / 12) * 0.03;
        for (const [g0, g1] of [[1.0, 2.05], [2.15, 3.05], [3.15, 4.2]] as const) poly(b, [P(g0, 0.1), P(g1, 0.1), P(g1 + 0.6, 2.8), P(g0 + 0.6, 2.8)], `rgba(200,220,255,${a.toFixed(3)})`);
      },
    },
    flicker: {
      icon: (b) => {
        b.rect(6, 0, 1, 3, '#555555'); b.rect(17, 0, 1, 3, '#555555'); b.rect(2, 3, 20, 2, '#9aa0ab');
        b.rect(3, 5, 18, 2, '#f4f8ff'); b.rect(2, 5, 1, 2, '#6f7784'); b.rect(21, 5, 1, 2, '#6f7784');
        b.rect(3, 7, 18, 2, 'rgba(220,240,255,.6)'); b.rect(5, 9, 14, 3, 'rgba(220,240,255,.35)');
        b.rect(1, 12, 2, 1, '#bfe5ff'); b.rect(2, 13, 1, 1, '#bfe5ff'); b.rect(1, 14, 2, 1, '#bfe5ff'); b.rect(21, 12, 2, 1, '#bfe5ff'); b.rect(21, 13, 1, 1, '#bfe5ff'); b.rect(21, 14, 2, 1, '#bfe5ff');
      },
      scene: (b, W, H, t, P, cols, rows) => {
        const off = [5, 7, 8, 31].includes(t % 40);
        b.rect(0, 0, W, H, off ? 'rgba(10,20,40,.10)' : 'rgba(220,240,255,.06)');
        for (const [g, k] of [[cols * 0.18, 0], [cols * 0.55, 1]] as const) {
          const gy = rows * 0.45, z = 58, lit = !(off && k === 1);
          const [cx, cy] = P(g + 0.8, gy, z + 2); b.rect(cx, cy - 6, 1, 6, '#555555');
          poly(b, [P(g, gy, z + 2), P(g + 1.6, gy, z + 2), P(g + 1.6, gy, z), P(g, gy, z)], '#9aa0ab');
          poly(b, [P(g + 0.05, gy, z), P(g + 1.55, gy, z), P(g + 1.55, gy, z - 2), P(g + 0.05, gy, z - 2)], lit ? '#f4f8ff' : '#8a93a0');
          if (lit) poly(b, [P(g, gy, z - 2), P(g + 1.6, gy, z - 2), P(g + 1.8, gy, z - 12), P(g - 0.2, gy, z - 12)], 'rgba(220,240,255,.10)');
        }
      },
    },
    candles: {
      icon: (b) => {
        b.rect(4, 3, 6, 7, 'rgba(255,200,100,.3)'); b.rect(9, 0, 6, 7, 'rgba(255,200,100,.3)'); b.rect(14, 4, 6, 7, 'rgba(255,200,100,.3)');
        b.rect(5, 10, 4, 8, '#f4ead8'); b.rect(10, 7, 4, 11, '#f4ead8'); b.rect(15, 11, 4, 7, '#f4ead8');
        b.rect(5, 10, 1, 3, '#e6d9bf'); b.rect(12, 7, 1, 2, '#e6d9bf'); b.rect(18, 11, 1, 2, '#e6d9bf');
        b.rect(7, 9, 1, 1, '#3b3742'); b.rect(12, 6, 1, 1, '#3b3742'); b.rect(17, 10, 1, 1, '#3b3742');
        b.rect(6, 6, 2, 3, '#ff9a3c'); b.rect(7, 7, 1, 2, '#fff1a6'); b.rect(11, 3, 2, 3, '#ff9a3c'); b.rect(12, 4, 1, 2, '#fff1a6'); b.rect(16, 7, 2, 3, '#ff9a3c'); b.rect(17, 8, 1, 2, '#fff1a6');
        b.rect(3, 18, 18, 2, '#c99a2e');
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(255,150,60,.07)');
        const spots: [number, number, number, number][] = [[1.3, 0.06, 11, 6], [2.0, 0.06, 11, 4], [2.9, 0.06, 11, 5], [3.7, 0.06, 11, 3], [0.35, rows - 0.4, 0, 7], [0.6, rows - 0.25, 0, 5], [0.25, rows - 0.15, 0, 4]];
        spots.forEach(([g, h, z, tall], k) => {
          const [x, y] = P(g, h, z), fl = (t + k * 3) % 5 === 0 ? 1 : 0;
          b.rect(x - 4, y - tall - 9, 9, 9, 'rgba(255,200,100,.10)');
          b.rect(x - 1, y - tall, 3, tall, '#f4ead8'); b.rect(x - 1, y - tall, 1, 2, '#e6d9bf'); b.rect(x, y - tall - 1, 1, 1, '#3b3742');
          b.rect(x, y - tall - 4 + fl, 1, 3 - fl, '#ff9a3c'); b.rect(x, y - tall - 2, 1, 1, '#fff1a6');
        });
      },
    },
    fireflies: {
      icon: (b) => {
        b.rect(1, 1, 22, 18, '#10241c');
        for (const [x, h] of [[2, 4], [4, 6], [7, 3], [10, 5], [13, 4], [16, 6], [19, 3], [21, 5]] as const) b.rect(x, 19 - h, 1, h, '#2f5a3a');
        for (const [x, y] of [[5, 4], [12, 7], [18, 3], [8, 11], [16, 10]] as const) { b.rect(x - 1, y - 1, 3, 3, '#3a5a2a'); b.rect(x, y, 1, 1, '#eaff7a'); }
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(10,40,30,.10)');
        for (let k = 0; k < 18; k++) {
          const gx = (((k * 1.37 + Math.sin(t / 9 + k) * 0.6) % cols) + cols) % cols, gy = (((k * 2.11 + Math.cos(t / 11 + k * 1.3) * 0.5) % rows) + rows) % rows;
          const [x, y] = P(gx, gy, 16 + (k % 3) * 9 + Math.sin(t / 5 + k) * 4);
          if ((t + k * 5) % 20 < 13) { b.rect(x - 1, y - 1, 3, 3, 'rgba(220,255,120,.22)'); b.rect(x, y, 1, 1, '#eaff7a'); }
          else b.rect(x, y, 1, 1, 'rgba(160,190,80,.5)');
        }
      },
    },
    starceil: {
      icon: (b) => {
        b.rect(1, 1, 22, 18, '#141a44');
        for (const [x, y] of [[5, 4], [17, 3], [12, 9], [20, 13]] as const) { b.rect(x, y - 1, 1, 3, '#fff6c2'); b.rect(x - 1, y, 3, 1, '#fff6c2'); }
        for (const [x, y] of [[9, 3], [3, 9], [15, 14], [7, 15], [18, 8], [11, 17]] as const) b.rect(x, y, 1, 1, '#ffffff');
        b.rect(3, 13, 4, 1, '#c8d4ff'); b.rect(7, 12, 1, 1, '#c8d4ff');
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(20,30,90,.12)');
        for (let k = 0; k < 34; k++) {
          const onBack = k % 3 !== 0, g = ((k * 0.618) % 1) * (onBack ? cols : rows), z = 29 + ((k * 7) % 14);
          const [x, y] = onBack ? P(g, 0, z) : P(0, g, z);
          if ((t + k * 7) % 24 >= 18) continue;
          if (k % 5 === 0) { b.rect(x, y - 1, 1, 3, '#fff6c2'); b.rect(x - 1, y, 3, 1, '#fff6c2'); } else b.rect(x, y, 1, 1, '#ffffff');
        }
        const ph = (t % 56) / 56;
        if (ph < 0.25) for (let k = 0; k < 5; k++) { const [x, y] = P(cols * (0.2 + ph * 2.4) - k * 0.15, 0, 43 - ph * 30 + k * 1.5); b.rect(x, y, 1, 1, k ? 'rgba(200,215,255,.6)' : '#ffffff'); }
      },
    },
    laser: {
      icon: (b) => {
        b.rect(1, 1, 22, 18, '#120a24');
        for (const [ex, c] of [[2, '#ff4f8a'], [8, '#7cf0b0'], [16, '#39f3ff'], [22, '#ffd27a']] as const) line(b, [12, 4], [ex, 18], c);
        b.rect(10, 1, 4, 3, '#3b3742'); b.rect(11, 3, 2, 1, '#ff4f8a');
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(10,0,30,.10)');
        const src = P(cols * 0.75, 0.05, 40), C = ['rgba(255,79,138,.55)', 'rgba(124,240,176,.5)', 'rgba(57,243,255,.5)', 'rgba(255,210,122,.5)'];
        for (let k = 0; k < 4; k++) {
          const end = P(1 + ((Math.sin(t / 7 + k * 1.7) + 1) / 2) * (cols - 2), 1.5 + ((Math.cos(t / 9 + k * 2.3) + 1) / 2) * (rows - 2.5));
          line(b, src, end, C[k]!); b.rect(end[0] - 1, end[1], 3, 1, C[k]!.replace(/[\d.]+\)$/, '.9)'));
        }
        b.rect(src[0] - 2, src[1] - 1, 5, 3, '#3b3742'); b.rect(src[0] - 1, src[1] + 1, 3, 1, ['#ff4f8a', '#7cf0b0', '#39f3ff'][Math.floor(t / 3) % 3]!);
      },
    },
    aurora: {
      icon: (b) => {
        b.rect(1, 1, 22, 18, '#0b1433');
        for (let x = 1; x < 23; x++) {
          b.rect(x, 4 + Math.round(Math.sin(x / 2.5) * 2), 1, 3, '#7cf0b0');
          b.rect(x, 9 + Math.round(Math.cos(x / 3) * 2), 1, 2, '#c08cf0');
          b.rect(x, 7 + Math.round(Math.sin(x / 2.5) * 2), 1, 1, '#39c8d0');
        }
        for (const [x, y] of [[4, 13], [11, 15], [19, 12], [15, 2]] as const) b.rect(x, y, 1, 1, '#ffffff');
        b.rect(1, 17, 22, 2, '#1c2a4a'); b.rect(4, 16, 5, 1, '#1c2a4a'); b.rect(14, 15, 6, 2, '#1c2a4a');
      },
      scene: (b, W, H, t, P, cols, rows) => {
        b.rect(0, 0, W, H, 'rgba(20,70,90,.08)');
        const band = (at: (g: number, z: number) => Pt, n: number) => {
          for (let g = 0; g <= n; g += 1 / 12) {
            const z = 35 + Math.sin(g * 1.3 + t / 5) * 4, [x, y] = at(g, z);
            b.rect(x, y, 1, 4, 'rgba(124,240,176,.45)'); b.rect(x, y + 4, 1, 2, 'rgba(57,200,208,.3)');
            const [x2, y2] = at(g, z - 7 + Math.cos(g * 0.9 + t / 7) * 2); b.rect(x2, y2, 1, 2, 'rgba(192,140,240,.38)');
            if ((Math.round(g * 12) + t) % 29 === 0) b.rect(x, y - 2, 1, 1, '#eafff4');
          }
        };
        band((g, z) => P(g, 0, z), cols); band((g, z) => P(0, g, z), rows);
        for (let k = 0; k < 6; k++) {
          const [x, y] = P(1 + ((k * 1.9 + t * 0.04) % (cols - 2)), 1 + ((k * 2.7) % (rows - 2)));
          b.rect(x - 6, y, 12, 1, 'rgba(124,240,176,.07)'); b.rect(x - 4, y + 1, 8, 1, 'rgba(124,240,176,.07)');
        }
      },
    },
  },
};
