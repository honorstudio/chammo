// 채팅 탭 끌어 옮기기 셈 — 크롬처럼 끄는 탭이 손을 따라가고 옆 탭이 비켜 주고, 놓으면 그 자리(2026-10-10 사용자).
// 맥 Tauri 창은 웹 끌기(HTML5 drag)를 창이 가져가서 pointer 사건으로 한다(교훈 lesson-mac-window). 화면 없음

/** 이만큼(px) 움직여야 끌기 — 그 전엔 클릭(탭 고르기·×)으로 둔다 */
export const DRAG_SLOP = 5;

export const dragStarted = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_SLOP;

type Rect = { left: number; width: number };

/**
 * 놓을 자리(번호) — 끄는 탭 가운데가 다른 탭 가운데를 넘은 만큼. lo·hi = 놓을 수 있는 범위(고정한 탭 경계)
 * rects 는 끌기 시작할 때 잰 자리(비켜 준 자리 말고 원래 자리)
 */
export function dropIndex(rects: Rect[], from: number, dx: number, lo = 0, hi = rects.length - 1): number {
  const me = rects[from];
  if (!me) return from;
  const c = me.left + me.width / 2 + dx;
  const n = rects.filter((r, i) => i !== from && r.left + r.width / 2 < c).length;
  return Math.max(lo, Math.min(hi, n));
}

/** i 번 탭이 비켜 줄 거리 — from 이 to 로 가는 사이에 낀 탭만, step = 끄는 탭 폭 + 틈 */
export function tabShift(i: number, from: number, to: number, step: number): number {
  if (from < to && i > from && i <= to) return -step;
  if (to < from && i >= to && i < from) return step;
  return 0;
}
