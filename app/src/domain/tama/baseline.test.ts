import { describe, expect, it } from 'vitest';
import { overfeedLine } from './baseline';

const H = 3_600_000;
const day0 = new Date(2026, 8, 28, 5).getTime(); // 월 새벽 5시 = 하루 시작
// n시간 전 그 시간에 k개 커밋
const burst = (hoursAgo: number, k: number) => Array.from({ length: k }, (_, i) => day0 - hoursAgo * H + i * 60_000);

describe('overfeedLine — 과식 기준 = 최근 28일, 커밋한 시간들의 상위 10% 선 (최소 10)', () => {
  it('기록이 없으면 최소값 10', () => {
    expect(overfeedLine([], day0)).toBe(10);
  });

  it('상위 10% 선: 시간당 5개가 18시간, 40개가 2시간이면 40', () => {
    const times = [...Array.from({ length: 18 }, (_, i) => burst(i * 3 + 2, 5)).flat(), ...burst(100, 40), ...burst(200, 40)];
    expect(overfeedLine(times, day0)).toBe(40);
  });

  it('바쁜 시간이 드물면(10% 미만) 그 아래 선', () => {
    const times = [...Array.from({ length: 19 }, (_, i) => burst(i * 3 + 2, 30)).flat(), ...burst(300, 59)];
    expect(overfeedLine(times, day0)).toBe(30);
  });

  it('28일보다 오래된 기록과 오늘 기록은 안 센다', () => {
    const old = burst(29 * 24, 50);
    const today = Array.from({ length: 50 }, (_, i) => day0 + i * 1000);
    expect(overfeedLine([...old, ...today], day0)).toBe(10);
  });

  it('한가한 달이어도 최소 10', () => {
    expect(overfeedLine(Array.from({ length: 30 }, (_, i) => burst(i * 5 + 2, 3)).flat(), day0)).toBe(10);
  });
});
