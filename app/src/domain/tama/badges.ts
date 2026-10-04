// 다마고치 업적 — 도감·평생 기록·커밋 습관(작은 커밋·테스트·연속)으로 딴다. 한 번 따면 계속 남는다
import { assistant, josa, tr } from '../../i18n';
import type { TamaEvent } from './pet';
import type { TamaFile } from './store';

export type Badge = { id: string; name: string; hint: string };

const who = assistant();

export const BADGES: Badge[] = [
  { id: 'hatch', name: tr('첫 부화', 'First Hatch'), hint: tr('알에서 처음 깨어났다', 'Hatched from an egg for the first time') },
  { id: 'allEggs', name: tr('네 알 다 키움', 'All Four Eggs'), hint: tr('불씨·물결·잎사귀·별 알을 모두 부화시켰다', 'Hatched Ember, Wave, Leaf and Star eggs') },
  { id: 'perfect', name: tr('첫 완전체', 'First Perfect'), hint: tr('배틀(CI·예약) 15번 중 12번 이겨서 완전체까지', 'Won 12 of 15 battles (CI or schedules) to reach Perfect') },
  { id: 'ultimate', name: tr('첫 궁극체', 'First Ultimate'), hint: tr('7일을 키워 궁극체까지', 'Raised one for 7 days to Ultimate') },
  { id: 'noGrave', name: tr('무덤 없이 궁극체', 'Ultimate, No Graves'), hint: tr('한 마리도 안 죽이고 궁극체까지', 'Reached Ultimate without losing a single pet') },
  { id: 'turnaround', name: tr('반전', 'Turnaround'), hint: tr('잘못 키운 갈래를 배틀로 이겨내 반전 완전체로', 'Battled a bad branch back into a comeback Perfect') },
  { id: 'hidden', name: tr('숨은 진화 발견', 'Hidden Evolution'), hint: tr('조건이 ??? 인 숨은 성숙기를 만났다', 'Met a hidden Champion with ??? conditions') },
  { id: 'fused', name: tr('합체', 'Fusion'), hint: tr('보관함의 짝과 합체 궁극체를 만들었다', 'Fused with its partner from storage into an Ultimate') },
  { id: 'dexHalf', name: tr('도감 절반', 'Half the Dex'), hint: tr('74종 중 37종을 봤다', 'Seen 37 of 74 forms') },
  { id: 'dexFull', name: tr('도감 완성', 'Complete Dex'), hint: tr('74종을 다 봤다', 'Seen all 74 forms') },
  { id: 'smallDay', name: tr('작은 커밋의 날', 'Small Commits Day'), hint: tr('하루 커밋 10개 이상, 300줄 넘는 커밋 0개', '10+ commits in a day, none over 300 lines') },
  { id: 'testHalf', name: tr('테스트 반', 'Half Tested'), hint: tr('하루 커밋 10개 이상 중 절반 넘게 테스트 포함', '10+ commits in a day, more than half with tests') },
  { id: 'week', name: tr('7일 연속', '7-Day Streak'), hint: tr('7일 내리 커밋했다', 'Committed 7 days in a row') },
  { id: 'ciStreak', name: tr('초록 20연승', '20 Greens in a Row'), hint: tr('CI 20번 연속 통과', 'CI passed 20 times in a row') },
  { id: 'delegator', name: tr('위임왕', 'Delegation King'), hint: tr(`${josa(who, '이', '가')} 시킨 일 50개가 끝났다`, `50 tasks delegated by ${who} are done`) },
];

const HOUR = 3_600_000;
/** 하루는 새벽 5시에 바뀐다 */
const dayKey = (t: number) => {
  const d = new Date(t - 5 * HOUR);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** 합체 궁극체는 어느 계열로 봤든 한 종 */
const uniqueDex = (dex: string[]) => new Set(dex.map((d) => (/\.j[AB]$/.test(d) ? d.slice(-2) : d)));

function commitDays(events: TamaEvent[]) {
  const days = new Map<string, { n: number; big: number; test: number }>();
  for (const e of events) {
    if (e.type !== 'commit') continue;
    const k = dayKey(e.t);
    const d = days.get(k) ?? { n: 0, big: 0, test: 0 };
    d.n++;
    if (e.lines > 300) d.big++;
    if (e.hasTest) d.test++;
    days.set(k, d);
  }
  return days;
}

function longestRun(days: Set<string>, now: number) {
  let best = 0, run = 0;
  // 오늘부터 거꾸로 60일 — 연속 일수를 센다
  for (let i = 60; i >= 0; i--) {
    run = days.has(dayKey(now - i * 24 * HOUR)) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** 지금 조건을 채운 업적 id 들 */
export function earnedBadges(f: TamaFile, events: TamaEvent[], now: number): string[] {
  const dex = f.dex;
  const has = (re: RegExp) => dex.some((d) => re.test(d));
  const life = f.pet?.life;
  const days = commitDays(events);
  const ultimate = has(/\.(m1|m2|jA|jB)$/);
  const out: [string, boolean][] = [
    ['hatch', has(/\.i1$/)],
    ['allEggs', ['fire', 'wave', 'leaf', 'star'].every((e) => dex.includes(`${e}.i1`))],
    ['perfect', has(/\.p[123]$/)],
    ['ultimate', ultimate],
    ['noGrave', ultimate && f.graves.length === 0],
    ['turnaround', has(/\.p3$/)],
    ['hidden', has(/\.cX$/)],
    ['fused', has(/\.j[AB]$/)],
    ['dexHalf', uniqueDex(dex).size >= 37],
    ['dexFull', uniqueDex(dex).size >= 74],
    ['smallDay', [...days.values()].some((d) => d.n >= 10 && d.big === 0)],
    ['testHalf', [...days.values()].some((d) => d.n >= 10 && d.test * 2 >= d.n)],
    ['week', longestRun(new Set(days.keys()), now) >= 7],
    ['ciStreak', (life?.bestStreak ?? 0) >= 20],
    ['delegator', (life?.tasksDone ?? 0) >= 50],
  ];
  return out.filter(([, ok]) => ok).map(([id]) => id);
}

/** 새로 딴 것만 fresh 로. 이미 딴 건 조건이 빠져도 안 뺏는다 */
export function unlockBadges(f: TamaFile, earned: string[], now: number): { file: TamaFile; fresh: string[] } {
  const have = f.badges ?? {};
  const fresh = earned.filter((id) => have[id] === undefined);
  if (!fresh.length) return { file: f, fresh };
  return { file: { ...f, badges: { ...have, ...Object.fromEntries(fresh.map((id) => [id, now])) } }, fresh };
}
