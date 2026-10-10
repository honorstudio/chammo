// LCD 도트 화면 — 시안 v2 엔진(docs/design-drafts/tamagotchi/body/lcd_engine.js)을 옮긴 것.
// 질감은 확정안 L-4(화소 틈 + 꺼진 화소 비침 + 그림자), 색은 연두(라이트)·검정 바탕 초록(다크)
import type { Lamp, SceneName } from '../../domain/tama/scene';
import type { Egg, Slot } from '../../domain/tama/tree';
import { SPR } from './sprites';

export const W = 40;
export const H = 36;
const AREA_Y = 8;   // 가운데 놀이 칸: 위아래 아이콘 줄 사이 40×20
export const AREA_H = 20;

type Cell = { w: number; h: number; at: (x: number, y: number) => 0 | 1 | 2 };
const CACHE = new Map<string, Cell>();

/** 눈만 지운 변형 — 전용 그림이 없는 종의 눈 깜빡임·잠 */
function eyesShut(name: string): string {
  const key = `${name}~shut`;
  if (!SPR[key]) SPR[key] = (SPR[name] ?? []).map((r) => r.replace(/e/g, '.'));
  return key;
}

function prep(name: string): Cell {
  const hit = CACHE.get(name);
  if (hit) return hit;
  const rows = SPR[name] ?? SPR.egg!;
  const h = rows.length, w = rows[0]!.length;
  const out = new Set<number>();
  const st: [number, number][] = [];
  for (let y = 0; y < h; y++) st.push([y, 0], [y, w - 1]);
  for (let x = 0; x < w; x++) st.push([0, x], [h - 1, x]);
  while (st.length) {
    const [y, x] = st.pop()!;
    if (y < 0 || x < 0 || y >= h || x >= w || out.has(y * w + x) || rows[y]![x] !== '.') continue;
    out.add(y * w + x);
    st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  const cell: Cell = { w, h, at: (x, y) => (rows[y]![x] !== '.' ? 2 : out.has(y * w + x) ? 0 : 1) };
  CACHE.set(name, cell);
  return cell;
}

/** 한 프레임 = W*H 칸. 0 비움 · 1 몸통 · 2 켜짐 · 3 흐리게 켜짐(꺼진 표시등) */
function frame() {
  const buf = new Uint8Array(W * H);
  const put = (name: string, ox: number, oy: number, o: { dim?: boolean; rot?: boolean } = {}) => {
    const s = prep(name);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const v = o.rot ? s.at(y, s.h - 1 - x) : s.at(x, y);
      const X = ox + x, Y = oy + y;
      if (!v || X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const i = Y * W + X;
      if (o.dim) { if (v === 2 && buf[i]! < 2) buf[i] = 3; continue; }
      if (buf[i] !== 2) buf[i] = Math.max(buf[i] === 3 ? 0 : buf[i]!, v);
    }
  };
  const invert = () => { for (let i = AREA_Y * W; i < (AREA_Y + AREA_H) * W; i++) buf[i] = buf[i] === 2 ? 0 : 2; };
  return { buf, put, invert };
}

const tri = (t: number, n: number) => { const p = t % (2 * n); return p < n ? p : 2 * n - p; };

/** 계열·자리마다 전용 그림(시안 v4·v5). 망치곰만 표정 변형(먹기·웃음·아픔)이 있는 bear 를 쓴다 */
export const spriteOf = (egg: Egg, slot: Slot): string =>
  egg === 'fire' && slot === 'r1' ? 'bear' : slot === 'jA' || slot === 'jB' ? `fuse_${slot}` : `${egg}_${slot}`;

const face = (who: string, kind: 'blink' | 'eat' | 'happy' | 'sick') =>
  who === 'bear' ? `bear_${kind}` : kind === 'blink' ? eyesShut(who) : who;

export type Stage = { scene: SceneName; lit: Lamp[]; who: string; prev?: string; petAt?: number; /** 마주 선 장애 몬스터 그림(mon_*) */ foe?: string };

const ICONS: [Lamp, string][] = [['food', 'i_food'], ['light', 'i_light'], ['play', 'i_play'], ['med', 'i_med'], ['clean', 'i_clean'], ['stat', 'i_stat'], ['train', 'i_train'], ['call', 'i_call']];

function paint(st: Stage, t: number) {
  const f = frame();
  const petting = st.petAt !== undefined && t - st.petAt < 5 && !['dead', 'pick'].includes(st.scene);
  ICONS.forEach(([lamp, name], i) => {
    const on = (st.lit.includes(lamp) || (lamp === 'play' && petting)) && (lamp !== 'call' || t % 2 === 1);
    f.put(name, 1 + (i % 4) * 10, i < 4 ? 0 : H - 7, { dim: !on });
  });
  const put = (n: string, x: number, y: number, o?: { rot?: boolean }) => f.put(n, x, y + AREA_Y, o);
  const floor = AREA_H - 16, who = st.who;
  if (petting) {
    put(face(who, 'happy'), 12, floor - (t % 2));
    put('heart', 30, 2 - (t % 2));
    return f.buf;
  }
  switch (st.scene) {
    case 'pick': put('egg', 12 + (t % 2 ? 1 : -1), floor); break;
    case 'dead': put('grave', 12, floor); put('ghost', 30, Math.max(0, 12 - (t % 14))); break;
    case 'evolve': put(t % 2 && st.prev ? st.prev : who, 12, floor); if (t % 3 === 0) f.invert(); break;
    case 'sick': put(face(who, 'sick'), 10 + (t % 2), floor); if (t % 2) put('skull', 31, 1); break;
    case 'monster': {
      // 펫은 왼쪽에서 통통, 몬스터는 오른쪽에서 꿈틀 — 겁주지 않게 가끔 펫이 깜빡
      put(t % 7 === 0 ? face(who, 'blink') : who, 1 + (t % 2), floor - (t % 2));
      put(st.foe ?? 'mon_slime', 23 - (t % 3 === 0 ? 1 : 0), floor - (t % 4 === 1 ? 1 : 0));
      break;
    }
    case 'eat': {
      put(t % 2 ? face(who, 'eat') : who, 6, floor);
      put(['rice', 'rice2', 'rice3'][Math.floor((t % 6) / 2)]!, 26, AREA_H - 6);
      break;
    }
    case 'sleep': {
      put(face(who, 'blink'), 4, floor);
      const p = t % 6;
      put('z', 20 + p, Math.max(0, 11 - p * 2));
      if (p > 2) put('Z', 31, Math.max(0, 9 - (p - 3) * 3));
      break;
    }
    case 'poop': {
      put(t % 9 === 0 ? face(who, 'blink') : who, tri(t, 8), floor - (t % 2));
      put('poop', 28, AREA_H - 6);
      put(t % 2 ? 'steam1' : 'steam2', 30, AREA_H - 10);
      break;
    }
    default: put(t % 9 === 0 ? face(who, 'blink') : who, tri(t, W - 16), floor - (t % 2));
  }
  return f.buf;
}

const PAL = {
  light: { bg: '#c3cf9f', ink: '#1e2a18' },
  dark: { bg: '#101b13', ink: '#a6e98f' },
};

/** L-4: 화소 틈 0.2 · 꺼진 화소 0.07 · 그림자 0.2. area = 아이콘 줄 없이 가운데 놀이 칸만(상단 바의 작은 화면) */
export function draw(canvas: HTMLCanvasElement, st: Stage, t: number, theme: 'light' | 'dark', area = false) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const buf = paint(st, t);
  const pal = PAL[theme];
  const dot = canvas.width / W;
  const y0 = area ? AREA_Y : 0, y1 = area ? AREA_Y + AREA_H : H;
  const s = dot * 0.8, off = dot * 0.1, sh = dot * 0.22;
  g.globalAlpha = 1;
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = pal.ink;
  g.globalAlpha = 0.07;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) g.fillRect(x * dot + off, (y - y0) * dot + off, s, s);
  g.globalAlpha = 0.2;
  for (let i = y0 * W; i < y1 * W; i++) if (buf[i] === 2) g.fillRect((i % W) * dot + off + sh, (Math.floor(i / W) - y0) * dot + off + sh, s, s);
  for (let i = y0 * W; i < y1 * W; i++) {
    if (buf[i] !== 2 && buf[i] !== 3) continue;
    g.globalAlpha = buf[i] === 3 ? 0.28 : 1;
    g.fillRect((i % W) * dot + off, (Math.floor(i / W) - y0) * dot + off, s, s);
  }
  g.globalAlpha = 1;
}

