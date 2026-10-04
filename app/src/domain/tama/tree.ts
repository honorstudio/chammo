// 다마고치 진화 트리 — 디지몬 V-Pet Ver.1 모양 그대로: 1 → 1 → 2 → 7 → 3 → 2 (계열마다 16종)
// 성숙기에서 가장 넓게 퍼지고, 완전체에서 성숙기 셋이 하나로 모이고, 궁극체는 완전체마다 따로.
// 나쁜 갈래(cN)는 배틀을 이겨내면 반전 완전체(p3)가 되고 거기서 끝. 시안: docs/design-drafts/tamagotchi/v3.html

import { tr } from '../../i18n';

export type Egg = 'fire' | 'wave' | 'leaf' | 'star';

/** 트리 안의 자리. c 뒤 글자는 디지몬 Ver.1 의 자리(그레이몬·데블몬·에어드라몬·티라노몬·메라몬·시드라몬·누메몬).
 *  cX = 숨은 성숙기, jA·jB = 합체 궁극체(보관함 두 마리를 합친다) */
export type Slot = 'egg' | 'i1' | 'i2' | 'r1' | 'r2' | 'cG' | 'cD' | 'cA' | 'cT' | 'cM' | 'cS' | 'cN' | 'cX' | 'p1' | 'p2' | 'p3' | 'm1' | 'm2' | 'jA' | 'jB';

/** 한 단계 동안 쌓은 기록. 진화하면 0 으로 돌아간다(디지몬과 같음) */
export type Counters = {
  mistakes: number;   // 돌봄 실수 — 배고픔 12시간·똥 6시간·아픈데 방치
  training: number;   // 세션이 일한 30분 = 1
  overfeed: number;   // 한 시간에 커밋 10개 이상 = 1
  battles: number;    // CI 한 번 = 한 판
  wins: number;       // CI 통과
  prMerges: number;
  tasksDone: number;  // 참모가 시킨 일이 끝남
  commits: number;
  testCommits: number;
  friPr: number;      // 금요일 밤(18시~) PR 머지 — 불씨 숨은 진화
  dawnTasks: number;  // 새벽 1~5시에 끝난 시킨 일 — 물결 숨은 진화
  bestStreak: number; // 이 단계에서 CI 가장 긴 연속 통과 — 잎사귀 숨은 진화
  moon: number;       // 보름달 밤 활동 — 별 숨은 진화
  shows: number;      // 보여준 결과물(scripts/show) — 특식, 불씨 궁극체의 '마무리'
  talks: number;      // 참모와 대화 — 간식
  routines: number;   // 예약 보고 = 배틀 한 판
  routineWins: number;
  docs: number;       // 문서 고침 — 목욕
  plays: number;      // 시안 검토 — 놀아주기
  luck: number;       // 0~1, 알을 고를 때 한 번 정한다 — 별알 궁극체가 매시간 다시 굴려 결국 통과하는 걸 막는다
};

export const ZERO: Counters = { mistakes: 0, training: 0, overfeed: 0, battles: 0, wins: 0, prMerges: 0, tasksDone: 0, commits: 0, testCommits: 0, friPr: 0, dawnTasks: 0, bestStreak: 0, moon: 0, shows: 0, talks: 0, routines: 0, routineWins: 0, docs: 0, plays: 0, luck: 0 };

const STAGE: Record<Slot, number> = { egg: 0, i1: 1, i2: 2, r1: 3, r2: 3, cG: 4, cD: 4, cA: 4, cT: 4, cM: 4, cS: 4, cN: 4, cX: 4, p1: 5, p2: 5, p3: 5, m1: 6, m2: 6, jA: 6, jB: 6 };
export const stageOf = (s: Slot) => STAGE[s];

const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

/** 궁극체로 가는 계열별 조건 (돌봄 실수 0~2 는 공통) */
// 일 종류로 센다(2026-10-03) — 개발 안 해도 넷 다 열린다. 불씨 = 마무리(PR 머지·결과물), 잎사귀 = 검사 비율(테스트 커밋·예약 성공·시안 검토)
const checked = (c: Counters) => c.testCommits + c.routineWins + c.plays;
const checkable = (c: Counters) => c.commits + c.routines + c.plays;
const MEGA: Record<Egg, (c: Counters) => boolean> = {
  fire: (c) => c.prMerges + c.shows >= 5,
  wave: (c) => c.tasksDone >= 10,
  leaf: (c) => checkable(c) > 0 && checked(c) / checkable(c) >= 0.5,
  star: (c) => c.luck < 0.5,
};

