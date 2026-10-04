// 폰 화면 확대 — 페이지 전체 확대는 막고(앱처럼), 그림 보기 같은 칸 안에서만 핀치로 확대(ui/mobile/ZoomBox). 계산만
export const ZOOM_MAX = 5;

/** 두 손가락 거리 d0 → d1 이면 base 배율에서 그 비율만큼(1~ZOOM_MAX) */
export function pinchScale(base: number, d0: number, d1: number): number {
  if (d0 <= 0) return base;
  return Math.min(ZOOM_MAX, Math.max(1, (base * d1) / d0));
}

/** 끌어 옮긴 자리 — 확대한 만큼만(칸 밖 빈 곳이 안 보이게). 1배면 가운데 */
export function clampPan(x: number, y: number, scale: number, w: number, h: number): { x: number; y: number } {
  const mx = ((scale - 1) * w) / 2;
  const my = ((scale - 1) * h) / 2;
  return { x: Math.min(mx, Math.max(-mx, x)) || 0, y: Math.min(my, Math.max(-my, y)) || 0 };
}

/** 두 번 톡 — 확대 안 했으면 2.5배, 했으면 원래대로 */
export const tapZoom = (scale: number) => (scale > 1.05 ? 1 : 2.5);

/** 처음 맞춤 — 그림 전체가 화면(vw×vh) 안에 보이게. 가로·세로 중 먼저 꽉 차는 쪽에 맞춘다(contain) */
export function fitContain(iw: number, ih: number, vw: number, vh: number): { w: number; h: number } {
  const k = Math.min(vw / iw, vh / ih);
  return { w: Math.round(iw * k), h: Math.round(ih * k) };
}

/** 실제 크기(1:1) — 그림 한 점이 화면 한 점(물리 점)이 되는 배율. 맞춤보다 1.5배도 안 크면(작은 그림) 2.5배 */
export function realScale(origW: number, fitW: number, dpr: number): number {
  const s = origW / (fitW * dpr);
  return s < 1.5 ? 2.5 : s;
}

/** 키울 수 있는 끝 — 실제 크기의 2배, 적어도 4배 */
export const maxZoom = (origW: number, fitW: number, dpr: number) => Math.max(4, (origW / (fitW * dpr)) * 2);

/** 배율을 바꿀 때 누른 점(칸 가운데 기준 px, py)이 그 자리에 남도록 옮긴 자리 */
export function zoomAt(v: { s: number; x: number; y: number }, s: number, px: number, py: number): { s: number; x: number; y: number } {
  const k = s / v.s;
  return { s, x: px - (px - v.x) * k || 0, y: py - (py - v.y) * k || 0 };
}

/** 받은 그림(servedW)보다 크게 보이면 원본을 받을 때 — 이미 원본이면 아니오 */
export const needOriginal = (scale: number, fitW: number, dpr: number, servedW: number, origW: number) =>
  servedW < origW && scale * fitW * dpr > servedW * 1.05;

/** 끌어 옮긴 자리 — 그려진 크기(맞춤 fw×fh 의 s 배)가 칸(bw×bh)보다 큰 만큼만. 그림은 칸 가운데 기준 */
export function clampIn(x: number, y: number, s: number, fw: number, fh: number, bw: number, bh: number): { x: number; y: number } {
  const mx = Math.max(0, (fw * s - bw) / 2);
  const my = Math.max(0, (fh * s - bh) / 2);
  return { x: Math.min(mx, Math.max(-mx, x)) || 0, y: Math.min(my, Math.max(-my, y)) || 0 };
}

/** 긴 캡처 — 긴 변이 짧은 변의 2.5배 넘으면 처음부터 짧은 쪽을 칸에 맞춘 배율(contain 기준)과 시작 자리(맨 위·맨 왼쪽).
 *  전체(contain)로 보면 글씨가 점이 된다. 보통 그림이면 null */
export function longFit(iw: number, ih: number, bw: number, bh: number): { s: number; x: number; y: number } | null {
  if (Math.max(iw, ih) / Math.min(iw, ih) <= 2.5) return null;
  const f = fitContain(iw, ih, bw, bh);
  if (ih > iw) {
    const s = bw / f.w;
    return { s, x: 0, y: Math.max(0, (f.h * s - bh) / 2) };
  }
  const s = bh / f.h;
  return { s, x: Math.max(0, (f.w * s - bw) / 2), y: 0 };
}
