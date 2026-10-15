import { describe, expect, it } from 'vitest';
import { calmOf, capDurations, HOT_OFF, HOT_ON, stepHot, type HotState } from './animCalm';

// 2026-10-12 사용자 "부하 심해지면 애니메이션 때문에 끊긴다 — 자동으로 최소화". 기준은 1분 부하/코어(실측: CPU 사용률 합은 60~90% 에 몰려 못 가른다)
const s = (load1: number, cores = 10) => ({ load1, cores });
const run = (pts: [number, number][], from: HotState = { hot: false, since: null }) => pts.reduce((st, [t, l]) => stepHot(st, s(l), t * 1000), from);

describe('부하 자동 줄이기 — 깜빡이지 않게(히스테리시스)', () => {
  it('기준값: 코어당 8 이상이면 높음, 6 밑이면 낮음', () => {
    expect(HOT_ON).toBe(8);
    expect(HOT_OFF).toBe(6);
  });
  it('높음이 10초 이어져야 켠다 — 한 번 튄 건 무시', () => {
    expect(run([[0, 90]]).hot).toBe(false);
    expect(run([[0, 90], [5, 30]]).hot).toBe(false);
    expect(run([[0, 90], [5, 30], [10, 90]]).hot).toBe(false); // 다시 처음부터
    expect(run([[0, 90], [10, 85]]).hot).toBe(true);
  });
  it('낮음이 30초 이어져야 푼다 — 사이에 중간(6~8)이 끼면 다시', () => {
    const on: HotState = { hot: true, since: null };
    expect(run([[0, 40], [20, 40]], on).hot).toBe(true);
    expect(run([[0, 40], [30, 40]], on).hot).toBe(false);
    expect(run([[0, 40], [20, 70], [30, 40], [50, 40]], on).hot).toBe(true);
    expect(run([[0, 40], [20, 70], [30, 40], [60, 40]], on).hot).toBe(false);
  });
  it('켜진 채 중간(6~8)이면 그대로, 꺼진 채 중간이면 그대로', () => {
    expect(run([[0, 70], [60, 70]], { hot: true, since: null }).hot).toBe(true);
    expect(run([[0, 70], [60, 70]]).hot).toBe(false);
  });
  it('부하를 모르면(못 읽음·코어 0) 그대로', () => {
    const st: HotState = { hot: true, since: 5 };
    expect(stepHot(st, null, 99)).toEqual(st);
    expect(stepHot(st, { load1: 50, cores: 0 }, 99)).toEqual(st);
  });
});

describe('애니메이션 단계 — 설정·OS 동작 줄이기·부하', () => {
  it('끄기·줄이기는 그대로', () => {
    expect(calmOf('off', false, false)).toBe('off');
    expect(calmOf('reduce', false, false)).toBe('reduce');
  });
  it('자동: 평소엔 그대로, OS 동작 줄이기나 부하 높음이면 줄이기', () => {
    expect(calmOf('auto', false, false)).toBe('full');
    expect(calmOf('auto', true, false)).toBe('reduce');
    expect(calmOf('auto', false, true)).toBe('reduce');
  });
});

describe('줄이기 — 전환 길이 자르기(0.1초 넘는 것만)', () => {
  it('넘는 것만 0.1초로, 나머지는 그대로', () => {
    expect(capDurations('0.3s')).toBe('0.1s');
    expect(capDurations('0.15s, 0.05s, 700ms')).toBe('0.1s, 0.05s, 0.1s');
  });
  it('바꿀 게 없으면 null — 덮개 규칙을 안 만든다', () => {
    expect(capDurations('0s')).toBeNull();
    expect(capDurations('0.1s, 80ms')).toBeNull();
    expect(capDurations('')).toBeNull();
  });
});