/** 표시등 칸 위치 — 스탯 아이콘을 누를 수 있게 위젯이 쓴다 */
export const iconRect = (lamp: Lamp) => {
  const i = ICONS.findIndex(([l]) => l === lamp);
  return { x: 1 + (i % 4) * 10, y: i < 4 ? 0 : H - 7, w: 7, h: 7 };
};

/** 한 마리만 작은 LCD 칸에 (도감·보관함). 그림 16칸 + 사방 1칸 여백 */
export function drawSprite(canvas: HTMLCanvasElement, name: string, theme: 'light' | 'dark') {
  const g = canvas.getContext('2d');
  if (!g) return;
  const n = 18, cell = prep(name), pal = PAL[theme], dot = canvas.width / n;
  const s = dot * 0.8, off = dot * 0.1, sh = dot * 0.22;
  g.globalAlpha = 1;
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = pal.ink;
  g.globalAlpha = 0.07;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.fillRect(x * dot + off, y * dot + off, s, s);
  const lit: [number, number][] = [];
  for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) if (cell.at(x, y) === 2) lit.push([x + 1, y + 1]);
  g.globalAlpha = 0.2;
  for (const [x, y] of lit) g.fillRect(x * dot + off + sh, y * dot + off + sh, s, s);
  g.globalAlpha = 1;
  for (const [x, y] of lit) g.fillRect(x * dot + off, y * dot + off, s, s);
}
