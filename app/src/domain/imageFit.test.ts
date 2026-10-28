import { describe, expect, it } from 'vitest';
import { FIT } from './readerZoom';
import { dragScroll, FIT_MAX, fitPercent, imageWidth, shownPercent, toggleFitActual } from './imageFit';

// 2026-10-28 사용자 "이미지 확대가 안 된다잉" — 작은 그림(레티나 캡처)이 맞춤에서 원래 크기로만 떠 있었다
describe('맞춤 배율 — 칸에 맞게 키우거나 줄인다', () => {
  it('작은 그림(레티나 732x828 캡처 = 366x414 css 점)은 칸에 맞게 커진다', () => {
    const p = fitPercent({ w: 1304, h: 1568 }, { w: 366, h: 414 });
    expect(p).toBeGreaterThan(300); // 가로 기준 356%
    expect(p).toBeLessThanOrEqual(FIT_MAX);
  });
  it('칸보다 큰 그림은 줄어든다 — 긴 변이 아니라 더 빡빡한 쪽에 맞춘다', () => {
    expect(fitPercent({ w: 1000, h: 1000 }, { w: 2000, h: 1000 })).toBe(50);
    expect(fitPercent({ w: 1000, h: 500 }, { w: 1000, h: 2000 })).toBe(25);
  });
  it('아주 작은 그림은 FIT_MAX 에서 멈춘다(도장처럼 깨지지 않게)', () => {
    expect(fitPercent({ w: 1000, h: 1000 }, { w: 20, h: 20 })).toBe(FIT_MAX);
  });
  it('아주 큰 그림도 가장 작은 단계(10%) 밑으로는 안 내려간다', () => {
    expect(fitPercent({ w: 300, h: 300 }, { w: 30000, h: 30000 })).toBe(10);
  });
  it('내림 — 소수가 남아도 칸을 넘지 않는다', () => {
    const p = fitPercent({ w: 1000, h: 1000 }, { w: 3, h: 3 });
    expect(p).toBe(FIT_MAX);
    const q = fitPercent({ w: 1000, h: 1000 }, { w: 7, h: 7 }); // 14285.7% → 상한
    expect(q).toBe(FIT_MAX);
    const r = fitPercent({ w: 1001, h: 1001 }, { w: 300, h: 300 }); // 333.67…
    expect(r * 300 / 100).toBeLessThanOrEqual(1001);
  });
  it('칸·그림 크기를 아직 모르면 0 — 호출한 쪽이 옛 CSS 로 그린다', () => {
    expect(fitPercent({ w: 0, h: 0 }, { w: 100, h: 100 })).toBe(0);
    expect(fitPercent({ w: 500, h: 500 }, { w: 0, h: 0 })).toBe(0);
    expect(fitPercent({ w: NaN, h: 500 }, { w: 10, h: 10 })).toBe(0);
  });
});

describe('지금 보이는 배율·그림 폭', () => {
  it('맞춤이면 맞춤 배율, 아니면 고른 배율', () => {
    expect(shownPercent(FIT, 356)).toBe(356);
    expect(shownPercent(150, 356)).toBe(150);
    expect(shownPercent(FIT, 0)).toBe(100); // 맞춤을 아직 모르면 100 으로 짐작
  });
  it('폭(px) = 자연 폭 × 배율 — 맞춤인데 아직 모르면 undefined(CSS 가 그린다)', () => {
    expect(imageWidth(366, 200, 356)).toBe(732);
    expect(imageWidth(366, FIT, 356)).toBeCloseTo(1302.96, 1);
    expect(imageWidth(366, FIT, 0)).toBeUndefined();
    expect(imageWidth(0, 200, 356)).toBeUndefined();
  });
});

describe('두 번 누르기 — 맞춤 ↔ 100%', () => {
  it('맞춤 → 100%, 그 밖 → 맞춤', () => {
    expect(toggleFitActual(FIT, 356)).toBe(100);
    expect(toggleFitActual(100, 356)).toBe(FIT);
    expect(toggleFitActual(250, 356)).toBe(FIT);
  });
  it('맞춤이 이미 100%쯤이면 200% 로 — 눌렀는데 아무 변화가 없으면 안 된다', () => {
    expect(toggleFitActual(FIT, 100)).toBe(200);
    expect(toggleFitActual(FIT, 101.5)).toBe(200);
    expect(toggleFitActual(FIT, 103)).toBe(100);
  });
});

describe('끌어서 이동', () => {
  it('손을 오른쪽·아래로 끌면 칸은 반대(왼쪽·위)로 스크롤된다', () => {
    expect(dragScroll({ x: 100, y: 100, left: 50, top: 80 }, { x: 130, y: 90 })).toEqual({ left: 20, top: 90 });
  });
  it('음수는 0 으로(칸 끝은 브라우저가 자르지만 값은 정직하게)', () => {
    expect(dragScroll({ x: 0, y: 0, left: 10, top: 10 }, { x: 50, y: 50 })).toEqual({ left: 0, top: 0 });
  });
});