/** 숨은 성숙기 조건 (계열마다 하나) — 채우면 일반 갈래보다 먼저 간다 */
const HIDDEN: Record<Egg, (c: Counters) => boolean> = {
  fire: (c) => c.friPr >= 3,
  wave: (c) => c.dawnTasks >= 4,
  leaf: (c) => c.bestStreak >= 20,
  star: (c) => c.moon >= 1,
};

/** 지금 자리에서 다음 자리. null = 아직(또는 더 없음) — 시간이 됐는데 조건을 못 채우면 다음 점검 때 다시 본다 */
export function evolve(egg: Egg, s: Slot, c: Counters): Slot | null {
  const good = c.mistakes <= 2;
  switch (s) {
    case 'egg': return 'i1';
    case 'i1': return 'i2';
    case 'i2': return good ? 'r1' : 'r2';
    case 'r1':
      if (HIDDEN[egg](c)) return 'cX';
      if (good) return c.training >= 16 ? 'cG' : 'cD';
      if (c.overfeed >= 3 && c.training >= 16) return 'cM';
      if (c.overfeed >= 3 && between(c.training, 5, 15)) return 'cT';
      return 'cN';
    case 'r2':
      if (HIDDEN[egg](c)) return 'cX';
      if (good) return c.training >= 16 ? 'cD' : 'cM';
      if (between(c.training, 8, 15)) return c.overfeed <= 2 ? 'cA' : 'cS';
      return 'cN';
    case 'cG': case 'cD': case 'cA': case 'cT': case 'cM': case 'cS': case 'cN': case 'cX': {
      if (c.battles < 15 || c.wins < 12) return null;
      if (s === 'cX') return c.wins / c.battles >= 0.9 ? 'p1' : 'p2';
      return s === 'cN' ? 'p3' : ['cG', 'cD', 'cA'].includes(s) ? 'p1' : 'p2';
    }
    case 'p1': case 'p2':
      return good && MEGA[egg](c) ? (s === 'p1' ? 'm1' : 'm2') : null;
    default:
      return null; // p3(반전 완전체)·궁극체·합체 궁극체는 끝
  }
}

/** 합체: 서로 다른 알의 완전체 한 쌍 → 합체 궁극체. 순서 무관 */
const FUSE: [string, string, Slot][] = [['fire.p1', 'wave.p1', 'jA'], ['leaf.p1', 'star.p1', 'jB']];
export function fuseTarget(a: { egg: Egg; slot: Slot }, b: { egg: Egg; slot: Slot }): Slot | null {
  const x = `${a.egg}.${a.slot}`, y = `${b.egg}.${b.slot}`;
  return FUSE.find(([p, q]) => (p === x && q === y) || (p === y && q === x))?.[2] ?? null;
}

const HIDDEN_NAME: Record<Egg, string> = { fire: '금요일여우', wave: '새벽문어', leaf: '초록불사슴', star: '월식토끼' };
const FUSED_NAME = { jA: '마에스트로드래곤', jB: '크로노가디언' } as const;

