import { describe, expect, it } from 'vitest';
import { swipeAxis, swipeSettle, swipeX } from './swipe';

describe('줄 밀기(iOS 메일처럼) — 오른쪽→왼쪽이면 뒤 버튼이 드러난다(2026-10-03 사용자)', () => {
  it('방향 잠금: 8점 움직이기 전엔 모름, 그 뒤 더 많이 간 쪽', () => {
    expect(swipeAxis(5, 3)).toBeNull();
    expect(swipeAxis(-20, 6)).toBe('x');
    expect(swipeAxis(4, 20)).toBe('y');
  });
  it('왼쪽으로만, 버튼 폭 넘으면 고무줄(끝까지 밀어도 실행 안 하고 버튼만)', () => {
    expect(swipeX(0, 30, 168)).toBe(0);
    expect(swipeX(0, -100, 168)).toBe(-100);
    expect(swipeX(0, -268, 168)).toBe(-168 - 25);
    expect(swipeX(-168, 50, 168)).toBe(-118);
  });
  it('놓으면 3분의 1 넘게 밀렸으면 열고, 아니면 닫는다', () => {
    expect(swipeSettle(-60, 168)).toBe(-168);
    expect(swipeSettle(-50, 168)).toBe(0);
    expect(swipeSettle(-400, 168)).toBe(-168);
  });
});

describe('반대로 밀기(왼쪽→오른쪽) — 왼쪽 버튼(고정)', () => {
  it('왼쪽 버튼 폭(start)만큼 오른쪽으로, 넘으면 고무줄', () => {
    expect(swipeX(0, 40, 168, 72)).toBe(40);
    expect(swipeX(0, 172, 168, 72)).toBe(72 + 25);
    expect(swipeX(0, -100, 168, 72)).toBe(-100);
    expect(swipeX(72, -30, 168, 72)).toBe(42);
  });
  it('놓으면 3분의 1 넘게 오른쪽이면 왼쪽 버튼 열림', () => {
    expect(swipeSettle(30, 168, 72)).toBe(72);
    expect(swipeSettle(20, 168, 72)).toBe(0);
    expect(swipeSettle(-60, 168, 72)).toBe(-168);
  });
});
