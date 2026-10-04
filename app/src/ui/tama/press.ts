// 위젯 누르기 판정 — 테두리 없는 창이라 끌기를 직접 시작한다. 위젯 어디를 잡아도 옮겨지게, 5px 넘게 움직였을 때만 끌기(그 전엔 클릭)
export const DRAG_PX = 5;

export type Press = { x: number; y: number; dragged: boolean } | null;

export const pressDown = (x: number, y: number): Press => ({ x, y, dragged: false });

/** 눌린 채 움직임 — 처음 5px 를 넘는 순간 한 번만 startDrag */
export function pressMove(p: Press, x: number, y: number): { press: Press; startDrag: boolean } {
  if (!p || p.dragged) return { press: p, startDrag: false };
  if (Math.hypot(x - p.x, y - p.y) <= DRAG_PX) return { press: p, startDrag: false };
  return { press: { ...p, dragged: true }, startDrag: true };
}