const NAMES: Record<Egg, Record<Exclude<Slot, 'cX' | 'jA' | 'jB'>, string>> = {
  fire: { egg: '불씨알', i1: '톡', i2: '톡톡이', r1: '망치곰', r2: '불꽃도롱', cG: '배포룡', cD: '리팩토끼', cA: '커밋매', cT: '스쿼시곰', cM: '핫픽스여우', cS: '밤샘상어', cN: '버그덩이', p1: '파이프라인', p2: '롤백거북', p3: '레거시골렘', m1: '머지왕', m2: '릴리스피닉스' },
  wave: { egg: '물결알', i1: '퐁', i2: '방울이', r1: '지휘펭', r2: '수다쥐', cG: '전령갈매기', cD: '소나박쥐', cA: '파도수달', cT: '합주고래', cM: '등대게', cS: '잠수함문어', cN: '엉킨해파리', p1: '오케스트라곤', p2: '큐레이터학', p3: '멍게왕', m1: '마에스트로', m2: '심포니아' },
  leaf: { egg: '잎사귀알', i1: '싹', i2: '새싹이', r1: '방패거북', r2: '린트나무', cG: '커버리지골렘', cD: '문서부엉이', cA: '스텁다람쥐', cT: '픽스처곰', cM: '모킹새', cS: '어서트사슴', cN: '곰팡이덩굴', p1: '그린빌드', p2: '아카이브나무', p3: '시든고목', m1: '세계수지기', m2: '회귀수호자' },
  star: { egg: '별알', i1: '반짝', i2: '반짝이', r1: '별똥냥', r2: '유성뱀', cG: '혜성말', cD: '성운나비', cA: '위성거북', cT: '운석곰', cM: '오로라여우', cS: '펄서박쥐', cN: '블랙홀덩이', p1: '은하고래', p2: '초신성', p3: '암흑물질', m1: '코스모스', m2: '빅뱅룡' },
};
// 영어 이름 — 한국어 표와 같은 자리. 부를 때 고르니 언어를 바꾼 테스트에서도 맞다
const HIDDEN_EN: Record<Egg, string> = { fire: 'Friday Fox', wave: 'Dawn Octopus', leaf: 'Greenlight Deer', star: 'Eclipse Rabbit' };
const FUSED_EN = { jA: 'Maestro Dragon', jB: 'Chrono Guardian' } as const;
const NAMES_EN: typeof NAMES = {
  fire: { egg: 'Ember Egg', i1: 'Tap', i2: 'Tappy', r1: 'Hammer Bear', r2: 'Flamander', cG: 'Deployragon', cD: 'Refactor Rabbit', cA: 'Commit Hawk', cT: 'Squash Bear', cM: 'Hotfix Fox', cS: 'All-Nighter Shark', cN: 'Bug Blob', p1: 'Pipeline', p2: 'Rollback Turtle', p3: 'Legacy Golem', m1: 'Merge King', m2: 'Release Phoenix' },
  wave: { egg: 'Wave Egg', i1: 'Plop', i2: 'Bubbles', r1: 'Baton Penguin', r2: 'Chatter Mouse', cG: 'Messenger Gull', cD: 'Sonar Bat', cA: 'Surf Otter', cT: 'Ensemble Whale', cM: 'Lighthouse Crab', cS: 'Submarine Octopus', cN: 'Tangled Jelly', p1: 'Orchestragon', p2: 'Curator Crane', p3: 'Sea Squirt King', m1: 'Maestro', m2: 'Symphonia' },
  leaf: { egg: 'Leaf Egg', i1: 'Sprout', i2: 'Sprouty', r1: 'Shield Tortoise', r2: 'Lint Tree', cG: 'Coverage Golem', cD: 'Docs Owl', cA: 'Stub Squirrel', cT: 'Fixture Bear', cM: 'Mockingbird', cS: 'Assert Deer', cN: 'Mildew Vine', p1: 'Green Build', p2: 'Archive Tree', p3: 'Withered Oak', m1: 'World Tree Keeper', m2: 'Regression Guardian' },
  star: { egg: 'Star Egg', i1: 'Twink', i2: 'Twinkle', r1: 'Comet Kitty', r2: 'Meteor Snake', cG: 'Comet Horse', cD: 'Nebula Butterfly', cA: 'Satellite Turtle', cT: 'Meteorite Bear', cM: 'Aurora Fox', cS: 'Pulsar Bat', cN: 'Black Hole Blob', p1: 'Galaxy Whale', p2: 'Supernova', p3: 'Dark Matter', m1: 'Cosmos', m2: 'Big Bang Dragon' },
};
export const nameOf = (egg: Egg, s: Slot): string =>
  s === 'cX' ? tr(HIDDEN_NAME[egg], HIDDEN_EN[egg]) : s === 'jA' || s === 'jB' ? tr(FUSED_NAME[s], FUSED_EN[s]) : tr(NAMES[egg][s], NAMES_EN[egg][s]);
