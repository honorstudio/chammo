import { describe, expect, it } from 'vitest';
import { applyOrder, moveTo, resizeTracks, tracksFor } from './gridSizing';

describe('tracksFor — 저장된 크기가 지금 칸 수와 맞을 때만 쓴다', () => {
  it('없으면 균등', () => expect(tracksFor(undefined, 3)).toEqual([1, 1, 1]));
  it('칸 수가 바뀌었으면 균등으로 다시', () => expect(tracksFor([2, 1], 3)).toEqual([1, 1, 1]));
  it('맞으면 그대로', () => expect(tracksFor([2, 1, 1], 3)).toEqual([2, 1, 1]));
});

describe('resizeTracks — 경계선 i(왼쪽 칸 i-1 · 오른쪽 칸 i)를 끌 때', () => {
  it('끈 비율만큼 왼쪽이 커지고 오른쪽이 작아진다 (합은 그대로)', () => {
    // 칸 [1,1] 전체 너비 대비 +0.25 만큼 오른쪽으로 → [1.5, 0.5]
    expect(resizeTracks([1, 1], 1, 0.25)).toEqual([1.5, 0.5]);
  });

  it('다른 칸은 건드리지 않는다', () => {
    // 합 3 · 전체 너비의 -1/6 = -0.5fr → 가운데 칸 -0.5, 오른쪽 칸 +0.5
    expect(resizeTracks([1, 1, 1], 2, -1 / 6)).toEqual([1, 0.5, 1.5]);
  });

  it('한 칸이 전체의 10% 밑으로는 안 줄어든다', () => {
    const r = resizeTracks([1, 1], 1, 0.9);
    expect(r[1]! / (r[0]! + r[1]!)).toBeCloseTo(0.1);
    expect(r[0]! + r[1]!).toBeCloseTo(2);
  });
});

describe('applyOrder — 사용자가 끌어 놓은 순서', () => {
  it('저장된 순서를 먼저, 새로 생긴 세션은 뒤에', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
  });
  it('사라진 세션은 무시', () => {
    expect(applyOrder(['a', 'b'], ['zz', 'b'])).toEqual(['b', 'a']);
  });
  it('저장된 게 없으면 원래 순서', () => {
    expect(applyOrder(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });
});

describe('moveTo — 끌어서 다른 창 자리에 놓기', () => {
  it('뒤로: a 를 c 자리에 → b c a', () => expect(moveTo(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']));
  it('앞으로: c 를 a 자리에 → c a b', () => expect(moveTo(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']));
  it('자기 자리면 그대로', () => expect(moveTo(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']));
  it('없는 id 면 그대로', () => expect(moveTo(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']));
});
