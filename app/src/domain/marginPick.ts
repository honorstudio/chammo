// 문서 여백(글 칸 밖)에서 누르기·끌기 — 노션처럼 여백에서 긁어도 그 줄부터 글이 골라진다(11-05 사용자 "마우스 끌기가 안 된다").
// 여백 누름은 캐럿 놓기로 막혀 있어서(DocPage) 끌기가 아예 안 됐다 — 판단만 여기, DOM 은 ui/space/marginPick

export type Box = { left: number; top: number; right: number; bottom: number };

/** 여백 점 → 글 칸 안 가장 가까운 점(가장자리 1px 안쪽 — 끝 줄에 걸리게) */
export function intoBox(b: Box, x: number, y: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return { x: clamp(x, b.left + 1, b.right - 1), y: clamp(y, b.top + 1, b.bottom - 1) };
}

/** 이만큼(4px) 움직였으면 끌기(고르기), 아니면 클릭 */
export const isDrag = (x0: number, y0: number, x: number, y: number): boolean => Math.hypot(x - x0, y - y0) >= 4;

/** 그냥 누른 여백 — 마지막 블록 아래 빈 곳이면 'end'(맨 끝 캐럿, 원래 동작), 글 줄 옆이면 'near'(그 줄 가까운 자리) */
export const clickKind = (lastBottom: number, y: number): 'end' | 'near' => (y > lastBottom ? 'end' : 'near');
