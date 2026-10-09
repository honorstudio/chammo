import { describe, expect, it } from 'vitest';
import { careMinutes, DEFAULT_CAL, HOLIDAYS_LAST_YEAR, inactiveWorkdays, isCareTime } from './clock';

// 2026-09-28 = 월요일(at(28) 은 5주 뒤 11/2 월). 로컬 시간으로 만든다(테스트 머신 시간대와 무관하게)
// 날짜 숫자는 9월 기준으로 쓰고 5주(35일) 뒤로 옮긴다 — 같은 요일, 2026 추석 주(9/24~26)를 피해 공휴일 없는 10/26~11/6 에서
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d + 35, h, m).getTime();

describe('isCareTime — 돌봄 시계가 도는 때 (깨어 있는 평일)', () => {
  it('평일 낮은 돈다, 밤(0~9시)은 잔다', () => {
    expect(isCareTime(at(28, 14), DEFAULT_CAL)).toBe(true);
    expect(isCareTime(at(28, 3), DEFAULT_CAL)).toBe(false);
    expect(isCareTime(at(28, 9), DEFAULT_CAL)).toBe(true);
  });

  it('주말·공휴일은 쉰다', () => {
    expect(isCareTime(at(26, 14), DEFAULT_CAL)).toBe(false); // 토
    expect(isCareTime(at(27, 14), DEFAULT_CAL)).toBe(false); // 일
    expect(isCareTime(new Date(2026, 9, 9, 14).getTime(), DEFAULT_CAL)).toBe(false); // 한글날
  });

  it('음력 공휴일·선거일·대체공휴일도 쉰다 — 설·추석 사흘, 부처님오신날, 겹친 날 대체', () => {
    const day = (y: number, m: number, d: number) => isCareTime(new Date(y, m - 1, d, 14).getTime(), DEFAULT_CAL);
    expect([16, 17, 18].map((d) => day(2026, 2, d))).toEqual([false, false, false]); // 설
    expect(day(2026, 2, 19)).toBe(true);
    expect(day(2026, 3, 2)).toBe(false); // 삼일절(일) 대체
    expect(day(2026, 5, 25)).toBe(false); // 부처님오신날(일) 대체
    expect(day(2026, 6, 3)).toBe(false); // 지방선거
    expect([24, 25].map((d) => day(2026, 9, d))).toEqual([false, false]); // 추석
    expect(day(2026, 9, 28)).toBe(true); // 추석 끝날이 토요일이면 대체 없음
    expect(day(2027, 2, 9)).toBe(false); // 설(일) 대체
    expect(day(2027, 12, 27)).toBe(false); // 성탄절(토) 대체
    expect(day(2028, 10, 5)).toBe(false); // 개천절이 추석과 겹침
    expect(day(2030, 9, 13)).toBe(false); // 추석
  });

  it('날짜표가 남은 해 — 표의 마지막 해가 오면 이 시험만 깨진다(그다음 해들의 설·추석·부처님오신날·대체공휴일을 VARYING_HOLIDAYS 에 더할 것)', () => {
    expect(new Date().getFullYear()).toBeLessThan(HOLIDAYS_LAST_YEAR);
  });
});

describe('careMinutes — 두 시각 사이 돌봄 시계가 돈 분', () => {
  it('평일 낮 3시간 = 180분', () => {
    expect(careMinutes(at(28, 10), at(28, 13), DEFAULT_CAL)).toBe(180);
  });

  it('밤을 건너면 잠든 시간은 빠진다 — 저녁 8시 커밋, 다음 날 10시 = 5시간', () => {
    expect(careMinutes(at(28, 20), at(29, 10), DEFAULT_CAL)).toBe(5 * 60);
  });

  it('금요일 저녁 → 월요일 아침: 주말은 통째로 빠진다', () => {
    expect(careMinutes(at(25, 22), at(28, 10), DEFAULT_CAL)).toBe(2 * 60 + 60);
  });

  it('거꾸로면 0', () => {
    expect(careMinutes(at(28, 13), at(28, 10), DEFAULT_CAL)).toBe(0);
  });
});

describe('inactiveWorkdays — 마지막 활동 뒤로 통째로 지나간 평일 수 (하루는 새벽 5시에 바뀜)', () => {
  it('월요일 저녁 활동 → 목요일 새벽 5시가 되면 화·수 2일', () => {
    expect(inactiveWorkdays(at(28, 18), at(1 + 30, 4, 59), DEFAULT_CAL)).toBe(1);
    expect(inactiveWorkdays(at(28, 18), at(31, 5), DEFAULT_CAL)).toBe(2);
  });

  it('주말은 세지 않는다 — 금요일 활동 → 화요일 새벽이면 월요일 하루뿐', () => {
    expect(inactiveWorkdays(at(25, 18), at(29, 6), DEFAULT_CAL)).toBe(1);
  });

  it('같은 날이면 0', () => {
    expect(inactiveWorkdays(at(28, 10), at(28, 23), DEFAULT_CAL)).toBe(0);
  });

  it('새벽 2시 활동은 전날로 친다', () => {
    expect(inactiveWorkdays(at(29, 2), at(29, 6), DEFAULT_CAL)).toBe(0);
  });
});
