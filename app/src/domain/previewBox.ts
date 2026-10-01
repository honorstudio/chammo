// 미리보기 모달 크기 — 가운데에 떠 있어서 모서리를 dx 끌면 양쪽이 같이 dx 씩 커진다(2026-09-30 사용자 "크기 조절이 가능해야함")
export type Box = { w: number; h: number };
export type Edge = 'e' | 'w' | 's' | 'n' | 'se' | 'sw' | 'ne' | 'nw';
export const MIN_BOX: Box = { w: 360, h: 240 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function resizeBox(start: Box, dx: number, dy: number, edge: Edge, room: Box): Box {
  const sx = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0;
  const sy = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
  return {
    w: Math.round(clamp(start.w + 2 * sx * dx, MIN_BOX.w, Math.max(MIN_BOX.w, room.w))),
    h: Math.round(clamp(start.h + 2 * sy * dy, MIN_BOX.h, Math.max(MIN_BOX.h, room.h))),
  };
}

export function parseBox(raw: string | null): Box | null {
  try {
    const b = raw ? (JSON.parse(raw) as Partial<Box>) : null;
    return b && typeof b.w === 'number' && typeof b.h === 'number' ? { w: b.w, h: b.h } : null;
  } catch {
    return null;
  }
}

/** 확대 전 보던 가운데(스크롤 창 view, 내용 크기 before) → 새 내용 크기 after 에서 같은 가운데가 오게 하는 스크롤 자리 */
export function keepCenter(view: { left: number; top: number; w: number; h: number }, before: Box, after: Box): { left: number; top: number } {
  const axis = (pos: number, span: number, b: number, a: number) => {
    const ratio = b > 0 ? (pos + span / 2) / b : 0.5;
    return Math.round(clamp(ratio * a - span / 2, 0, Math.max(0, a - span)));
  };
  return { left: axis(view.left, view.w, before.w, after.w), top: axis(view.top, view.h, before.h, after.h) };
}
