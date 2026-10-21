// 그림 팩 — 밈 스킨 22종: 개발자·회사원 밈의 '상황'을 방 하나로(그림은 우리 도트로 새로). 장식(scene) 이름은 'mm-' 로 시작
// 벽 장식은 벽 빈 자리(뒤 벽 오른쪽 A·책장 위 S·왼쪽 벽 L1·L2)에 벽 기울기(2:1)대로 붙이고, 바닥 것은 방 오른쪽(gx 9, gy 4.4 언저리)·앞 왼쪽 모서리에
import type { Skin } from '../../office/skins';
import { BASE, type Pack, type Pz, type R } from './types';

type D = (u: number, v: number, w: number, h: number, c: string) => void;
const at = (P: Pz, gx: number, gy: number, z = 0): [number, number] => { const [x, y] = P(gx, gy, z); return [Math.round(x), Math.round(y)]; };
/** 뒤 벽(gy 0)에 붙인 평면 — (gx, z) 가 왼쪽 위, 오른쪽 u·아래 v 화소. 화소 열마다 벽 기울기대로 내려간다 */
const back = (b: R, P: Pz, gx: number, z: number): D => { const [x0, y0] = at(P, gx, 0, z); return (u, v, w, h, c) => { for (let i = u; i < u + w; i++) b.rect(x0 + i, y0 + v + Math.floor(i / 2), 1, h, c); }; };
/** 왼쪽 벽(gx 0)에 붙인 평면 — (gy, z) 가 왼쪽 위, 오른쪽으로 갈수록 올라간다 */
const left = (b: R, P: Pz, gy: number, z: number): D => { const [x0, y0] = at(P, 0, gy, z); return (u, v, w, h, c) => { for (let i = u; i < u + w; i++) b.rect(x0 + i, y0 + v - Math.floor(i / 2), 1, h, c); }; };
/** 정면(벽에 안 붙은 것) — (x0, y0) 기준 */
const flat = (b: R, x0: number, y0: number): D => (u, v, w, h, c) => b.rect(x0 + u, y0 + v, w, h, c);
/** 바닥에 선 것 — 발 가운데가 (0, 0) */
const fl = (b: R, P: Pz, gx: number, gy: number, z = 0): D => { const [x, y] = at(P, gx, gy, z); return flat(b, x, y); };
// 벽 빈 자리 — 방은 8칸(휴게실이 생기면 오른쪽에 2칸 더)이라 뒤 벽 오른쪽은 비어 있지 않다. S 책장 위 25×15, L1 왼쪽 벽(창가 쪽) 30×28, L2 왼쪽 벽(앞쪽) 26×28
const S = (b: R, P: Pz) => back(b, P, 5.05, 42);
const L1 = (b: R, P: Pz) => left(b, P, 2.95, 40);
const L2 = (b: R, P: Pz) => left(b, P, 6.6, 40);
/** 바닥 앞 왼쪽 모서리 — 책상·통로·휴게실 어디와도 안 겹치는 자리(k 40 = 맨 앞) */
const corner = (b: R, P: Pz, rows: number) => fl(b, P, 0.45, rows - 0.55);

// 3×5 도트 글자
const G: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001011001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  '+': '000010111010000', '<': '001010100010001', '>': '100010001010100', '=': '000111000111000', '!': '010010010000010',
  '?': '110001010000010', '%': '101001010100101', '-': '000000111000000', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', I: '111010010010111', L: '100100100100111', M: '101111111101101', O: '111101101101111',
  P: '110101110100100', R: '110101110101101', T: '111010010010010', U: '101101101101111', Y: '101101010010010',
};
const txt = (d: D, s: string, u: number, v: number, c: string, sc = 1) =>
  [...s].forEach((ch, k) => { const g = G[ch]; if (g) for (let p = 0; p < 15; p++) if (g[p] === '1') d(u + (k * 4 + (p % 3)) * sc, v + Math.floor(p / 3) * sc, sc, sc, c); });
const tw = (s: string) => s.length * 4 - 1;
/** 글자 줄 그림 — '.' 은 비움, 같은 글자가 이어지면 한 번에 */
const spr = (d: D, u: number, v: number, rows: string[], pal: Record<string, string>, sc = 1) =>
  rows.forEach((r, y) => { for (let x = 0; x < r.length; ) { const ch = r[x]!; let n = 1; while (r[x + n] === ch) n++; if (ch !== '.') d(u + x * sc, v + y * sc, n * sc, sc, pal[ch]!); x += n; } });
const sh = (d: D, du: number, dv: number): D => (u, v, w, h, c) => d(u + du, v + dv, w, h, c);
/** 빨간 숫자 배지(알림) */
const badge = (d: D, u: number, v: number, s: string, c = '#e5484d') => { const w = tw(s) + 4; d(u + 1, v, w - 2, 7, c); d(u, v + 1, w, 5, c); txt(d, s, u + 2, v + 1, '#ffffff'); };
/** 바닥 마름모(평평한 자국) — hw 짝수 */
const diamond = (b: R, x: number, y: number, hw: number, c: string) => { for (let dy = -hw / 2; dy <= hw / 2; dy++) { const w = 2 * (hw - 2 * Math.abs(dy)); if (w > 0) b.rect(x - w / 2, y + dy, w, 1, c); } };

const MUG = [
  'ooooooooooo..', 'owcccccccwo..', 'owwwwwwwwwooo', 'owewwwwwewo.o', 'owwwwwwwwwo.o', 'owrmwwwmrwo.o',
  'owwwmmmwwwooo', 'owwwwwwwwwo..', 'oswwwwwwwso..', 'ossssssssso..', '.ooooooooo...',
];
const BELL = [
  '.....ooo.....', '....oyhyo....', '...oyhyyyo...', '..oyhyyyyyo..', '..oyhyyyyyo..', '..oyyyyyyyo..', '..oyyyyyyyo..',
  '.oyyyyyyyyyo.', 'oyyyyyyyyyyyo', 'ossssssssssso', '.ooooooooooo.', '.....oco.....', '......o......',
];
const GHOST = [
  '....ooooooo....', '..oowwwwwwwoo..', '.owwwwwwwwwwwo.', '.owwweewweewwo.', '.owwweewweewwo.',
  ...Array<string>(9).fill('owwwwwwwwwwwwwo'), 'oswwwwwwwwwwwso',
];
const ENV = ['ooooooooo', 'ovwwwwwvo', 'owvwwwvwo', 'owwvwvwwo', 'owwwvwwwo', 'ooooooooo'];
const ENVP = { o: '#7a8aa6', w: '#ffffff', v: '#b8c4d8' };
const DUCK = [
  '.........oooo....', '........oyyyyo...', '.......oyyyyyyo..', '.......oyyyeyyo..', '.......oyyyyyybbo', '..o....oyyyyyyoo.',
  '.oyo..oyyyyyyyo..', '.oyyooyyyyyyyyo..', '.oyyyyyyyyyyyyyo.', '.oyyyyhyyyyyyyyo.', '.oyyyyyhhyyyyyso.', '..osssssssssssso.', '...oooooooooooo..',
];
const DUCKS = ['.....ooo.', '....oyeyb', 'o...oyyyo', 'oyooyyyyo', 'oyyyyyyyo', '.oyyyyyo.', '..ooooo..'];
const DUCKP = { o: '#8a6a10', y: '#ffd23f', e: '#1a1a1a', b: '#ff8a1f', h: '#f0be2a', s: '#e0a91f' };
const CACTUS = [
  '....ooo....', '...oghgo...', '...oghgo.o.', '.o.oghgoogo', 'ogooghgoogo', 'ogooghggggo', 'ogggghgooo.', '.oooghgo...',
  ...Array<string>(9).fill('...oghgo...'), '..ooooooo..',
];
const WEED = ['..ooooo..', '.o.o.o.o.', 'o.o...o.o', 'oo.o.o..o', 'o..o.o.oo', 'o.o...o.o', '.o.o.o.o.', '..ooooo..'];
const CLOUD = ['.....ooooo.....', '...oocccccoo...', '.ooccccccccco..', 'occcccccccccco.', 'occccccccccccco', 'osssssssssssso.', '.oooooooooooo..'];
const CHECK = ['......1', '.....11', '1...11.', '11.11..', '.111...', '..1....'];
const BUG = ['.o.o.', '..o..', 'orrro', '.rkr.', 'orrro'];
const BUGP = { o: '#1a1a1a', r: '#e5484d', k: '#1a1a1a' };
const TAB = ['...1..1', '....1.1', '1111111', '....1.1', '...1..1'];
const HAND = ['1.1.1', '1.1.1', '11111', '11111', '.111.', '.111.'];

