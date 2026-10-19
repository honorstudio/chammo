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
