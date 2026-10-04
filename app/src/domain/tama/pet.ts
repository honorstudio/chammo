// 다마고치 상태 계산 — 작업 기록(커밋·PR·CI·위임·세션 작업)을 시간순으로 먹여 진화·돌봄 실수·아픔·죽음을 낸다.
// 순수 함수: 같은 기록과 같은 시각이면 언제 몇 번에 나눠 돌려도 결과가 같다(앱이 꺼졌다 켜져도 이어진다)
import { overfeedLine } from './baseline';
import { careMs, DEFAULT_CAL, inactiveWorkdays, type Calendar } from './clock';
import { isFullMoonNight } from './moon';
import { evolve, stageOf, ZERO, type Counters, type Egg, type Slot } from './tree';

/** by = 먹여 준 참모(세션 이름), label = 무슨 일이었나 — '오늘 먹은 것' 줄에 쓴다. 계산엔 안 쓴다.
 *  echo = 같은 일을 다른 갈래로 또 센 것·하루 상한 넘은 것(sources.balanceFeed) — 먹이지 않고 살아 있다는 표시만 */
type Tag = { by?: string; label?: string; echo?: boolean };
export type TamaEvent = Tag & (
  | { t: number; type: 'commit'; lines: number; hasTest: boolean }
  | { t: number; type: 'pr' }                        // PR 머지 = 특식
  | { t: number; type: 'task' }                      // 참모가 시킨 일이 끝남 = 밥
  | { t: number; type: 'ci'; pass: boolean }         // 배틀 한 판
  | { t: number; type: 'work'; minutes: number }     // 세션이 일한 시간 → 훈련
  | { t: number; type: 'show' }                      // 보여준 결과물 = 특식 (하루 3개까지 — sources 가 거른다)
  | { t: number; type: 'talk' }                      // 참모와 대화 = 간식 (한 시간에 1번)
  | { t: number; type: 'routine'; pass: boolean }    // 예약 보고 = 끼니 + 배틀
  | { t: number; type: 'doc' }                       // 문서 고침 = 목욕
  | { t: number; type: 'review' });                  // 시안 검토 = 놀아주기

