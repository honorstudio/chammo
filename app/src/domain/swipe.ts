// 폰 줄 밀기 — iOS 메일처럼 오른쪽→왼쪽으로 밀면 줄 뒤 버튼이 드러난다(참모 바꾸기 시트, 2026-10-03 사용자). 계산만

/** 손가락이 slop 점 움직였을 때 정한다 — 가로가 세로의 2배를 넘어야 밀기(세로 스크롤을 막는다), 아니면 세로 스크롤에 양보.
 *  예전엔 8점·더 많이 간 쪽이라 스크롤하다 대각선으로 시작하면 줄이 밀렸다(2026-10-11 사용자 "이상하게 스와이프 되는 것도 잡힘") */
export function swipeAxis(dx: number, dy: number, slop = 10): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > 2 * Math.abs(dy) ? 'x' : 'y';
}

/** 뒤 버튼 판이 드러난 폭 — 오른쪽 판(end)은 왼쪽으로 민 만큼, 왼쪽 판(start)은 오른쪽으로 민 만큼(판 폭까지). 나머지는 잘라 내 줄 글과 안 겹친다 */
export function swipeReveal(x: number, width: number, start = 0): { end: number; start: number } {
  return { end: Math.min(width, Math.max(0, -x)), start: Math.min(start, Math.max(0, x)) };
}

/** 지금 자리 — 시작 자리(base) + 민 만큼. 왼쪽으로는 오른쪽 버튼 폭(width)까지, 오른쪽으로는 왼쪽 버튼 폭(start, 없으면 0)까지,
 *  넘으면 4분의 1 만 따라간다(끝까지 밀어도 실행 안 함) */
export function swipeX(base: number, dx: number, width: number, start = 0): number {
  const v = base + dx;
  if (v < -width) return -width + (v + width) / 4;
  if (v > start) return start ? start + (v - start) / 4 : 0;
  return v;
}

/** 놓았을 때 — 3분의 1 넘게 밀렸으면 그쪽 버튼을 연다(-width / start), 아니면 닫는다(0) */
export const swipeSettle = (x: number, width: number, start = 0) => (x < -width / 3 ? -width : start && x > start / 3 ? start : 0);
