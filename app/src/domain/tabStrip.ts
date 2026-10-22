// 스페이스 탭 줄의 스크롤 칸 — 판단만(시험: tabStrip.test.ts), 그리기는 ui/space/TabStrip.
// 2026-10-22 사용자: 탭이 넘치면 막대가 줄을 밀고 고정 탭까지 밀려났다 → 막대 없는 칸 + 휠 + 넘친 끝 흐림 + 고른 탭 보이게

/** 넘친 쪽 — 왼쪽에 가려진 게 있나(l)·오른쪽에 있나(r). 1px 안쪽은 끝으로 본다(배율·트랙패드 소수점) */
export function tabFade(left: number, scrollW: number, clientW: number): { l: boolean; r: boolean } {
  return { l: left > 1, r: left + clientW < scrollW - 1 };
}

/** 마우스 세로 휠 → 가로로 옮길 양. 가로가 더 큰 움직임(트랙패드 가로 밀기)은 0 = 브라우저 몫. mode 1 = 줄 단위 */
export function wheelToX(dx: number, dy: number, mode = 0): number {
  if (Math.abs(dy) <= Math.abs(dx)) return 0;
  return mode === 1 ? dy * 32 : dy;
}

/** 고른 탭(칸 안 좌표 tabL~tabR)이 흐린 끝(pad)까지 비켜 보이게 하는 scrollLeft — 이미 보이면 그대로 */
export function keepInView(left: number, clientW: number, tabL: number, tabR: number, pad = 24): number {
  if (tabR + pad > left + clientW) return Math.max(0, tabR + pad - clientW);
  if (tabL - pad < left) return Math.max(0, tabL - pad);
  return left;
}
