// 키즈 화면 생김새(시안 docs/design-drafts/kids-mode/screen-v3 · kids3_kid.py) — 키즈 참모 = 그 참모의 원래 도형·눈·색 + 볼·입·손,
// 매트 색은 참모 색과 초록 매트의 색차(CIEDE2000)가 20 밑이면 남색(WCAG 대비비는 밝기만 봐서 못 가른다)
import { defaultAvatar, EYES, orchColor, SHAPES, type Eyes, type Shape } from './avatar';

export const GREEN_MAT = '#3e8e6b';
export const NAVY_MAT = '#2b3560';
const DE_MIN = 20;

const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function lab(h: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16))) as [number, number, number];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 색차 — 시안 생성기(kids3_kid.de2000)를 그대로 옮김 */
export function de2000(c1: string, c2: string): number {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360, h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dL = L2 - L1, dC = C2p - C1p;
  const d = h2p - h1p;
  const dh = C1p * C2p === 0 ? 0 : d > 180 ? d - 360 : d < -180 ? d + 360 : d;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  const hb = C1p * C2p === 0 ? h1p + h2p : Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb)) + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.2 * Math.cos(rad(4 * hb - 63));
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export const matFor = (color: string) => (de2000(color, GREEN_MAT) < DE_MIN ? NAVY_MAT : GREEN_MAT);

export type KidLook = { shape: Shape; eyes: Eyes; color: string; mat: string };

/** 서버가 준 프사(avatar json 그대로) → 아이 화면 생김새. 그림 프사·이상한 값이면 그 참모 기본형 */
export function kidLook(key: string, raw: unknown): KidLook {
  const d = defaultAvatar(key);
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = o.kind === 'preset' && (SHAPES as readonly string[]).includes(String(o.shape)) && (EYES as readonly string[]).includes(String(o.eyes));
  const shape = preset ? (o.shape as Shape) : d.shape;
  const eyes = preset ? (o.eyes as Eyes) : d.eyes;
  const color = preset && typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : orchColor(key);
  return { shape, eyes, color, mat: matFor(color) };
}

export type PadRow = { ts: number; who: string; text: string };

/** 보낸 때(after) 뒤에 온 마지막 아이 화면 답 */
export function pickReply(rows: PadRow[], after: number): PadRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.who === 'assistant') return r.ts > after ? r : null;
  }
  return null;
}
