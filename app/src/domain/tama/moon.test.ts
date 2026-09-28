import { describe, expect, it } from 'vitest';
import { isFullMoonNight, moonPhase } from './moon';

describe('moonPhase — 0 = 삭(새달), 0.5 = 보름', () => {
  it('실제 보름달 시각이면 0.5 근처 (2024-09-18 02:34Z, 2024-10-17 11:26Z)', () => {
    expect(moonPhase(Date.UTC(2024, 8, 18, 2, 34))).toBeCloseTo(0.5, 1);
    expect(moonPhase(Date.UTC(2024, 9, 17, 11, 26))).toBeCloseTo(0.5, 1);
  });

  it('실제 삭 시각이면 0(또는 1) 근처 (2024-10-02 18:49Z)', () => {
    const p = moonPhase(Date.UTC(2024, 9, 2, 18, 49));
    expect(Math.min(p, 1 - p)).toBeLessThan(0.05);
  });
});

describe('isFullMoonNight — 보름 앞뒤 하루 안의 밤(18~6시)', () => {
  it('보름날 밤은 참, 같은 날 낮은 거짓, 일주일 뒤 밤도 거짓', () => {
    const full = Date.UTC(2024, 9, 17, 11, 26); // 한국 20:26
    expect(isFullMoonNight(full)).toBe(true);
    expect(isFullMoonNight(full - 8 * 3_600_000)).toBe(false); // 한국 12:26
    expect(isFullMoonNight(full + 7 * 86_400_000)).toBe(false);
  });
});
