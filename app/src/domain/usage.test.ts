import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { dayStart, fmtResetIn, parseUsage } from './usage';

const NOW = 1_790_000_000_000; // ms

describe('parseUsage — 상태줄이 남긴 statusline.json 에서 남은 양', () => {
  it('5시간·주간 남은 %와 초기화까지 남은 초', () => {
    const j = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 5.4, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: 30, resets_at: NOW / 1000 + 90000 } } });
    expect(parseUsage(j, NOW)).toEqual({ five: { left: 95, resetIn: 3600 }, week: { left: 70, resetIn: 90000 } });
  });

  it('값이 없으면 그 칸은 비운다', () => {
    expect(parseUsage(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 10 } } }), NOW)).toEqual({ five: { left: 90, resetIn: null } });
  });

  it('깨졌거나 비었으면 빈 객체', () => {
    expect(parseUsage('', NOW)).toEqual({});
    expect(parseUsage('{"rate', NOW)).toEqual({});
  });
});

describe('fmtResetIn — 초기화까지 남은 시간', () => {
  it.each([
    [0, '곧'],
    [-5, '곧'],
    [59 * 60, '59분'],
    [3 * 3600 + 20 * 60, '3시간 20분'],
    [2 * 86400 + 5 * 3600, '2일 5시간'],
  ])('%i초 → %s', (s, out) => expect(fmtResetIn(s)).toBe(out));
});

describe('dayStart — 하루의 시작은 새벽 5시 (자정 넘어 일해도 같은 날로)', () => {
  it('오전 3시면 어제 5시부터', () => expect(dayStart(new Date(2026, 8, 27, 3, 44))).toBe('2026-09-26 05:00'));
  it('오전 5시 정각이면 오늘 5시부터', () => expect(dayStart(new Date(2026, 8, 27, 5, 0))).toBe('2026-09-27 05:00'));
  it('저녁이면 오늘 5시부터', () => expect(dayStart(new Date(2026, 8, 27, 22, 10))).toBe('2026-09-27 05:00'));
  it('월 첫날 새벽이면 지난달로', () => expect(dayStart(new Date(2026, 9, 1, 1, 0))).toBe('2026-09-30 05:00'));
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('초기화까지 남은 시간을 짧은 영어 단위로', () => {
    setLang('en');
    expect(fmtResetIn(0)).toBe('soon');
    expect(fmtResetIn(90061)).toBe('1d 1h');
    expect(fmtResetIn(3720)).toBe('1h 2m');
    expect(fmtResetIn(300)).toBe('5m');
  });
});
