import { describe, expect, it } from 'vitest';
import { draftFit, pinchZoom } from './htmlFit';

describe('draftFit — 넓은 시안을 폰 폭에 맞춘 배율', () => {
  it('폭이 넘치면 줄이고, 반응형(폭 그대로)이면 1', () => {
    expect(draftFit(1440, 390)).toBeCloseTo(390 / 1440, 6);
    expect(draftFit(392, 390)).toBe(1); // 몇 점 넘침은 그대로
    expect(draftFit(0, 390)).toBe(1);
  });
});

describe('pinchZoom — 두 손가락 배율을 범위 안에서', () => {
  it('곱하고 자른다', () => {
    expect(pinchZoom(1, 2, 1, 4)).toBe(2);
    expect(pinchZoom(3, 2, 1, 4)).toBe(4);
    expect(pinchZoom(1, 0.3, 1, 4)).toBe(1);
    expect(pinchZoom(1, NaN, 1, 4)).toBe(1);
  });
});
