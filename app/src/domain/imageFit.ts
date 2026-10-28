import { FIT, IMAGE_STEPS } from './readerZoom';

// 그림 맞춤 배율(2026-10-28 사용자 "이미지 확대가 안 된다잉") — 맞춤은 '칸 안에 통째로'라서 작은 그림(레티나 캡처)은 칸에 맞게 키우고 큰 그림은 줄인다.
// 단위는 리더와 같다: 100% = 실제 픽셀(naturalWidth / devicePixelRatio, css 점)
export const FIT_MAX = 400; // 단계 표의 맨 위 — 도장만 한 그림을 칸만큼 키워 깨 놓지 않는다

type Size = { w: number; h: number };
const ok = (n: number) => Number.isFinite(n) && n > 0;

/** 칸(box)에 통째로 들어가는 배율(%) — 내림해서 칸을 안 넘긴다. 크기를 아직 모르면 0 */
export function fitPercent(box: Size, natural: Size): number {
  if (!ok(box.w) || !ok(box.h) || !ok(natural.w) || !ok(natural.h)) return 0;
  const p = Math.floor(Math.min(box.w / natural.w, box.h / natural.h) * 1000) / 10;
  return Math.min(FIT_MAX, Math.max(IMAGE_STEPS[0]!, p));
}

/** 지금 보이는 배율 — 맞춤이면 맞춤 배율(모르면 100), 아니면 고른 배율 */
export const shownPercent = (z: number, fit: number): number => (z !== FIT ? z : fit > 0 ? fit : 100);

/** 그림 폭(px). 폭을 정할 수 없으면(자연 폭·맞춤 배율을 모름) undefined — 그린 쪽이 CSS 맞춤으로 둔다 */
export function imageWidth(natural: number, z: number, fit: number): number | undefined {
  if (!ok(natural)) return undefined;
  if (z === FIT && !(fit > 0)) return undefined;
  return (natural * shownPercent(z, fit)) / 100;
}

/** 두 번 누르기 — 맞춤이면 100%, 아니면 맞춤. 맞춤이 이미 100%쯤이면 변화가 없어 200% 로 */
export function toggleFitActual(z: number, fit: number): number {
  if (z !== FIT) return FIT;
  return Math.abs(fit - 100) <= 2 ? 200 : 100;
}

/** 끌어서 이동 — 시작할 때 손·스크롤 자리와 지금 손 자리 → 새 스크롤(손이 가는 반대로) */
export function dragScroll(from: { x: number; y: number; left: number; top: number }, now: { x: number; y: number }): { left: number; top: number } {
  return { left: Math.max(0, from.left - (now.x - from.x)), top: Math.max(0, from.top - (now.y - from.y)) };
}
