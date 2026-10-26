// 하루 코인 — 가짜 하루 둘로 전후를 숫자로 묶는다(2026-10-24 사용자 "업무 보는 사람들 코인이 잘 안 쌓이더라, 느슨하게")
// 전(10-24 이전 규칙): 업무 사용자 하루 24 · 개발자 하루 111
import { describe, expect, it } from 'vitest';
import { BIZ_DAY, BIZ_FLOOR, earn, EMPTY_GACHA, PRICE, WORK_DAY } from './gacha';
import type { TamaEvent } from './tama/pet';
import { balanceFeed } from './tama/sources';

const at = (h: number, m = 0, day = 20) => new Date(2026, 9, day, h, m).getTime(); // 10/20 화요일
const MIN = 60_000;
/** 앱이 하는 대로 — 먹이 균형(balanceFeed)을 거친 사건에 일한 시간 칸을 붙여 하루치 코인 */
const dayCoins = (evs: TamaEvent[], work: TamaEvent[] = []) =>
  earn({ ...EMPTY_GACHA, since: at(5) }, [...balanceFeed(evs), ...work], at(23, 59)).gained;
/** 일한 시간 — 10분 칸(칸 끝 시각에 찍힌다), 칸마다 세션 수 × 10분 */
const bins = (from: number, to: number, sessions: number): TamaEvent[] => {
  const out: TamaEvent[] = [];
  for (let t = from + 10 * MIN; t <= to; t += 10 * MIN) out.push({ t, type: 'work', minutes: 10 * sessions });
  return out;
};
const every = (from: number, to: number, stepMin: number, make: (t: number) => TamaEvent) => {
  const out: TamaEvent[] = [];
  for (let t = from; t < to; t += stepMin * MIN) out.push(make(t));
  return out;
};

/** 업무 사용자 하루 — 코드 없이 문서·조사·브라우저 일을 시키고 참모와 대화(09~18시, 점심 빼고) */
function bizDay() {
  const tasks = [at(10, 30), at(11, 30), at(14), at(15), at(16), at(17)];
  const evs: TamaEvent[] = [
    { t: at(9), type: 'routine', pass: true },
    ...every(at(9, 30), at(12), 15, (t) => ({ t, type: 'talk' })),
    ...every(at(13), at(18), 15, (t) => ({ t, type: 'talk' })),
    ...tasks.map((t): TamaEvent => ({ t, type: 'task' })),
    { t: at(11, 40), type: 'show', label: '조사.md' },
    { t: at(15, 10), type: 'show', label: '견적.pdf' },
    { t: at(17, 10), type: 'show', label: '정리.html' },
    ...[at(10), at(13, 30), at(15, 30), at(16, 30)].map((t): TamaEvent => ({ t, type: 'doc' })),
    { t: at(14, 30), type: 'review' },
  ];
  // 시킨 일마다 세션 하나가 30분 일함 = 하루 180분
  return { evs, work: tasks.flatMap((t) => bins(t - 30 * MIN, t, 1)) };
}

