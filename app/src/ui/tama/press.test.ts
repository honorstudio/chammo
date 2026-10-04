import { describe, expect, it } from 'vitest';
import { DRAG_PX, pressDown, pressMove } from './press';

describe('위젯 누르기 — 5px 넘게 움직이면 끌기, 아니면 클릭', () => {
  it('5px 안에서 움직이면 끌기를 시작하지 않는다', () => {
    const p = pressDown(100, 100);
    const r = pressMove(p, 103, 104);
    expect(r.startDrag).toBe(false);
    expect(r.press?.dragged).toBe(false);
  });

  it('5px 를 넘으면 한 번만 끌기를 시작하고, 그 누르기는 클릭으로 안 친다', () => {
    const p = pressDown(100, 100);
    const a = pressMove(p, 100 + DRAG_PX + 1, 100);
    expect(a.startDrag).toBe(true);
    expect(a.press?.dragged).toBe(true);
    const b = pressMove(a.press, 140, 100);
    expect(b.startDrag).toBe(false);
  });

  it('누르지 않은 채 움직이면 아무 일도 없다', () => {
    expect(pressMove(null, 300, 300)).toEqual({ press: null, startDrag: false });
  });
});
