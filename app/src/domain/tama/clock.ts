// 다마고치 돌봄 시계. 배고픔·똥 타이머는 "깨어 있는 평일"에만 돈다 —
// 밤에 자는 동안이나 주말·공휴일에 굶었다고 돌봄 실수가 쌓이면 억울하다(죽음 규칙 B: 쉬는 날은 셈에서 뺀다)

export type Calendar = {
  /** 잠자는 시간 [from, to) — 0~9 시면 자정부터 아침 9시 전까지 */
  sleepFrom: number;
  sleepTo: number;
  /** 'MM-DD'(매년) 또는 'YYYY-MM-DD'(그해만) */
  holidays: Set<string>;
};

// 양력 고정 공휴일만. 설·추석·부처님오신날(음력)·대체공휴일은 해마다 날짜가 바뀌어 아직 안 넣었다 — roadmap 부채
export const DEFAULT_CAL: Calendar = {
  sleepFrom: 0,
  sleepTo: 9,
  holidays: new Set(['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25']),
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