export type Pet = {
  egg: Egg;
  slot: Slot;
  bornAt: number;
  /** 이 단계의 기록. 진화하면 0 부터 */
  c: Counters;
  /** 평생 기록 (스탯 창) */
  life: Counters;
  /** 마지막으로 먹은 직후 배부름(0~4)과 그 뒤로 흐른 돌봄 시간 */
  fedFull: number;
  fedCare: number;
  /** 배고픔 실수를 이미 몇 번 셌나 — 12시간마다 한 번씩 */
  hungerMistakes: number;
  poops: number;
  poopCare: number;
  cleanCredit: number;
  sick: boolean;
  sickCare: number;
  medicine: number;
  workCarry: number;
  /** 지금 이어지는 CI 연속 통과 (단계가 바뀌어도 이어진다) */
  streak: number;
  /** 과식 판정용: 최근 한 시간 커밋 시각 */
  recent: number[];
  lastOverfeed: number;
  lastActive: number;
  dead: null | { at: number; slot: Slot };
  updatedAt: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 알을 고른 뒤 누적으로 다음 단계가 되는 시각 (시간표 A) — 인덱스 = 도착 단계 */
export const STAGE_AT = [0, 5 * MIN, HOUR, 6 * HOUR, 24 * HOUR, 72 * HOUR, 168 * HOUR];
const HUNGER_MS = 12 * HOUR;
const POOP_MS = 6 * HOUR;
const SICK_MS = 12 * HOUR;
const DIGEST_MS = 3 * HOUR;
const MAX_FULL = 4;

export function hatch(egg: Egg, now: number, luck: number): Pet {
  return {
    egg, slot: 'egg', bornAt: now, c: { ...ZERO, luck }, life: { ...ZERO, luck },
    fedFull: 0, fedCare: 0, hungerMistakes: 0, poops: 0, poopCare: 0, cleanCredit: 0,
    sick: false, sickCare: 0, medicine: 0, workCarry: 0, streak: 0, recent: [], lastOverfeed: -Infinity,
    lastActive: now, dead: null, updatedAt: now,
  };
}

/** 지금 배부름 0~4 — 깨어 있는 3시간마다 하나씩 준다 */
export const fullness = (p: Pet) => Math.max(0, p.fedFull - Math.floor(p.fedCare / DIGEST_MS));

const bump = (p: Pet, k: keyof Counters, n = 1) => {
  p.c = { ...p.c, [k]: (p.c[k] ?? 0) + n };
  p.life = { ...p.life, [k]: (p.life[k] ?? 0) + n };
};

/** [from, to) 동안 흐른 돌봄 시간으로 타이머를 돌린다 */
function passTime(p: Pet, from: number, to: number, cal: Calendar) {
  const d = careMs(from, to, cal);
  if (!d) return;
  p.fedCare += d;
  const hungry = Math.floor(p.fedCare / HUNGER_MS);
  if (hungry > p.hungerMistakes) { bump(p, 'mistakes', hungry - p.hungerMistakes); p.hungerMistakes = hungry; }
  if (p.poops > 0) {
    p.poopCare += d;
    while (p.poopCare >= POOP_MS) { bump(p, 'mistakes'); p.poopCare -= POOP_MS; }
  }
  if (p.sick) {
    p.sickCare += d;
    while (p.sickCare >= SICK_MS) { bump(p, 'mistakes'); p.sickCare -= SICK_MS; }
  }
}

/** 이 시각에 볼 것: 진화 시각이 됐나, 너무 오래 쉬어서 아프거나 죽었나 */
function check(p: Pet, t: number, cal: Calendar) {
  const idle = inactiveWorkdays(p.lastActive, t, cal);
  if (idle >= 4) { p.dead = { at: t, slot: p.slot }; return; }
  if (idle >= 2 && !p.sick) { p.sick = true; p.sickCare = 0; p.medicine = 0; }
  // 시각이 됐는데 조건을 못 채웠으면 그대로 두고 다음 점검에서 다시 본다(완전체·궁극체)
  for (let at = STAGE_AT[stageOf(p.slot) + 1]; at !== undefined && t >= p.bornAt + at; at = STAGE_AT[stageOf(p.slot) + 1]) {
    const to = evolve(p.egg, p.slot, p.c);
    if (!to) break;
    p.slot = to;
    p.c = { ...ZERO, luck: p.c.luck };
  }
}

/** 먹이 — 어떤 끝낸 일이든 같은 밥. 아플 땐 세 번이 약 */
function feed(p: Pet, n: number) {
  p.fedFull = Math.min(MAX_FULL, fullness(p) + n);
  p.fedCare = 0;
  p.hungerMistakes = 0;
  if (p.sick && ++p.medicine >= 3) { p.sick = false; p.sickCare = 0; p.medicine = 0; }
}

function battle(p: Pet, pass: boolean) {
  bump(p, 'battles');
  if (!pass) { p.streak = 0; return; }
  bump(p, 'wins');
  p.streak = (p.streak ?? 0) + 1;
  p.c = { ...p.c, bestStreak: Math.max(p.c.bestStreak ?? 0, p.streak) };
  p.life = { ...p.life, bestStreak: Math.max(p.life.bestStreak ?? 0, p.streak) };
}

/** 과식 기준(시간당 커밋 수)을 날마다 구한다 — 하루는 새벽 5시에 시작 */
function overfeedByDay(events: TamaEvent[]): (t: number) => number {
  const times = events.filter((e) => e.type === 'commit').map((e) => e.t);
  const memo = new Map<number, number>();
  return (t) => {
    const d = new Date(t - 5 * HOUR);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
    let v = memo.get(start);
    if (v === undefined) memo.set(start, (v = overfeedLine(times, start)));
    return v;
  };
}

function apply(p: Pet, e: TamaEvent, line: (t: number) => number) {
  p.lastActive = e.t;
  const at = new Date(e.t), h = at.getHours();
  if (isFullMoonNight(e.t)) bump(p, 'moon');
  if (e.echo) {
    // 시킨 일 횟수는 위임 기록이라 메아리여도 센다(물결 궁극체·위임왕)
    if (e.type === 'task') { bump(p, 'tasksDone'); if (h >= 1 && h < 5) bump(p, 'dawnTasks'); }
    return;
  }
  switch (e.type) {
    case 'commit': {
      bump(p, 'commits');
      if (e.hasTest) bump(p, 'testCommits');
      feed(p, 1);
      p.recent = [...p.recent.filter((x) => e.t - x < HOUR), e.t];
      if (p.recent.length >= line(e.t) && e.t - p.lastOverfeed >= HOUR) { bump(p, 'overfeed'); p.lastOverfeed = e.t; }
      if (e.lines > 300) {
        if (p.poops === 0) p.poopCare = 0;
        p.poops++;
      } else if (p.poops > 0 && ++p.cleanCredit >= 3) {
        p.poops--; p.cleanCredit = 0;
        if (p.poops === 0) p.poopCare = 0;
      }
      return;
    }
    case 'pr':
      bump(p, 'prMerges');
      if (at.getDay() === 5 && h >= 18) bump(p, 'friPr');
      feed(p, 2);
      return;
    case 'task':
      bump(p, 'tasksDone');
      if (h >= 1 && h < 5) bump(p, 'dawnTasks');
      feed(p, 1);
      return;
    case 'ci':
      battle(p, e.pass);
      return;
    case 'show':
      bump(p, 'shows');
      feed(p, 2);
      return;
    case 'talk':
      bump(p, 'talks');
      feed(p, 1);
      return;
    case 'routine':
      bump(p, 'routines');
      if (e.pass) bump(p, 'routineWins');
      feed(p, 1);
      battle(p, e.pass);
      return;
    case 'doc':
      bump(p, 'docs');
      if (p.poops > 0) { p.poops--; p.cleanCredit = 0; if (p.poops === 0) p.poopCare = 0; }
      return;
    case 'review':
      bump(p, 'plays');
      return;
    case 'work': {
      p.workCarry += e.minutes;
      const n = Math.floor(p.workCarry / 30);
      if (n) { bump(p, 'training', n); p.workCarry -= n * 30; }
      return;
    }
  }
}

/**
 * updatedAt 뒤의 기록만 골라 now 까지 흘린다. 점검 시각 = 기록 시각 + 매 정시 + 진화 시각.
 * 같은 시각이면 시간 흐름·점검을 먼저 하고 기록을 먹인다(진화하는 그 순간의 커밋은 새 단계로 센다).
 * events 에는 지난 기록도 통째로 넘긴다 — 먹이는 updatedAt 뒤의 것만, 과식 기준은 지난 28일로 구한다
 */
export function advance(prev: Pet, events: TamaEvent[], now: number, cal: Calendar = DEFAULT_CAL): Pet {
  if (prev.dead) return { ...prev, updatedAt: now };
  const p: Pet = { ...prev, c: { ...prev.c }, life: { ...prev.life }, recent: [...prev.recent] };
  const line = overfeedByDay(events);
  const todo = events.filter((e) => e.t > prev.updatedAt && e.t <= now).sort((a, b) => a.t - b.t);
  let t = prev.updatedAt;
  let i = 0;
  while (t < now || i < todo.length) {
    const d = new Date(t);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const nextStage = STAGE_AT.map((x) => p.bornAt + x).find((x) => x > t) ?? Infinity;
    const next = Math.min(now, nextHour, nextStage, todo[i]?.t ?? Infinity);
    passTime(p, t, next, cal);
    t = next;
    check(p, t, cal);
    if (p.dead) break;
    for (let e = todo[i]; e && e.t === t; e = todo[++i]) apply(p, e, line);
    if (t >= now && i >= todo.length) break;
  }
  p.updatedAt = now;
  return p;
}