/** 불꽃 — base 줄에서 위로, 열마다 높이가 t 로 흔들린다 */
const flames = (d: D, w: number, base: number, t: number, s = 0) => {
  for (let i = 0; i < w; i++) {
    const h = 5 + Math.round(2.5 * Math.sin(i * 0.9 + t * 1.1 + s) + 1.5 * Math.sin(i * 2.3 - t * 0.7));
    d(i, base - h, 1, h, '#d93a2f'); if (h > 3) d(i, base - h + 2, 1, h - 2, '#ff8a1f'); if (h > 5) d(i, base - h + 4, 1, h - 4, '#ffd23f');
  }
};
/** 경광등(벽에 붙음) — 도는 빛이 좌우로 번갈아 */
const beacon = (d: D, u: number, v: number, t: number) => {
  const dir = t % 8 < 4 ? -1 : 1;
  if (t % 4 !== 3) for (let k = 1; k <= 9; k++) d(u + 4 + dir * (4 + k), v + 3 - ((1 + k) >> 1), 1, 1 + k, 'rgba(255,70,70,.3)');
  d(u + 3, v, 3, 1, '#7a1a1a'); d(u + 2, v + 1, 5, 1, '#7a1a1a'); d(u + 1, v + 2, 7, 4, '#7a1a1a');
  d(u + 3, v + 1, 3, 1, '#e5484d'); d(u + 2, v + 2, 5, 4, '#e5484d'); d(u + 2 + [0, 1, 2, 3, 4, 3, 2, 1][t % 8]!, v + 2, 1, 3, '#ffd0d0');
  d(u, v + 6, 9, 3, '#3a3e58'); d(u + 1, v + 7, 7, 1, '#7a7f9e');
};
/** 펄럭이는 깃발 — 장대 (0, 0) 발, dir 1 = 오른쪽으로 */
const flag = (d: D, t: number, c: string, s: string, dir: 1 | -1, bags = true) => {
  if (bags) { d(-4, -3, 9, 3, '#b8a070'); d(-3, -4, 7, 1, '#cbb585'); d(-4, -1, 9, 1, '#8a7a50'); } // 모래주머니
  d(0, -28, 1, 25, '#5a3a1a'); d(-1, -29, 3, 1, '#ffd23f');
  const wv: D = (u, v, w, h, cc) => { for (let i = u; i < u + w; i++) d(i, v + (((Math.abs(i) + t) >> 2) % 2), 1, h, cc); };
  const u0 = dir > 0 ? 1 : -15;
  wv(u0, -28, 15, 10, c); wv(u0, -19, 15, 1, 'rgba(0,0,0,.25)'); txt(wv, s, u0 + 2, -26, '#ffffff');
};
const trace = (d: D, w: number, seed: number, t: number) => {
  for (let r = 0; r < 9; r++) {
    const v = 1 + r * 3, h = (r * 37 + seed * 11) % 97, hot = r % 3 === 0 || r === (t >> 2) % 9;
    const c1 = hot ? '#d93a3f' : '#8a7472', c2 = hot ? '#f08080' : '#b8a4a2';
    let u = r === 0 ? 0 : 3 + (h % 2) * 2;
    for (const [n, c] of [[4 + (h % 7), c1], [2 + ((h >> 2) % 6), c2], [3 + ((h >> 4) % 5), c1]] as const) { if (u < w) d(u, v, Math.min(n, w - u), 1, c); u += n + 1; }
  }
};
const vine = (d: D, u: number, len: number, s: number) => {
  d(u, 0, 1, len, '#2f6b2a');
  for (let k = 2; k < len - 1; k += 3) d(u + ((k + s) % 2 ? 1 : -2), k, 2, 2, (k + s) % 4 < 2 ? '#5aa04a' : '#3f8a3a');
};
const tube = (d: D, w: number, on: boolean) => { d(0, 0, w, 2, on ? '#ffffff' : '#9aa3ae'); d(0, 2, w, 1, '#b3bcc6'); if (on) d(0, 3, w, 3, 'rgba(255,255,255,.3)'); };
const dashed = (d: D, u: number, v: number, w: number, h: number, c: string, bg: string) => {
  d(u, v, w, h, bg);
  for (let i = 0; i < w; i++) if (!((i >> 1) % 2)) { d(u + i, v, 1, 1, c); d(u + i, v + h - 1, 1, 1, c); }
  for (let j = 0; j < h; j++) if (!((j >> 1) % 2)) { d(u, v + j, 1, 1, c); d(u + w - 1, v + j, 1, 1, c); }
};
const cap = (b: R, x: number, y: number, c: string) => { b.rect(x, y, 4, 3, c); b.rect(x, y + 3, 4, 1, '#6a6680'); b.rect(x + 1, y + 1, 1, 1, '#3a3650'); };

const sk = (o: Partial<Skin>): Skin => ({ ...BASE, ...o });
const DARK = { line: '#07070f', label: 'dark' as const };