/** 개발자 하루 — 10~22시 커밋 16·머지 4·CI 16(2번 실패), 시킨 일 10, 대화 20분마다, 세션 셋이 내내 일함(2,160분) */
function devDay(day = 20) {
  const at = (h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
  const commits = every(at(10), at(20, 40), 40, (t): TamaEvent => {
    const i = Math.round((t - at(10)) / (40 * MIN));
    return { t, type: 'commit', lines: i % 2 ? 450 : 120, hasTest: i % 3 === 0 };
  });
  const evs: TamaEvent[] = [
    ...commits,
    ...commits.map((c, i): TamaEvent => ({ t: c.t + 5 * MIN, type: 'ci', pass: i !== 4 && i !== 11 })),
    ...[at(12), at(15), at(18), at(21)].map((t): TamaEvent => ({ t, type: 'pr' })),
    ...[10.3, 11.5, 12.3, 13.9, 14.5, 16.1, 17.4, 19.2, 21.5, 22.2].map((h): TamaEvent => ({ t: at(Math.floor(h), Math.round((h % 1) * 60)), type: 'task' })),
    ...every(at(10), at(22), 20, (t) => ({ t, type: 'talk' })),
    { t: at(13, 15), type: 'show', label: 'a.png' }, { t: at(16, 45), type: 'show', label: 'b.md' }, { t: at(21, 40), type: 'show', label: 'c.html' },
    { t: at(9, 50), type: 'routine', pass: true }, { t: at(11, 10), type: 'doc' }, { t: at(19, 50), type: 'doc' }, { t: at(14, 50), type: 'review' },
  ];
  return { evs, work: bins(at(10), at(22), 3) };
}

describe('하루 코인 — 업무 사용자도 하루 뽑기 1~2번, 개발자는 크게 안 늘게', () => {
  it('업무 사용자 하루: 24 → 116 (뽑기 한 번 넘게)', () => {
    const d = bizDay();
    const coins = dayCoins(d.evs, d.work);
    expect(coins).toBe(116);
    expect(coins).toBeGreaterThanOrEqual(PRICE);
    expect(coins).toBeLessThanOrEqual(2 * PRICE);
  });

  it('개발자 하루(어제도 개발): 111 → 150 (업무 몫이 커밋·머지·CI 코인만큼 줄어 크게 안 는다)', () => {
    const y = devDay(19), d = devDay(20);
    const both = earn({ ...EMPTY_GACHA, since: at(5, 0, 19) }, [...balanceFeed([...y.evs, ...d.evs]), ...y.work, ...d.work], at(23, 59)).gained;
    const yesterday = earn({ ...EMPTY_GACHA, since: at(5, 0, 19) }, [...balanceFeed(y.evs), ...y.work], at(23, 59)).gained;
    const coins = both - yesterday;
    expect(coins).toBe(150);
    expect(coins).toBeLessThanOrEqual(111 * 1.4);
  });

  it('개발자 첫날(지난 7일 개발 없음): 111 → 187 — 아침 일한 시간이 커밋보다 먼저 업무 몫을 채운다(첫날만)', () => {
    const d = devDay();
    expect(dayCoins(d.evs, d.work)).toBe(187);
  });
});

describe('일한 시간 코인 — 세션이 일한 5분마다 1', () => {
  const one = (work: TamaEvent[]) => dayCoins([], work);
  it('칸마다 끊지 않고 그날 안에서 나머지가 이어진다(3분 칸 다섯 = 15분 = 3)', () => {
    expect(one([1, 2, 3, 4, 5].map((i) => ({ t: at(10) + i * 10 * MIN, type: 'work', minutes: 3 })))).toBe(3);
  });
  it(`하루 ${WORK_DAY}까지 — 세션 여럿이 종일 돌아도`, () => {
    expect(one(bins(at(9), at(21), 5))).toBe(WORK_DAY);
  });
  it('새벽 5시에 나머지·상한이 새로 시작한다', () => {
    const night = [{ t: at(4, 50), type: 'work' as const, minutes: 4 }, { t: at(5, 10), type: 'work' as const, minutes: 4 }];
    expect(earn({ ...EMPTY_GACHA, since: at(0) }, night, at(6)).gained).toBe(0);
  });
});

describe(`업무 몫 — 끝낸 일·일한 시간은 하루 ${BIZ_DAY}까지, 커밋·머지·CI 로 번 만큼 줄고 ${BIZ_FLOOR}은 남는다`, () => {
  const tasks = (n: number, from: number): TamaEvent[] => Array.from({ length: n }, (_, i) => ({ t: from + i * 11 * MIN, type: 'task' }));
  it(`커밋 없이 끝낸 일만 — ${BIZ_DAY}에서 멈춘다`, () => {
    expect(dayCoins(tasks(40, at(6)))).toBe(BIZ_DAY);
  });
  it('머지로 먼저 번 날은 그만큼 덜 — 머지 10번(100) 뒤 끝낸 일은 50까지', () => {
    const prs = Array.from({ length: 10 }, (_, i): TamaEvent => ({ t: at(6) + i * MIN, type: 'pr' }));
    expect(dayCoins([...prs, ...tasks(40, at(7))])).toBe(100 + BIZ_FLOOR);
  });
  it('커밋 코인이 많아도 업무 몫은 50은 남는다', () => {
    const prs = Array.from({ length: 20 }, (_, i): TamaEvent => ({ t: at(6) + i * MIN, type: 'pr' }));
    expect(dayCoins([...prs, ...tasks(40, at(7))])).toBe(200 + BIZ_FLOOR);
  });
  it('장애 몬스터 처치는 업무 몫 밖', () => {
    expect(dayCoins([...tasks(40, at(6)), { t: at(22), type: 'slay', kind: 'slime', lv: 1 }])).toBe(BIZ_DAY + 5);
  });
});
