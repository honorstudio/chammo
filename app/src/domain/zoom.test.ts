import { describe, expect, it } from 'vitest';
import { clampPan, fitContain, maxZoom, needOriginal, pinchScale, realScale, tapZoom, zoomAt, ZOOM_MAX, longFit, clampIn } from './zoom';

describe('pinchScale — 두 손가락 사이가 벌어진 만큼(1~최대)', () => {
  it('벌어진 비율대로, 1 아래·최대 위로는 안 간다', () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 50)).toBe(1);
    expect(pinchScale(1, 100, 50)).toBe(1);
    expect(pinchScale(3, 100, 1000)).toBe(ZOOM_MAX);
    expect(pinchScale(2, 0, 100)).toBe(2);
  });
});

describe('clampPan — 확대한 그림이 칸 밖으로 안 빠지게', () => {
  it('확대 안 했으면 늘 가운데', () => {
    expect(clampPan(30, -20, 1, 300, 200)).toEqual({ x: 0, y: 0 });
  });
  it('2배면 칸 크기의 반까지만', () => {
    expect(clampPan(500, -500, 2, 300, 200)).toEqual({ x: 150, y: -100 });
    expect(clampPan(40, 10, 2, 300, 200)).toEqual({ x: 40, y: 10 });
  });
});

describe('tapZoom — 두 번 톡 치면 2.5배 ↔ 원래대로', () => {
  it('토글', () => {
    expect(tapZoom(1)).toBe(2.5);
    expect(tapZoom(2.5)).toBe(1);
    expect(tapZoom(1.2)).toBe(1);
  });
});

describe('그림 보기(2026-10-03 사용자 v1.png "작은 칸에 흐리게")', () => {
  it('fitContain — 화면 안에 전체가 보이게(가로·세로 중 꽉 차는 쪽)', () => {
    expect(fitContain(1800, 1500, 390, 760)).toEqual({ w: 390, h: 325 });
    expect(fitContain(1170, 12000, 390, 760)).toEqual({ w: 74, h: 760 });
  });
  it('realScale — 그림 한 점이 화면 한 점이 되는 배율(작은 그림은 2.5배)', () => {
    expect(realScale(1800, 390, 3)).toBeCloseTo(1800 / 1170);
    expect(realScale(4032, 390, 3)).toBeCloseTo(4032 / 1170);
    expect(realScale(300, 390, 3)).toBe(2.5);
  });
  it('maxZoom — 실제 크기의 2배까지(적어도 4배)', () => {
    expect(maxZoom(4032, 390, 3)).toBeCloseTo((4032 / 1170) * 2);
    expect(maxZoom(1800, 390, 3)).toBe(4);
  });
  it('zoomAt — 누른 곳(칸 가운데 기준 좌표)이 그 자리에 남게', () => {
    // 가운데에서 오른쪽 100 을 2배로 → 그 점이 그대로 있으려면 왼쪽으로 100
    expect(zoomAt({ s: 1, x: 0, y: 0 }, 2, 100, 0)).toEqual({ s: 2, x: -100, y: 0 });
    expect(zoomAt({ s: 2, x: -100, y: 0 }, 1, 100, 0)).toEqual({ s: 1, x: 0, y: 0 });
  });
  it('needOriginal — 받은 보기용보다 더 크게 보이면 원본을 받는다', () => {
    // 보기용 2560 을 받았고 원본 4032, 화면 맞춤 390pt·3배 화면
    expect(needOriginal(2, 390, 3, 2560, 4032)).toBe(false); // 2340 < 2560
    expect(needOriginal(2.5, 390, 3, 2560, 4032)).toBe(true); // 2925 > 2560
    expect(needOriginal(5, 390, 3, 4032, 4032)).toBe(false); // 이미 원본
  });
});

describe('긴 캡처 — 세로로 긴 건 가로 맞춤, 가로로 긴 건 세로 맞춤(2026-10-03 전략 표 7번)', () => {
  it('longFit: 2.5배 넘게 길면 그 방향 맞춤 배율과 처음 자리(위·왼쪽 끝), 아니면 null', () => {
    // 1170×12000 캡처, 칸 390×700 → contain 68×700 → 가로 맞춤 배율 390/68
    const f = fitContain(1170, 12000, 390, 700);
    const t = longFit(1170, 12000, 390, 700)!;
    expect(t.s).toBeCloseTo(390 / f.w, 3);
    expect(t.y).toBeCloseTo((f.h * t.s - 700) / 2, 3); // 맨 위가 보이게
    expect(t.x).toBe(0);
    const w = longFit(12000, 1170, 390, 700)!;
    const fw = fitContain(12000, 1170, 390, 700);
    expect(w.s).toBeCloseTo(700 / fw.h, 3);
    expect(w.x).toBeCloseTo((fw.w * w.s - 390) / 2, 3); // 맨 왼쪽
    expect(longFit(1800, 1500, 390, 700)).toBeNull();
    expect(longFit(1170, 2532, 390, 700)).toBeNull(); // 폰 화면 한 장(2.16배)은 보통 그림
  });
  it('clampIn: 칸보다 큰 만큼만 끌린다(검은 여백이 안 보이게)', () => {
    // 그려진 390×4000(맞춤 68×700 의 5.7배) — 가로는 못 끌고 세로는 (4000-700)/2 까지
    const s = 390 / 68;
    expect(clampIn(50, 99999, s, 68, 700, 390, 700)).toEqual({ x: 0, y: (700 * s - 700) / 2 });
    expect(clampIn(0, -99999, s, 68, 700, 390, 700).y).toBeCloseTo(-(700 * s - 700) / 2, 6);
  });
});