export const MEME: Pack = {
  scene: {
    // ── 다들 괜찮은 서버실: 서버 랙(불붙은) + 벽 밑 불길 + 웃는 머그컵
    'mm-racks': { draw: (b, P, _sk, t) => {
      const d = L1(b, P);
      for (const u of [2, 16]) {
        d(u, 0, 11, 28, '#121015'); d(u + 1, 1, 9, 26, '#24212a');
        for (let r = 0; r < 8; r++) { d(u + 2, 2 + r * 3, 7, 2, '#3a3642'); d(u + 3, 2 + r * 3, 1, 1, (r + t + u) % 4 ? '#7cf08a' : '#1d3a22'); d(u + 6, 2 + r * 3, 1, 1, (r * 3 + t) % 5 < 2 ? '#ff5a3c' : '#4a1a14'); }
      }
    } },
    'mm-fire': { draw: (b, P, _sk, t) => { flames(left(b, P, 6.6, 12), 26, 10, t, 2); flames(left(b, P, 2.95, 12), 30, 10, t); flames(sh(L1(b, P), 17, 0), 9, 13, t, 4); } },
    'mm-finemug': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows);
      spr(d, -6, -11, MUG, { o: '#120c0e', w: '#f2ece4', c: '#6b3f22', e: '#120c0e', r: '#ff9a9a', m: '#120c0e', s: '#c9bfb2' });
      for (const [u, s] of [[-3, 0], [1, 3]] as const) for (let k = 0; k < 4; k++) d(u + (((k + (t >> 1) + s) >> 1) % 2), -13 - k, 1, 1, 'rgba(255,255,255,.55)');
    } },
    // ── 알림 폭탄: 숫자 배지 비 + 흔들리는 종 + 배지 더미
    'mm-badgerain': { draw: (b, P, _sk, t) => {
      const lanes: [boolean, number, number, number][] = [[false, 2.5, 37, 22], [false, 1.5, 37, 22], [false, 0.7, 34, 20], [false, 6.2, 37, 22], [false, 5.0, 37, 22], [true, 5.3, 38, 10], [true, 7.0, 38, 10]];
      lanes.forEach(([bk, g, top, range], i) => {
        const z = top - ((t * 2 + i * 9) % range), [x, y] = bk ? at(P, g, 0, z) : at(P, 0, g, z);
        badge(flat(b, x - 3, y - 3), 0, 0, String(((i * 4 + (t >> 3)) % 9) + 1));
      });
    } },
    'mm-bell': { draw: (b, P, _sk, t) => {
      const [x, y] = at(P, 6.15, 0, 38), sw = [0, 1, 1, 0, 0, -1, -1, 0][t % 8]!, d = flat(b, x - 6 + sw, y);
      spr(d, 0, 0, BELL, { o: '#7a5a12', y: '#ffd23f', h: '#fff3b0', s: '#e0a91f', c: '#7a5a12' });
      badge(d, -6, -3, '99+');
      if (t % 4 < 2) for (const s of [-1, 1]) { const u = s < 0 ? -3 : 15; d(u, 4, 1, 4, '#e5484d'); d(u - s, 3, 1, 1, '#e5484d'); d(u - s, 8, 1, 1, '#e5484d'); }
    } },
    'mm-badgepile': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows);
      ([[-11, -7], [-4, -7], [3, -7], [-8, -13], [-1, -13], [-4, -19]] as const).forEach(([u, v], i) => badge(d, u, v - (i === 5 ? [0, 1, 2, 1][(t >> 1) % 4]! : 0), String(((i * 7 + 3) % 9) + 1)));
    } },
    // ── 404 유령 방: 빈 액자 + 404 벽보 + 떠다니는 '404' 유령
    'mm-frames404': { draw: (b, P, _sk, t) => {
      const d = S(b, P);
      dashed(d, 1, 1, 10, 12, '#8a7fb0', '#f7f6fb'); txt(d, '?', 4, 4, '#8a7fb0');
      dashed(d, 14, 2, 10, 12, '#8a7fb0', '#f7f6fb'); txt(d, '?', 17, 5, t % 8 < 4 ? '#8a7fb0' : '#c4bdd8');
      const l = L1(b, P); l(2, 4, 26, 14, '#dcd6ec'); txt(l, '404', 4, 6, '#8a7fb0', 2); l(4, 20, 20, 2, '#c4bdd8'); l(4, 24, 14, 2, '#c4bdd8');
    } },
    'mm-ghost': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const [x, y] = at(P, 0.5, rows - 0.6); b.rect(x - 5, y - 1, 11, 2, 'rgba(60,40,90,.18)');
      const d = flat(b, x - 7, y - 32 - [0, 1, 2, 1][(t >> 1) % 4]!);
      spr(d, 0, 0, GHOST, { o: '#5a4f7a', w: '#ffffff', e: '#3a3050', s: '#e4e0f0' });
      txt(d, '404', 2, 7, '#8a7fb0');
      for (let i = 0; i < 15; i++) { const up = (i + (t >> 1)) % 4 < 2; d(i, 15, 1, 1, up ? '#5a4f7a' : '#ffffff'); if (!up) d(i, 16, 1, 1, '#5a4f7a'); }
    } },
    // ── 금요일 배포 경보: 도는 경광등 + FRI DEPLOY 간판 + 커다란 배포 단추
    'mm-siren': { draw: (b, P, _sk, t) => { beacon(S(b, P), 8, 4, t); beacon(L2(b, P), 9, 3, t + 4); } },
    'mm-fri': { draw: (b, P, _sk, t) => {
      const d = L1(b, P); d(1, 3, 28, 23, '#e5484d'); d(2, 4, 26, 21, '#1a1020');
      txt(d, 'FRI', 4, 6, t % 4 < 2 ? '#ff5a5f' : '#7a2a30', 2); txt(d, 'DEPLOY', 3, 18, '#ffd23f');
    } },
    'mm-redbutton': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows), p = t % 16 < 2 ? 1 : 0;
      d(-7, -11, 15, 11, '#2e3248'); d(-7, -1, 15, 1, '#1a1c2a'); d(6, -10, 2, 9, '#262a3c');
      for (let r = 0; r < 3; r++) for (let i = 0; i < 15; i++) d(-7 + i, -8 + r, 1, 1, ((i + r) >> 1) % 2 ? '#1a1a1a' : '#ffd23f');
      d(-5, -14 + p, 11, 3, '#7a1a1a'); d(-4, -15 + p, 9, 1, '#7a1a1a'); d(-4, -14 + p, 9, 2, '#e5484d'); d(-3, -14 + p, 3, 1, '#ff9a9a');
    } },
    // ── 머지 충돌 전쟁터: <<<<<<< ======= >>>>>>> 칠판 + 우리 깃발(바닥)·저쪽 깃발(벽)
    'mm-conflict': { draw: (b, P, _sk, t) => {
      const d = L1(b, P); d(0, 1, 30, 25, '#3a3a24'); d(1, 2, 28, 23, '#2c3a2c');
      txt(d, '<<<<<<<', 1, 5, '#7cf08a'); txt(d, '=======', 1, 12, t % 8 < 4 ? '#ffd23f' : '#8a7a2a'); txt(d, '>>>>>>>', 1, 19, '#7fb8ff');
    } },
    'mm-flagours': { k: 40, draw: (b, P, _sk, t, _c, rows) => flag(corner(b, P, rows), t, '#3f9a4f', '<<<', 1) },
    'mm-flagtheirs': { draw: (b, P, _sk, t) => flag(sh(L2(b, P), 4, 27), t + 2, '#3f6fd0', '>>>', 1, false) },
    // ── 메일함 999+: 커다란 봉투 배지 + 떨어지는 봉투 + 봉투 더미
    'mm-badge999': { draw: (b, P, _sk, t) => { const d = L1(b, P); spr(d, 4, 3, ENV, ENVP, 2); badge(d, 9, 14, '999+', t % 8 < 4 ? '#e5484d' : '#ff6b6f'); } },
    'mm-mailfall': { draw: (b, P, _sk, t) => {
      const lanes: [boolean, number, number, number][] = [[false, 6.2, 37, 22], [false, 5.3, 35, 20], [false, 4.6, 37, 22], [true, 5.4, 37, 9], [true, 6.8, 37, 9]];
      lanes.forEach(([bk, g, top, range], i) => {
        const z = top - ((t * 2 + i * 11) % range), [x, y] = bk ? at(P, g, 0, z) : at(P, 0, g, z), sw = [0, 1, 1, 0, 0, -1, -1, 0][(t + i * 3) % 8]!;
        spr(flat(b, x - 4 + sw, y - 3), 0, 0, ENV, ENVP);
      });
    } },
    'mm-mailpile': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows);
      for (const [u, v] of [[-13, -6], [-4, -6], [5, -6], [-9, -11], [0, -11], [-5, -16]] as const) spr(d, u, v, ENV, ENVP);
      spr(d, -5 + [0, 0, 1, 2, 3, 2, 1, 0][(t >> 1) % 8]!, -21, ENV, ENVP);
    } },
    // ── 연봉 협상 사막: 아른거리는 동전 신기루 + 뜨거운 해 + 선인장 + 굴러가는 덤불
    'mm-mirage': { draw: (b, P, _sk, t) => {
      const d = L1(b, P), stacks = [[3, 6], [11, 9], [19, 12]] as const;
      for (const [u0, n] of stacks) for (let k = 0; k < n; k++) { const v = 26 - k * 2, s = (((v + t) >> 1) % 3) - 1; d(u0 + s, v - 1, 7, 1, 'rgba(255,233,138,.9)'); d(u0 + s, v, 7, 1, 'rgba(201,154,46,.9)'); }
      for (let r = 0; r < 3; r++) d(0, 21 + r * 2 + ((t >> 1) % 2), 30, 1, 'rgba(255,255,255,.2)');
      const [su, n] = stacks[(t >> 1) % 3]!, sv = 26 - n * 2 - 3; d(su + 3, sv - 1, 1, 3, '#ffffff'); d(su + 2, sv, 3, 1, '#ffffff');
      const s = S(b, P), ray = t % 4 < 2 ? '#ffb33b' : '#ff8a1f';
      s(10, 3, 7, 7, '#ffd23f'); s(9, 4, 9, 5, '#ffd23f'); s(11, 4, 3, 2, '#fff3b0');
      for (const [u, v] of [[13, 0], [13, 12], [5, 6], [21, 6], [7, 1], [19, 1], [7, 11], [19, 11]] as const) s(u, v, 1, 1, ray);
    } },
    'mm-cactus': { k: 40, draw: (b, P, _sk, _t, _c, rows) => {
      const d = corner(b, P, rows); spr(d, -5, -18, CACTUS, { o: '#2f5a2a', g: '#5aa04a', h: '#8ad070' }); d(-1, -19, 3, 1, '#ff8ac2'); d(0, -20, 1, 1, '#ff8ac2');
    } },
    'mm-tumble': { k: 41, draw: (b, P, _sk, t, _c, rows) => {
      const f = (t % 80) / 80, d = fl(b, P, 1.4 + 6 * f, rows - 0.3), hop = [0, 1, 2, 1][t % 4]!;
      d(-4, -1, 9, 1, 'rgba(90,60,20,.2)');
      spr(d, -4, -8 - hop, t % 2 ? WEED : WEED.map((r) => [...r].reverse().join('')), { o: '#9a6a32' });
    } },
    // ── 커피 링거 병동: 커피 링거대 + 카페인 심전도
    'mm-ivpole': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows), m = '#9aaeab';
      d(-5, -1, 11, 1, '#8a9a98'); for (const u of [-5, -1, 4]) d(u, 0, 2, 1, '#3a4a48');
      d(0, -33, 1, 32, m); d(-4, -33, 9, 1, m); d(-4, -32, 1, 2, m); d(4, -32, 1, 2, m);
      d(0, -30, 9, 13, '#5a4a3a'); d(1, -29, 7, 11, '#efe8dc'); d(1, -25, 7, 7, '#6b3f22'); d(2, -28, 5, 3, '#ffffff'); d(3, -27, 2, 2, '#8a5a3a'); d(5, -27, 1, 1, '#8a5a3a');
      d(4, -17, 1, 2, '#b8a890'); d(3, -15, 3, 4, '#c9d6d4'); d(4, -15 + (t % 4), 1, 1, '#6b3f22'); d(4, -11, 1, 7, '#b8a890'); d(1, -4, 4, 1, '#b8a890');
    } },
    'mm-ekg': { draw: (b, P, _sk, t) => {
      const d = L1(b, P), beat = [0, 0, 0, 0, 1, -5, 4, -1, 0, 0, 0, 0];
      d(1, 3, 28, 20, '#5a6a68'); d(2, 4, 26, 18, '#0e1a18');
      d(4, 6, 4, 3, '#ffb35a'); d(8, 7, 1, 1, '#ffb35a'); d(5, 5, 1, 1, 'rgba(255,255,255,.5)'); txt(d, '300', 15, 5, '#7cf08a');
      let prev = 15 + beat[t % 12]!;
      for (let i = 0; i < 26; i++) { const cur = 15 + beat[(i + t) % 12]!; d(2 + i, Math.min(prev, cur), 1, Math.abs(cur - prev) + 1, '#7cf08a'); prev = cur; }
    } },
    // ── 마감 좀비 사무실: D-0 달력 + 초록 손자국 + 바닥 안개
    'mm-dday': { draw: (b, P, _sk, t) => {
      const d = L1(b, P); d(1, 3, 26, 20, '#c8d6b8'); d(1, 3, 26, 5, '#b3321f'); d(6, 1, 2, 4, '#1a2218'); d(20, 1, 2, 4, '#1a2218');
      txt(d, 'D-0', 3, 10, t % 8 < 4 ? '#e5484d' : '#7a1a1a', 2);
      const h = L2(b, P);
      for (const [u, v] of [[3, 8], [11, 15], [17, 4], [20, 17]] as const) { spr(h, u, v, HAND, { '1': 'rgba(159,214,107,.6)' }); h(u + 2, v + 6, 1, 2 + (((t >> 2) + u) % 2), 'rgba(159,214,107,.5)'); }
    } },
    'mm-fog': { draw: (b, P, _sk, t, _c, rows) => {
      for (let i = 0; i < 8; i++) {
        const [x, y] = at(P, 0.8 + ((i * 1.7 + t * 0.03) % 6.4), 1.6 + ((i * 2.3) % (rows - 2.6)));
        b.rect(x - 8, y - 1, 16, 2, 'rgba(159,214,107,.16)'); b.rect(x - 5, y - 3, 10, 2, 'rgba(159,214,107,.1)');
      }
    } },
    // ── 모니터 탑: 쌓은 모니터 여섯 대 + 벽 가득 모니터
    'mm-montower': { k: 40, draw: (b, P, sk, t, _c, rows) => {
      const d = fl(b, P, 0.6, rows - 0.55); d(-2, -4, 5, 4, '#2a2d33'); d(-7, -1, 15, 1, '#2a2d33');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        const u = -11 + c * 11, v = -28 + r * 8; d(u, v, 11, 8, '#121418'); d(u + 1, v + 1, 9, 6, '#0e1a26');
        for (let l = 0; l < 3; l++) d(u + 2 + (l % 2), v + 2 + l * 2, 2 + ((t + r * 3 + c * 5 + l * 2) % 5), 1, sk.on[(r + c + l) % 3]!);
      }
    } },
    'mm-monwall': { draw: (b, P, sk, t) => {
      const d = L1(b, P);
      for (const [u, v, w, h] of [[1, 2, 13, 10], [15, 2, 13, 10], [5, 14, 19, 11]] as const) {
        d(u, v, w, h, '#121418'); d(u + 1, v + 1, w - 2, h - 2, '#0e1a26');
        for (let l = 0; l < (h - 3) >> 1; l++) d(u + 2 + (l % 3), v + 2 + l * 2, 2 + ((t + u + l * 3) % (w - 6)), 1, sk.on[(u + l) % 3]!);
      }
    } },
    // ── 무한 로딩 방: 도는 로딩 원 + 99% 막대
    'mm-spinner': { draw: (b, P, _sk, t) => {
      const [x, y] = at(P, 0, 5.4, 26), d = flat(b, x, y), head = t % 8;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, age = (head - k + 8) % 8;
        d(Math.round(9 * Math.cos(a)) - 2, Math.round(9 * Math.sin(a)) - 2, 4, 4, ['#3f6fd0', '#6a8fe0', '#9ab4ea'][age] ?? '#c3c9d4');
      }
    } },
    'mm-bar99': { draw: (b, P, _sk, t) => {
      const d = L1(b, P); txt(d, '99%', 9, 6, '#3f6fd0');
      d(1, 13, 28, 7, '#8a94a8'); d(2, 14, 26, 5, '#f4f6fa'); d(2, 14, 25, 5, '#3f6fd0'); d(2, 14, 25, 1, '#7fa0e0'); d(27, 14, 1, 5, t % 4 < 2 ? '#3f6fd0' : '#f4f6fa');
    } },
    // ── 스택 트레이스 벽지: 벽마다 빨간 오류 줄 + ERROR 간판
    'mm-tracewall': { draw: (b, P, _sk, t) => { trace(L1(b, P), 30, 2, t); trace(L2(b, P), 26, 3, t); } },
    'mm-err': { draw: (b, P, _sk, t) => { const d = S(b, P); d(0, 2, 25, 11, t % 8 < 4 ? '#c23a3f' : '#8a1f24'); d(1, 3, 23, 9, '#e5484d'); txt(d, 'ERROR', 3, 5, '#ffffff'); } },
    // ── 회의만 하는 회의실: 꽉 찬 일정 화이트보드 + 포스트잇
    'mm-schedule': { draw: (b, P, _sk, t) => {
      const d = L2(b, P), C = ['#ff9a8a', '#8fd0ff', '#ffd27a', '#9ef0a4', '#c9b3ff'], blink = (t >> 2) % 30;
      d(0, 1, 26, 24, '#9aa3b2'); d(1, 2, 24, 22, '#ffffff');
      for (let c = 0; c < 5; c++) { d(3 + c * 4, 3, 3, 1, '#5a6b8a'); for (let r = 0; r < 6; r++) if (r * 5 + c !== blink) d(3 + c * 4, 5 + r * 3, 3, 2, C[(c * 2 + r) % 5]!); }
      d(4, 24, 16, 1, '#5a6b8a'); d(6, 23, 4, 1, '#e5484d');
    } },
    'mm-stickies': { draw: (b, P, _sk, t) => {
      const d = L1(b, P);
      ([[2, 4, '#ffe98a'], [10, 2, '#ffb3c8'], [18, 5, '#bfe3ff'], [4, 13, '#c9f0c1'], [13, 12, '#ffe98a'], [21, 14, '#ffb3c8'], [8, 21, '#bfe3ff'], [17, 21, '#ffe98a']] as const).forEach(([u, v, c], i) => {
        const lift = i === (t >> 2) % 8 ? 1 : 0; d(u, v, 7, 6 - lift, c); d(u, v + 5 - lift, 7, 1, 'rgba(0,0,0,.14)'); d(u + 1, v + 2, 4, 1, '#7a6a5a'); d(u + 1, v + 4 - lift, 3, 1, '#a89888');
      });
    } },
    // ── 고무 오리 상담소: 커다란 오리(말풍선) + 오리 자격증 액자
    'mm-bigduck': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = fl(b, P, 0.6, rows - 0.55), bob = (t >> 2) % 2; d(-8, -1, 16, 2, 'rgba(26,46,51,.15)');
      spr(d, -9, -13 - bob, DUCK, DUCKP);
      const q = (t >> 3) % 3; d(-3, -28 - bob, 13, 9, '#1a2e33'); d(-2, -27 - bob, 11, 7, '#ffffff'); d(0, -19 - bob, 2, 2, '#1a2e33');
      if (q === 2) for (const u of [0, 3, 6]) d(u, -23 - bob, 2, 1, '#1a2e33'); else txt(d, q ? '!' : '?', 2, -26 - bob, '#1a2e33');
    } },
    'mm-duckframe': { draw: (b, P) => {
      const d = L1(b, P); d(4, 4, 22, 19, '#8a6a4a'); d(5, 5, 20, 17, '#fffaf0'); spr(d, 7, 8, DUCKS, DUCKP);
      for (const [v, w] of [[8, 7], [11, 6], [14, 7]] as const) d(17, v, w, 1, '#c9bfb2'); d(19, 17, 4, 3, '#e5484d');
    } },
    // ── 키보드 샷건: 바닥에 흩어진 키캡 + 키 빠진 키보드 트로피(키가 튄다)
    'mm-keyfloor': { draw: (b, P, _sk, _t, _c, rows) => {
      const C = ['#e8e6f0', '#e8e6f0', '#b6ff5c', '#ff4fd8', '#39f3ff'];
      ([[1.4, 2.5], [2.5, 2.7], [5.6, 2.6], [6.6, 2.5], [7.6, 2.9], [1.2, 7.4], [2.6, 7.6], [4.0, 7.3], [5.4, 7.6], [6.8, 7.4], [7.6, 6.9]] as const).forEach(([gx, gy], i) => {
        if (gy > rows - 0.3) return; const [x, y] = at(P, gx, gy); cap(b, x - 2, y - 3, C[i % 5]!);
      });
    } },
    'mm-keytrophy': { draw: (b, P, _sk, t) => {
      const d = L1(b, P); d(1, 6, 28, 14, '#8a6a3a'); d(2, 7, 26, 12, '#5a3f22'); d(3, 9, 24, 8, '#2a2438');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r * 8 + c) % 5 !== 2) d(4 + c * 3, 10 + r * 2, 2, 1, (r + c) % 4 ? '#e8e6f0' : '#b6ff5c');
      d(10, 17, 10, 1, '#ffd23f');
      for (let i = 0; i < 3; i++) { const ph = (t + i * 5) % 12; d(13 + (i - 1) * ph, 6 - ((ph * (12 - ph)) >> 2), 2, 2, ['#e8e6f0', '#ff4fd8', '#39f3ff'][i]!); }
    } },
    // ── 월요병 방: 축 처진 MON 달력 + 머리 위 비구름
    'mm-droopcal': { draw: (b, P, _sk, t) => {
      const d = L1(b, P), sag = 2 + ((t >> 3) % 3);
      for (let i = 0; i < 24; i++) { const ext = Math.round(sag * Math.sin((Math.PI * i) / 23)); d(3 + i, 9, 1, 13 + ext, '#eef1f5'); d(3 + i, 22 + ext, 1, 1, '#9aa3b2'); }
      d(3, 3, 24, 6, '#5f6b80'); txt(d, 'MON', 10, 4, '#ffffff'); d(7, 2, 1, 2, '#2a2f3a'); d(22, 2, 1, 2, '#2a2f3a');
      for (const v of [12, 15, 18]) d(5, v, 20, 1, '#c9d0da');
    } },
    'mm-raincloud': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = fl(b, P, 0.6, rows - 0.55), bob = (t >> 2) % 2; d(-6, -1, 13, 2, 'rgba(127,160,224,.35)');
      for (let i = 0; i < 4; i++) d(-5 + i * 3, -24 + ((t * 2 + i * 5) % 22), 1, 2, '#7fa0e0');
      spr(d, -7, -33 - bob, CLOUD, { o: '#4a5160', c: '#8a93a3', s: '#6b7383' });
    } },
    // ── 카메라 끈 화상회의: 까만 화면 격자 + 음소거 마이크
    'mm-callgrid': { draw: (b, P, _sk, t) => {
      const d = L2(b, P), sp = (t >> 3) % 6; d(0, 2, 25, 20, '#0f1116'); d(1, 3, 23, 18, '#2a2e36');
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const u = 2 + c * 7, v = 4 + r * 8, i = r * 3 + c;
        d(u, v, 6, 7, i === sp ? '#7cf08a' : '#050608'); if (i === sp) d(u + 1, v + 1, 4, 5, '#050608');
        d(u + 1, v + 5, 3, 1, '#5a606c'); d(u + 4, v + 5, 1, 1, '#e5484d');
      }
    } },
    'mm-muted': { draw: (b, P) => {
      const d = L1(b, P), g = '#7a8090';
      d(10, 3, 8, 12, g); d(11, 2, 6, 1, g); d(11, 4, 6, 10, '#c9cfdb');
      d(8, 10, 1, 6, g); d(19, 10, 1, 6, g); d(9, 16, 10, 1, g); d(13, 17, 2, 4, g); d(10, 21, 8, 1, g);
      for (let k = 0; k < 18; k++) d(5 + k, 1 + k, 2, 1, '#e5484d');
      txt(d, 'MUTE', 7, 23, '#e5484d');
    } },
    // ── 내 컴에선 되는데: 조명 받은 초록 체크 PC + 빨간 X 운영 화면
    'mm-okpc': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = fl(b, P, 0.6, rows - 0.55);
      for (let k = 0; k < 26; k++) { const w = 4 + (k >> 1) * 2; d(-(w >> 1), -36 + k, w, 1, 'rgba(255,240,170,.2)'); }
      d(-7, -9, 15, 9, '#e9e2cf'); d(-7, -9, 15, 1, '#ffffff'); d(-7, -1, 15, 1, '#b9b09a'); d(6, -8, 2, 7, '#cfc6ae');
      d(-1, -11, 3, 2, '#2a2a30'); d(-6, -21, 13, 10, '#2a2a30'); d(-5, -20, 11, 8, '#1a3a22'); spr(d, -3, -20, CHECK, { '1': '#7cf08a' });
      ([[-10, -24], [9, -18], [7, -29]] as const).forEach(([u, v], i) => { const ph = (t + i * 3) % 8; if (ph < 3) { d(u, v - ph - 1, 1, 3, '#ffffff'); d(u - 1, v - ph, 3, 1, '#ffffff'); } });
    } },
    'mm-prodfail': { draw: (b, P, _sk, t) => {
      const d = L1(b, P), c = t % 8 < 4 ? '#e5484d' : '#7a1a1a';
      d(3, 1, 23, 25, '#2a2a30'); d(4, 2, 21, 15, '#1a0d0f');
      for (let k = 0; k < 9; k++) { d(9 + k, 5 + k, 2, 1, c); d(18 - k, 5 + k, 2, 1, c); }
      txt(d, 'PROD', 7, 19, '#c9cfdb');
    } },
    // ── 야근 편의점: 삼각김밥·컵라면 진열대 + 깜빡이는 형광등
    'mm-storeshelf': { draw: (b, P) => {
      const d = sh(L1(b, P), 2, 0); d(0, 4, 25, 23, '#8a94a0'); d(1, 5, 23, 21, '#eef1f4');
      for (const v of [11, 18, 25]) d(1, v, 23, 1, '#8a94a0');
      for (const u of [2, 8, 14, 19]) {
        d(u + 2, 7, 1, 1, '#ffffff'); d(u + 1, 8, 3, 1, '#ffffff'); d(u, 9, 5, 2, '#ffffff'); d(u + 1, 9, 3, 2, '#1f3a2a'); d(u, 11, 2, 1, '#ffd23f');
        d(u, 13, 5, 1, '#ffffff'); d(u, 14, 5, 4, '#e5484d'); d(u + 1, 15, 3, 1, '#ffd23f');
      }
      for (let i = 0; i < 7; i++) { d(2 + i * 3, 20, 2, 1, '#ffffff'); d(2 + i * 3, 21, 2, 4, ['#7fd1ff', '#9ef0a4', '#ff9a8a', '#ffd27a'][i % 4]!); }
    } },
    'mm-fluor': { draw: (b, P, _sk, t) => { tube(back(b, P, 5.1, 43), 24, t % 23 > 1); tube(left(b, P, 2.8, 43), 26, true); tube(left(b, P, 6.6, 43), 24, t % 17 !== 5); } },
    // ── 버그 사냥 정글: 덩굴 + 기어 다니는 벌레 + 벌레 채집통·잠자리채
    'mm-vines': { draw: (b, P) => {
      const s = back(b, P, 5.05, 43), l1 = left(b, P, 2.95, 43), l2 = left(b, P, 6.6, 43);
      ([[s, 4, 10], [s, 13, 14], [s, 21, 8], [l1, 3, 22], [l1, 11, 14], [l1, 19, 27], [l1, 27, 12], [l2, 3, 16], [l2, 12, 26], [l2, 21, 18]] as const)
        .forEach(([d, u, len], i) => vine(d, u, len, i));
    } },
    'mm-bugs': { draw: (b, P, _sk, t) => {
      ([[L1(b, P), 26, 6, 0], [L1(b, P), 26, 18, 5], [L2(b, P), 22, 9, 2], [L2(b, P), 22, 20, 7], [S(b, P), 21, 5, 3]] as const).forEach(([d, w, v, s], i) =>
        spr(d, ((t >> 1) + s * 3 + i * 4) % w, v + ((t + i) % 2), BUG, BUGP));
    } },
    'mm-bugjar': { k: 40, draw: (b, P, _sk, t, _c, rows) => {
      const d = corner(b, P, rows), e = '#7a9aa8';
      d(-5, -12, 11, 12, 'rgba(220,240,255,.45)'); d(-5, -12, 1, 12, e); d(5, -12, 1, 12, e); d(-5, -1, 11, 1, e); d(-6, -14, 13, 2, '#c9772f');
      spr(d, -4 + ((t >> 1) % 4), -8, BUG, BUGP);
      d(7, -24, 1, 24, '#8a6a3a'); d(5, -30, 5, 5, 'rgba(255,255,255,.45)'); d(4, -31, 7, 1, '#e8e0d0'); d(4, -30, 1, 5, '#e8e0d0'); d(10, -30, 1, 5, '#e8e0d0'); d(5, -25, 5, 1, '#e8e0d0');
    } },
    // ── 탭 대 스페이스: 왼쪽 벽은 주황 →| , 뒤 벽은 하늘색 점
    'mm-tabs': { draw: (b, P, _sk, t) => {
      for (const [d, n] of [[L1(b, P), 3], [L2(b, P), 3]] as const) for (let r = 0; r < 4; r++) for (let c = 0; c < n; c++) spr(d, 1 + c * 8 + (r === (t >> 3) % 4 ? (t >> 1) % 2 : 0), 3 + r * 6, TAB, { '1': '#d9602a' });
    } },
    'mm-spaces': { draw: (b, P, _sk, t) => {
      const d = S(b, P); for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) d(1 + c * 3, 1 + r * 3, 2, 2, '#2a8aa0');
      if (t % 8 < 4) d(1 + ((t >> 3) % 8) * 3, 13, 2, 1, '#22252c');
    } },
    // ── 레거시 코드 발굴장: 바닥 발굴 구덩이(묻힌 플로피) + 지층 속 화석 모니터 1999
    'mm-digpit': { draw: (b, P, _sk, _t, _c, rows) => {
      const [x, y] = at(P, 3.8, rows - 0.75);
      diamond(b, x, y, 16, '#d9c294'); diamond(b, x, y + 1, 12, '#5a4228');
      b.rect(x - 12, y - 1, 24, 1, 'rgba(255,255,255,.5)'); b.rect(x - 1, y - 6, 1, 12, 'rgba(255,255,255,.5)');
      for (const [sx, sy] of [[-16, -4], [15, -4], [0, -12], [0, 4]] as const) b.rect(x + sx, y + sy, 1, 5, '#5a3a1a');
      b.rect(x + 2, y - 6, 7, 6, '#3f6fd0'); b.rect(x + 4, y - 6, 3, 2, '#c9cfdb'); b.rect(x + 3, y - 3, 5, 3, '#ffffff'); b.rect(x + 1, y, 9, 1, '#6b5030');
      b.rect(x - 8, y + 2, 5, 1, '#c9772f'); b.rect(x - 3, y + 1, 2, 2, '#e8d9b0');
    } },
    'mm-strata': { draw: (b, P, _sk, t) => {
      const d = L1(b, P), bands = ['#b08a5a', '#9a7448', '#c49a64', '#8a6a42', '#b8925e', '#7a5a38'], bone = '#efe4c8';
      for (let r = 0; r < 28; r++) d(0, r, 30, 1, bands[Math.floor(r / 5) % 6]!);
      d(5, 6, 12, 1, bone); d(5, 15, 12, 1, bone); d(5, 6, 1, 10, bone); d(16, 6, 1, 10, bone); d(7, 8, 8, 6, 'rgba(0,0,0,.18)'); d(9, 16, 4, 2, bone);
      d(20, 5, 7, 7, bone); d(21, 6, 5, 5, '#9a7448'); d(22, 7, 3, 3, bone);
      txt(d, '1999', 13, 20, bone);
      for (let i = 0; i < 4; i++) d(3 + i * 7, (t + i * 9) % 28, 1, 1, 'rgba(255,240,200,.6)');
    } },
  },

  skin: {
    serverfire: { ko: '다들 괜찮은 서버실', en: 'Totally Fine Server Room', skin: sk({
      ...DARK, bg: '#1a1214', floor: ['#2e2a2e', '#29252a'], grain: '#3a3438', wallL: '#3a3036', wallR: '#443840', wallTop: '#ff7a2f',
      deskTop: '#5a5560', deskL: '#46424c', deskR: '#38353e', screen: '#1a1420', on: ['#ff9a3c', '#ffd23f', '#9ef0a4'], pat: '#ff8a3d', pot: '#46424c',
      sky: '#7a2a12', frame: '#2a2228', shelf: '#46424c', books: ['#e5484d', '#ff8a1f', '#ffd23f'], cooler: '#5a5560', water: '#ff9a3c', paper: '#f2e6dc',
      weather: 'ember', scene: ['mm-racks', 'mm-fire', 'mm-finemug'] }) },
    notibomb: { ko: '알림 폭탄', en: 'Notification Bomb', skin: sk({
      bg: '#f5f3f7', floor: ['#e9e6ee', '#e2dee9'], grain: '#d6d0de', wallL: '#eeeaf4', wallR: '#f7f5fb', wallTop: '#e5484d',
      deskTop: '#ffffff', deskL: '#dcd6e4', deskR: '#c8c0d4', on: ['#e5484d', '#ffd23f', '#7fd1ff'], line: '#2a2030', pat: '#e5484d', pot: '#dcd6e4',
      sky: '#ffd6d6', frame: '#c8c0d4', shelf: '#dcd6e4', books: ['#e5484d', '#ff8a8a', '#ffd23f'], scene: ['mm-badgerain', 'mm-bell', 'mm-badgepile'] }) },
    ghost404: { ko: '404 유령 방', en: '404 Ghost Room', skin: sk({
      bg: '#e9e6f2', floor: ['#d9d4e8', '#d2cce2'], grain: '#c4bdd8', wallL: '#e4e1ef', wallR: '#efedf7', wallTop: '#8a7fb0',
      deskTop: '#c9c2dc', deskL: '#aaa1c4', deskR: '#958bb3', line: '#2a2438', pat: '#aaa1c4', pot: '#aaa1c4', sky: '#cfc8e8', frame: '#8a7fb0', shelf: '#aaa1c4',
      books: ['#8a7fb0', '#c9b3ff', '#e6d4ff'], pets: ['#ffffff', '#e6d4ff', '#d6ecff', '#ffe0ec'], scene: ['mm-frames404', 'mm-ghost'] }) },
    friday: { ko: '금요일 배포 경보', en: 'Friday Deploy Alarm', skin: sk({
      ...DARK, bg: '#141626', floor: ['#262a40', '#22253a'], grain: '#30354f', wallL: '#2c2f48', wallR: '#343854', wallTop: '#e5484d',
      deskTop: '#4a4f6e', deskL: '#3a3e58', deskR: '#2e3248', on: ['#e5484d', '#ffd23f', '#7fd1ff'], pat: '#e5484d', pot: '#3a3e58',
      sky: '#3a1a2a', frame: '#4a4f6e', shelf: '#3a3e58', books: ['#e5484d', '#ffd23f', '#7a7f9e'], paper: '#e8e8f4', scene: ['mm-siren', 'mm-fri', 'mm-redbutton'] }) },
    mergewar: { ko: '머지 충돌 전쟁터', en: 'Merge Conflict Battlefield', skin: sk({
      bg: '#e9e4d0', floor: ['#a8a070', '#a19968'], grain: '#8a8358', wallL: '#c9c09a', wallR: '#d6cea8', wallTop: '#5a5a3a',
      deskTop: '#7a7a52', deskL: '#636340', deskR: '#525234', line: '#22220f', on: ['#7cf08a', '#7fb8ff', '#ffd23f'], pat: '#7a7a52', pot: '#636340',
      sky: '#d9c9a0', frame: '#5a5a3a', shelf: '#636340', books: ['#3f9a4f', '#3f6fd0', '#ffd23f'], weather: 'ember', scene: ['mm-conflict', 'mm-flagours', 'mm-flagtheirs'] }) },
    inbox999: { ko: '메일함 999+ 눈사태', en: 'Inbox 999+ Avalanche', skin: sk({
      bg: '#eef4fb', floor: ['#f4f6fa', '#eaeef5'], grain: '#d8dfe9', wallL: '#d6e6f7', wallR: '#e4effa', wallTop: '#3f6fd0',
      deskTop: '#ffffff', deskL: '#d6dde8', deskR: '#c2ccda', line: '#1f2a3a', pat: '#7fa0e0', pot: '#d6dde8', sky: '#cfe4ff', frame: '#3f6fd0', shelf: '#c2ccda',
      books: ['#3f6fd0', '#e5484d', '#ffd23f'], scene: ['mm-badge999', 'mm-mailfall', 'mm-mailpile'] }) },
    salarydesert: { ko: '연봉 협상 사막', en: 'Salary Talk Desert', skin: sk({
      bg: '#fbefd6', floor: ['#e8c98a', '#e2c180'], grain: '#d1ad6a', wallL: '#f2d7a6', wallR: '#f8e2b8', wallTop: '#c9772f',
      deskTop: '#b8844f', deskL: '#976a3c', deskR: '#7d5630', line: '#3a2210', pat: '#c9772f', pot: '#976a3c', sky: '#ffcf7a', frame: '#c9772f', shelf: '#976a3c',
      books: ['#ffd23f', '#c9772f', '#5aa04a'], scene: ['mm-mirage', 'mm-cactus', 'mm-tumble'] }) },
    coffeeiv: { ko: '커피 링거 병동', en: 'Coffee IV Ward', skin: sk({
      bg: '#eef6f4', floor: ['#e6efec', '#dee8e5'], grain: '#cddbd7', wallL: '#d4ebe5', wallR: '#e2f3ee', wallTop: '#5aa89a',
      deskTop: '#ffffff', deskL: '#d6e2df', deskR: '#c0d0cc', line: '#1f2f2b', pat: '#5aa89a', pot: '#d6e2df', sky: '#cdeeff', frame: '#5aa89a', shelf: '#c0d0cc',
      books: ['#6b3f22', '#5aa89a', '#ffb35a'], scene: ['mm-ivpole', 'mm-ekg'] }) },
    deadzombie: { ko: '마감 좀비 사무실', en: 'Deadline Zombie Office', skin: sk({
      ...DARK, bg: '#1a2218', floor: ['#3a4636', '#343f30'], grain: '#46553f', wallL: '#3f4d3a', wallR: '#485844', wallTop: '#9fd66b',
      deskTop: '#5a6650', deskL: '#47523f', deskR: '#3a4433', mon: '#1f261c', screen: '#122014', on: ['#9fd66b', '#c9f08a', '#7cf0b0'],
      pets: ['#b8d6a0', '#a9c99a', '#c4dcb0', '#9fc49a', '#cfe0b8', '#b0cfa8'], pat: '#6b8a4f', leaf: ['#6b8a4f', '#4f6b3a'], pot: '#47523f',
      sky: '#2a3a24', frame: '#2a3326', shelf: '#47523f', books: ['#6b8a4f', '#8a6a4f', '#4f5a6b'], paper: '#d8e6c8', scene: ['mm-dday', 'mm-fog'] }) },
    montower: { ko: '모니터 탑', en: 'Monitor Tower', skin: sk({
      ...DARK, bg: '#1c1e22', floor: ['#33363c', '#2e3136'], grain: '#3e424a', wallL: '#3a3d44', wallR: '#43474f', wallTop: '#7fd1ff',
      deskTop: '#55595f', deskL: '#45484e', deskR: '#383b40', on: ['#7fd1ff', '#9ef0a4', '#ffd27a'], pat: '#7fd1ff', pot: '#45484e', sky: '#2a3040',
      frame: '#55595f', shelf: '#45484e', books: ['#7fd1ff', '#9ef0a4', '#ffd27a'], scene: ['mm-monwall', 'mm-montower'] }) },
    loading: { ko: '무한 로딩 방', en: 'Endless Loading Room', skin: sk({
      bg: '#eef1f6', floor: ['#e3e7ee', '#dce1e9'], grain: '#cdd3de', wallL: '#e6eaf2', wallR: '#f0f3f8', wallTop: '#8a94a8',
      deskTop: '#ffffff', deskL: '#d6dbe4', deskR: '#c3c9d4', line: '#262b36', pat: '#8a94a8', pot: '#d6dbe4', frame: '#8a94a8', shelf: '#c3c9d4',
      books: ['#3f6fd0', '#7fa0e0', '#b8c8ee'], scene: ['mm-spinner', 'mm-bar99'] }) },
    stacktrace: { ko: '스택 트레이스 벽지', en: 'Stack Trace Wallpaper', skin: sk({
      bg: '#fbf3f2', floor: ['#e9dedd', '#e2d6d5'], grain: '#d4c6c4', wallL: '#f6eeed', wallR: '#fbf6f5', wallTop: '#c23a3f',
      deskTop: '#f4ecea', deskL: '#d9cbc8', deskR: '#c4b4b1', line: '#2a1a1a', pat: '#c23a3f', pot: '#d9cbc8', frame: '#c23a3f', shelf: '#c4b4b1',
      books: ['#e5484d', '#b9a9a8', '#8a6f6e'], scene: ['mm-tracewall', 'mm-err'] }) },
    meetings: { ko: '회의만 하는 회의실', en: 'Meetings About Meetings', skin: sk({
      bg: '#f2efe9', floor: ['#c9c2b5', '#c2bbad'], grain: '#b3ab9c', wallL: '#e9e4da', wallR: '#f3efe7', wallTop: '#5a6b8a',
      deskTop: '#e6e0d4', deskL: '#cbc3b4', deskR: '#b4ab9a', line: '#22262e', pat: '#5a6b8a', pot: '#cbc3b4', frame: '#5a6b8a', shelf: '#b4ab9a',
      books: ['#ff9a8a', '#8fd0ff', '#ffd27a', '#9ef0a4'], scene: ['mm-schedule', 'mm-stickies'] }) },
    rubberduck: { ko: '고무 오리 상담소', en: 'Rubber Duck Counseling', skin: sk({
      bg: '#eaf6f8', floor: ['#cfe9ee', '#c5e2e8'], grain: '#b3d6dd', wallL: '#dff1f4', wallR: '#ebf8fa', wallTop: '#3f9aa8',
      deskTop: '#ffffff', deskL: '#d2e6ea', deskR: '#bcd6dc', line: '#1a2e33', pat: '#ffd23f', pot: '#d2e6ea', frame: '#3f9aa8', shelf: '#bcd6dc',
      books: ['#ffd23f', '#3f9aa8', '#ff8a1f'], scene: ['mm-bigduck', 'mm-duckframe'] }) },
    keyshotgun: { ko: '키보드 샷건', en: 'Keyboard Smash', skin: sk({
      ...DARK, bg: '#1a1626', floor: ['#2e2840', '#29233a'], grain: '#3a3350', wallL: '#332c48', wallR: '#3b3354', wallTop: '#b6ff5c',
      deskTop: '#4a4266', deskL: '#3a3452', deskR: '#2e2942', on: ['#b6ff5c', '#ff4fd8', '#39f3ff'], pat: '#ff4fd8', pot: '#3a3452', sky: '#201a3a',
      frame: '#b6ff5c', shelf: '#3a3452', books: ['#b6ff5c', '#ff4fd8', '#39f3ff'], scene: ['mm-keyfloor', 'mm-keytrophy'] }) },
    mondayblues: { ko: '월요병 방', en: 'Monday Blues Room', skin: sk({
      bg: '#dfe4ea', floor: ['#b9c0ca', '#b2b9c3'], grain: '#a3abb6', wallL: '#c9d0da', wallR: '#d3d9e2', wallTop: '#5f6b80',
      deskTop: '#9aa3b2', deskL: '#838c9b', deskR: '#6f7887', line: '#1f242c', pets: ['#d8d0c4', '#c4ccd6', '#c9d4c4', '#d6c8cf', '#cfd6e0'],
      pat: '#5f6b80', leaf: ['#7a8a80', '#5f6e66'], pot: '#838c9b', sky: '#9aa6b8', frame: '#5f6b80', shelf: '#838c9b', books: ['#7a8496', '#9aa3b2', '#5f6b80'],
      weather: 'rain', scene: ['mm-droopcal', 'mm-raincloud'] }) },
    cameraoff: { ko: '카메라 끈 화상회의', en: 'Cameras-Off Call', skin: sk({
      ...DARK, bg: '#1e222b', floor: ['#3a3f4a', '#353a44'], grain: '#454b57', wallL: '#3a404c', wallR: '#434a57', wallTop: '#7fd1ff',
      deskTop: '#565d6b', deskL: '#454b57', deskR: '#383d48', pat: '#7fd1ff', pot: '#454b57', sky: '#2a3040', frame: '#565d6b', shelf: '#454b57',
      books: ['#7fd1ff', '#7cf08a', '#e5484d'], scene: ['mm-callgrid', 'mm-muted'] }) },
    worksonmine: { ko: '내 컴에선 되는데', en: 'Works on My Machine', skin: sk({
      bg: '#f3f1ea', floor: ['#d9d3c4', '#d2ccbc'], grain: '#c2bba9', wallL: '#ece6d6', wallR: '#f4efe2', wallTop: '#7a6a4a',
      deskTop: '#c9b48d', deskL: '#a98f68', deskR: '#8d7552', pat: '#7cf08a', frame: '#7a6a4a', books: ['#7cf08a', '#e5484d', '#c9b48d'],
      scene: ['mm-okpc', 'mm-prodfail'] }) },
    nightstore: { ko: '야근 편의점', en: 'Late-Night Corner Store', skin: sk({
      bg: '#141a2e', floor: ['#e9edf2', '#dfe4ea'], grain: '#cfd5dd', wallL: '#cfe3f0', wallR: '#dcecf7', wallTop: '#2f9a6a',
      deskTop: '#f4f6f8', deskL: '#c9d0d8', deskR: '#b3bcc6', line: '#1a2230', pat: '#2f9a6a', pot: '#c9d0d8', sky: '#1a2140', stars: true,
      frame: '#2f9a6a', shelf: '#b3bcc6', books: ['#e5484d', '#ffd23f', '#2f9a6a'], scene: ['mm-storeshelf', 'mm-fluor'] }) },
    bugjungle: { ko: '버그 사냥 정글', en: 'Bug Hunt Jungle', skin: sk({
      bg: '#dcefd2', floor: ['#5f8f3f', '#58873a'], grain: '#467330', wallL: '#4a7a43', wallR: '#548a4c', wallTop: '#2a4a22',
      deskTop: '#8d6a45', deskL: '#735638', deskR: '#5e452d', line: '#14200f', pat: '#e5484d', leaf: ['#2f9a4f', '#1f7a3a'], pot: '#735638', sky: '#b8e89a',
      frame: '#2a4a22', shelf: '#735638', books: ['#e5484d', '#ffc93c', '#7cc48a'], weather: 'leaf', scene: ['mm-vines', 'mm-bugs', 'mm-bugjar'] }) },
    tabspace: { ko: '탭 대 스페이스 전쟁', en: 'Tabs vs Spaces War', skin: sk({
      bg: '#f3f4f6', floor: ['#d8dbe0', '#d1d4da'], grain: '#c2c6cd', wallL: '#ffd9b3', wallR: '#c9eef5', wallTop: '#4a4f5a',
      deskTop: '#eef0f3', deskL: '#cfd3da', deskR: '#b9bec7', line: '#22252c', pat: '#d9602a', pot: '#cfd3da', frame: '#4a4f5a', shelf: '#b9bec7',
      books: ['#d9602a', '#2a8aa0', '#ffd27a'], scene: ['mm-tabs', 'mm-spaces'] }) },
    legacy: { ko: '레거시 코드 발굴장', en: 'Legacy Code Dig Site', skin: sk({
      bg: '#efe4cf', floor: ['#b89a6a', '#b09263'], grain: '#9a7d50', wallL: '#c9a87a', wallR: '#d6b78a', wallTop: '#6b4a2a',
      deskTop: '#8a6a4a', deskL: '#6f5238', deskR: '#5a422c', line: '#2a1a0c', pat: '#c9772f', pot: '#6f5238', sky: '#f2dcb0', frame: '#6b4a2a', shelf: '#6f5238',
      books: ['#8a6a4a', '#c9772f', '#3f6fd0'], scene: ['mm-digpit', 'mm-strata'] }) },
  },
};
