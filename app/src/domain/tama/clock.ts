// 다마고치 돌봄 시계. 배고픔·똥 타이머는 "깨어 있는 평일"에만 돈다 —
// 밤에 자는 동안이나 주말·공휴일에 굶었다고 돌봄 실수가 쌓이면 억울하다(죽음 규칙 B: 쉬는 날은 셈에서 뺀다)

export type Calendar = {
  /** 잠자는 시간 [from, to) — 0~9 시면 자정부터 아침 9시 전까지 */
  sleepFrom: number;
  sleepTo: number;
  /** 'MM-DD'(매년) 또는 'YYYY-MM-DD'(그해만) */
  holidays: Set<string>;
};

// 해마다 날짜가 바뀌는 공휴일 — 설·추석 사흘·부처님오신날(음력)·선거일·대체공휴일(설·추석은 일요일·다른 공휴일과 겹칠 때,
// 그 밖은 토·일·겹칠 때 다음 평일). 계산 라이브러리 대신 날짜표(2026-10-09 대체 규칙으로 뽑음). 마지막 해가 오면 clock.test 하나가 깨진다
export const HOLIDAYS_LAST_YEAR = 2030;
const VARYING_HOLIDAYS = [
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-24', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-05',
  '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-05-13', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-04', '2027-10-11', '2027-12-27',
  '2028-01-25', '2028-01-26', '2028-01-27', '2028-04-12', '2028-05-02', '2028-10-02', '2028-10-03', '2028-10-04', '2028-10-05',
  '2029-02-12', '2029-02-13', '2029-02-14', '2029-05-07', '2029-05-20', '2029-05-21', '2029-09-21', '2029-09-22', '2029-09-23', '2029-09-24',
  '2030-02-02', '2030-02-03', '2030-02-04', '2030-02-05', '2030-05-06', '2030-05-09', '2030-09-11', '2030-09-12', '2030-09-13',
];

export const DEFAULT_CAL: Calendar = {
  sleepFrom: 0,
  sleepTo: 9,
  holidays: new Set(['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25', ...VARYING_HOLIDAYS]),
};

const pad = (n: number) => String(n).padStart(2, '0');

function isWorkday(d: Date, cal: Calendar): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return !cal.holidays.has(md) && !cal.holidays.has(`${d.getFullYear()}-${md}`);
}

export function isCareTime(t: number, cal: Calendar): boolean {
  const d = new Date(t);
  const h = d.getHours();
  return !(h >= cal.sleepFrom && h < cal.sleepTo) && isWorkday(d, cal);
}

/** [from, to) 동안 돌봄 시계가 돈 분 */
export const careMinutes = (from: number, to: number, cal: Calendar) => Math.round(careMs(from, to, cal) / 60_000);

/** [from, to) 동안 돌봄 시계가 돈 ms. 깨어 있음·평일 여부는 정시에만 바뀌니 한 시간씩 건너뛰어도 정확하다.
 *  pet.ts 는 이걸 잘게 나눠 더하므로 반올림 없이 ms 로 준다 */
export function careMs(from: number, to: number, cal: Calendar): number {
  let ms = 0;
  let t = from;
  while (t < to) {
    const d = new Date(t);
    const next = Math.min(to, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime());
    if (isCareTime(t, cal)) ms += next - t;
    t = next;
  }
  return ms;
}

/** 하루는 새벽 5시에 바뀐다(usage.ts 의 오늘과 같은 기준) — 그 시각이 속한 날의 정오 */
function dayOf(t: number): Date {
  const d = new Date(t - 5 * 3_600_000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}

/** 마지막 활동 뒤로 통째로 지나간 평일 수. 2일이면 아프고 4일이면 죽는다 */
export function inactiveWorkdays(lastActive: number, now: number, cal: Calendar): number {
  const end = dayOf(now);
  let n = 0;
  for (let d = dayOf(lastActive); ; ) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12);
    if (d >= end) return n;
    if (isWorkday(d, cal)) n++;
  }
}
