// 머지 가챠 — 일한 만큼 코인이 쌓이고, 뽑고 싶을 때 뽑는다. 순수 TS. 시안 docs/design-drafts/pixel-office v2(규칙·풀)·v3(연출)
// 저장은 ~/.honor-orchestrator/gacha.json (다마고치 tama.json 과 같은 방식)

import { tr } from '../i18n';
import type { TamaEvent } from './tama/pet';
import { DAY_EXTRA, SHOW_PER_DAY } from './tama/sources';

export type Rarity = '흔함' | '보통' | '희귀' | '전설';
export type ItemKind = 'skin' | 'furn' | 'hat' | 'window' | 'friend' | 'fx' | 'action';
/** 등급은 키(색·확률·비교)로 쓰니 한국어 그대로 두고, 화면에 보일 때만 이걸로 */
export const rarityLabel = (r: Rarity): string =>
  ({ 흔함: tr('흔함', 'Common'), 보통: tr('보통', 'Uncommon'), 희귀: tr('희귀', 'Rare'), 전설: tr('전설', 'Legendary') })[r];
export type Item = { id: string; kind: ItemKind; rarity: Rarity; name: string };

/** 이름 = '<종류> — <이름>' (뽑기 화면은 ' — ' 앞을 떼고 보여 준다). 한·영 같은 모양 */
const named = (ko: string, en: string) => (k: string, e: string) => tr(`${ko} — ${k}`, `${en} — ${e}`);
const skin = named('방 스킨', 'Room skin');
const furn = named('가구', 'Furniture');
const hat = named('캐릭터 꾸미기', 'Outfit');
const view = named('창밖', 'Window view');
const fx = named('펑 대신', 'Pop effect');
const move = named('반장 액션', 'Boss move');
const pal = named('펫 친구', 'Pet pal');

/** 뽑기 풀. 스킨 id 는 `skin.<ui/office/skins 이름>` — 뽑으면 사무실 스킨 버튼에 생긴다 */
export const CATALOG: Item[] = [
  { id: 'skin.mint', kind: 'skin', rarity: '보통', name: skin('민트', 'Mint') },
  { id: 'skin.camp', kind: 'skin', rarity: '보통', name: skin('캠핑장', 'Campsite') },
  { id: 'skin.library', kind: 'skin', rarity: '보통', name: skin('도서관', 'Library') },
  { id: 'skin.lcd', kind: 'skin', rarity: '희귀', name: skin('LCD', 'LCD') },
  { id: 'skin.neon', kind: 'skin', rarity: '희귀', name: skin('네온', 'Neon') },
  { id: 'skin.ocean', kind: 'skin', rarity: '희귀', name: skin('바닷속', 'Under the Sea') },
  { id: 'skin.space', kind: 'skin', rarity: '전설', name: skin('우주정거장', 'Space Station') },
  { id: 'skin.cafe', kind: 'skin', rarity: '흔함', name: skin('카페', 'Cafe') },
  { id: 'skin.classroom', kind: 'skin', rarity: '흔함', name: skin('교실', 'Classroom') },
  { id: 'skin.greenhouse', kind: 'skin', rarity: '흔함', name: skin('온실', 'Greenhouse') },
  { id: 'skin.mono', kind: 'skin', rarity: '흔함', name: skin('흑백', 'Monochrome') },
  { id: 'skin.sakura', kind: 'skin', rarity: '보통', name: skin('벚꽃', 'Cherry Blossom') },
  { id: 'skin.beach', kind: 'skin', rarity: '보통', name: skin('해변', 'Beach') },
  { id: 'skin.cabin', kind: 'skin', rarity: '보통', name: skin('눈 오두막', 'Snowy Cabin') },
  { id: 'skin.forest', kind: 'skin', rarity: '보통', name: skin('숲속', 'Forest') },
  { id: 'skin.candy', kind: 'skin', rarity: '보통', name: skin('사탕나라', 'Candyland') },
  { id: 'skin.hanok', kind: 'skin', rarity: '보통', name: skin('한옥', 'Hanok House') },
  { id: 'skin.gameboy', kind: 'skin', rarity: '보통', name: skin('게임보이', 'Retro Handheld') },
  { id: 'skin.cyber', kind: 'skin', rarity: '희귀', name: skin('사이버펑크', 'Cyberpunk') },
  { id: 'skin.halloween', kind: 'skin', rarity: '희귀', name: skin('할로윈', 'Halloween') },
  { id: 'skin.christmas', kind: 'skin', rarity: '희귀', name: skin('크리스마스', 'Christmas') },
  { id: 'skin.desert', kind: 'skin', rarity: '희귀', name: skin('사막', 'Desert') },
  { id: 'skin.dungeon', kind: 'skin', rarity: '희귀', name: skin('지하 던전', 'Dungeon') },
  { id: 'skin.volcano', kind: 'skin', rarity: '전설', name: skin('화산', 'Volcano') },
  { id: 'skin.cloud', kind: 'skin', rarity: '전설', name: skin('구름 위', 'Above the Clouds') },
  { id: 'skin.matcha', kind: 'skin', rarity: '흔함', name: skin('녹차', 'Matcha') },
  { id: 'skin.choco', kind: 'skin', rarity: '흔함', name: skin('초콜릿', 'Chocolate') },
  { id: 'skin.strawberry', kind: 'skin', rarity: '흔함', name: skin('딸기', 'Strawberry') },
  { id: 'skin.pastel', kind: 'skin', rarity: '흔함', name: skin('파스텔', 'Pastel') },
  { id: 'skin.autumn', kind: 'skin', rarity: '보통', name: skin('가을 단풍', 'Autumn Leaves') },
  { id: 'skin.jungle', kind: 'skin', rarity: '보통', name: skin('정글', 'Jungle') },
  { id: 'skin.retro', kind: 'skin', rarity: '보통', name: skin('레트로 80', 'Retro 80s') },
  { id: 'skin.lighthouse', kind: 'skin', rarity: '보통', name: skin('등대', 'Lighthouse') },
  { id: 'skin.rainycity', kind: 'skin', rarity: '보통', name: skin('비 오는 도시', 'Rainy City') },
  { id: 'skin.pirate', kind: 'skin', rarity: '희귀', name: skin('해적선', 'Pirate Ship') },
  { id: 'skin.sakuranight', kind: 'skin', rarity: '희귀', name: skin('밤벚꽃', 'Night Blossoms') },
  { id: 'skin.aurora', kind: 'skin', rarity: '희귀', name: skin('오로라 설원', 'Aurora Tundra') },
  { id: 'skin.palace', kind: 'skin', rarity: '전설', name: skin('황금 궁전', 'Golden Palace') },
  { id: 'skin.nebula', kind: 'skin', rarity: '전설', name: skin('성운 정원', 'Nebula Garden') },
  { id: 'skin.lemon', kind: 'skin', rarity: '흔함', name: skin('레몬', 'Lemon') },
  { id: 'skin.lavender', kind: 'skin', rarity: '흔함', name: skin('라벤더', 'Lavender') },
  { id: 'skin.peach', kind: 'skin', rarity: '흔함', name: skin('복숭아', 'Peach') },
  { id: 'skin.sky', kind: 'skin', rarity: '흔함', name: skin('하늘', 'Sky') },
  { id: 'skin.sand', kind: 'skin', rarity: '흔함', name: skin('모래', 'Sand') },
  { id: 'skin.concrete', kind: 'skin', rarity: '흔함', name: skin('콘크리트', 'Concrete') },
  { id: 'skin.coral', kind: 'skin', rarity: '흔함', name: skin('산호', 'Coral') },
  { id: 'skin.olive', kind: 'skin', rarity: '흔함', name: skin('올리브', 'Olive') },
  { id: 'skin.cream', kind: 'skin', rarity: '흔함', name: skin('크림', 'Cream') },
  { id: 'skin.berry', kind: 'skin', rarity: '흔함', name: skin('블루베리', 'Blueberry') },
  { id: 'skin.snowfield', kind: 'skin', rarity: '보통', name: skin('설원', 'Snowfield') },
  { id: 'skin.rainforest', kind: 'skin', rarity: '보통', name: skin('열대우림', 'Rainforest') },
  { id: 'skin.subway', kind: 'skin', rarity: '보통', name: skin('지하철', 'Subway') },
  { id: 'skin.bakery', kind: 'skin', rarity: '보통', name: skin('빵집', 'Bakery') },
  { id: 'skin.arcade', kind: 'skin', rarity: '보통', name: skin('오락실', 'Arcade') },
  { id: 'skin.hospital', kind: 'skin', rarity: '보통', name: skin('병원', 'Hospital') },
  { id: 'skin.study', kind: 'skin', rarity: '보통', name: skin('공부방', 'Study Room') },
  { id: 'skin.farm', kind: 'skin', rarity: '보통', name: skin('농장', 'Farm') },
  { id: 'skin.tea', kind: 'skin', rarity: '보통', name: skin('찻집', 'Tea House') },
  { id: 'skin.penguin', kind: 'skin', rarity: '보통', name: skin('남극', 'Antarctica') },
  { id: 'skin.lab', kind: 'skin', rarity: '보통', name: skin('연구실', 'Lab') },
  { id: 'skin.garage', kind: 'skin', rarity: '보통', name: skin('차고', 'Garage') },
  { id: 'skin.bamboo', kind: 'skin', rarity: '보통', name: skin('대나무 숲', 'Bamboo Grove') },
  { id: 'skin.icecream', kind: 'skin', rarity: '보통', name: skin('아이스크림', 'Ice Cream') },
  { id: 'skin.underwater', kind: 'skin', rarity: '희귀', name: skin('심해', 'Deep Sea') },
  { id: 'skin.steampunk', kind: 'skin', rarity: '희귀', name: skin('스팀펑크', 'Steampunk') },
  { id: 'skin.vaporwave', kind: 'skin', rarity: '희귀', name: skin('베이퍼웨이브', 'Vaporwave') },
  { id: 'skin.temple', kind: 'skin', rarity: '희귀', name: skin('사찰', 'Temple') },
  { id: 'skin.moonbase', kind: 'skin', rarity: '희귀', name: skin('달 기지', 'Moon Base') },
  { id: 'skin.ninja', kind: 'skin', rarity: '희귀', name: skin('닌자 저택', 'Ninja Manor') },
  { id: 'skin.carnival', kind: 'skin', rarity: '희귀', name: skin('카니발', 'Carnival') },
  { id: 'skin.igloo', kind: 'skin', rarity: '희귀', name: skin('이글루', 'Igloo') },
  { id: 'skin.mushroom', kind: 'skin', rarity: '희귀', name: skin('버섯 마을', 'Mushroom Village') },
  { id: 'skin.midnight', kind: 'skin', rarity: '희귀', name: skin('한밤 도서관', 'Midnight Library') },
  { id: 'skin.dragon', kind: 'skin', rarity: '전설', name: skin('용의 둥지', "Dragon's Nest") },
  { id: 'skin.crystal', kind: 'skin', rarity: '전설', name: skin('수정 동굴', 'Crystal Cave') },
  { id: 'skin.heaven', kind: 'skin', rarity: '전설', name: skin('천국 계단', 'Stairway to Heaven') },
  { id: 'skin.blackhole', kind: 'skin', rarity: '전설', name: skin('블랙홀', 'Black Hole') },
  { id: 'skin.rainbowland', kind: 'skin', rarity: '전설', name: skin('무지개 나라', 'Rainbow Land') },
  { id: 'skin.goldmine', kind: 'skin', rarity: '전설', name: skin('금광', 'Gold Mine') },
  { id: 'furn.sofa', kind: 'furn', rarity: '흔함', name: furn('소파', 'Sofa') },
  { id: 'furn.board', kind: 'furn', rarity: '흔함', name: furn('화이트보드', 'Whiteboard') },
  { id: 'furn.lamp', kind: 'furn', rarity: '흔함', name: furn('스탠드', 'Floor Lamp') },
  { id: 'furn.vending', kind: 'furn', rarity: '보통', name: furn('자판기', 'Vending Machine') },
  { id: 'furn.tank', kind: 'furn', rarity: '보통', name: furn('어항', 'Fish Tank') },
  { id: 'furn.cattower', kind: 'furn', rarity: '보통', name: furn('캣타워', 'Cat Tower') },
  { id: 'furn.arcade', kind: 'furn', rarity: '희귀', name: furn('오락기', 'Arcade Cabinet') },
  { id: 'furn.trophy', kind: 'furn', rarity: '희귀', name: furn('트로피', 'Trophy') },
  { id: 'hat.beanie', kind: 'hat', rarity: '흔함', name: hat('비니', 'Beanie') },
  { id: 'hat.headset', kind: 'hat', rarity: '보통', name: hat('헤드셋', 'Headset') },
  { id: 'hat.straw', kind: 'hat', rarity: '보통', name: hat('밀짚모자', 'Straw Hat') },
  { id: 'hat.crown', kind: 'hat', rarity: '희귀', name: hat('왕관', 'Crown') },
  { id: 'window.rain', kind: 'window', rarity: '흔함', name: view('비', 'Rain') },
  { id: 'window.night', kind: 'window', rarity: '보통', name: view('밤하늘', 'Night Sky') },
  { id: 'window.snow', kind: 'window', rarity: '보통', name: view('눈', 'Snow') },
  { id: 'window.blossom', kind: 'window', rarity: '희귀', name: view('벚꽃', 'Cherry Blossoms') },
  { id: 'window.rainbow', kind: 'window', rarity: '흔함', name: view('무지개', 'Rainbow') },
  { id: 'window.sunset', kind: 'window', rarity: '보통', name: view('노을', 'Sunset') },
  { id: 'window.city', kind: 'window', rarity: '보통', name: view('도시 야경', 'City Lights') },
  { id: 'window.aurora', kind: 'window', rarity: '희귀', name: view('오로라', 'Aurora') },
  { id: 'window.fireworks', kind: 'window', rarity: '희귀', name: view('불꽃놀이', 'Fireworks') },
  { id: 'window.meteor', kind: 'window', rarity: '전설', name: view('별똥별', 'Shooting Star') },
  { id: 'fx.heart', kind: 'fx', rarity: '보통', name: fx('하트', 'Hearts') },
  { id: 'fx.petal', kind: 'fx', rarity: '보통', name: fx('꽃잎', 'Petals') },
  { id: 'fx.firework', kind: 'fx', rarity: '희귀', name: fx('불꽃놀이', 'Fireworks') },
  { id: 'action.coffee', kind: 'action', rarity: '흔함', name: move('커피 타러 감', 'Coffee Run') },
  { id: 'action.dance', kind: 'action', rarity: '보통', name: move('춤', 'Dance') },
  { id: 'friend.cat', kind: 'friend', rarity: '전설', name: pal('사무실 고양이', 'Office Cat') },
];
export const itemOf = (id: string) => CATALOG.find((c) => c.id === id);

export const PRICE = 100;
export const PRICE_TEN = 900;
export const PITY = 50;
/** 중복 환급 — ★5 가 된 뒤의 중복만 50, 그 전엔 10(중복은 별로 쓰인다, 2026-10-04 QA 추천 D) */
export const REFUND = 50;
export const REFUND_LOW = 10;

/** 별 — ★2~★5 가 되는 중복 누적 수. 가진 개수(owned) - 1 = 중복이라 새 저장 칸 없이 옛 파일의 중복도 그대로 별이 된다 */
export const STAR_AT = [1, 3, 6, 10] as const;
export const MAX_STAR = 5;
/** 가진 개수 → 별(0 = 없음, 1~5) */
export const starOf = (count: number): number => (count > 0 ? 1 + STAR_AT.filter((d) => count - 1 >= d).length : 0);
/** 다음 별까지 남은 중복 수 — 없거나 ★5 면 null */
export const nextStar = (count: number): number | null => {
  const next = STAR_AT.find((d) => count - 1 < d);
  return count > 0 && next !== undefined ? next - (count - 1) : null;
};
/** 도감 머리의 별 합계 — 카탈로그에 있는 것만 */
export const starTotal = (f: GachaFile) => ({ have: CATALOG.reduce((n, c) => n + starOf(f.owned[c.id] ?? 0), 0), max: CATALOG.length * MAX_STAR });
const HISTORY = 30;

export type Pulled = { t: number; id: string; dup: boolean };
export type GachaFile = {
  coins: number;
  /** 이미 센 사건 중 가장 늦은 시각(옛 판은 이것 하나로만 셌다) */
  since: number;
  /** 늦게 읽힌 사건(커밋 5분·CI 10분마다 읽고 CI 는 시작 시각) — floor 뒤 사건은 keys 에 없으면 센다.
   *  at = 이걸 쓸 때의 since. 옛 판이 since 만 옮겼으면(되돌렸다 옴) 어긋나서 since 까지를 센 것으로 친다 */
  late?: { floor: number; at: number; keys: string[] };
  /** 하루 소프트 상한 손잡이 — 기본 꺼짐(사용자 2026-10-04 "헤비는 빨라도 된다"). 켜면 today 에 그날 번 원래 코인을 센다 */
  softCap?: boolean;
  today?: { start: number; raw: number };
  owned: Record<string, number>;
  /** 마지막 전설 뒤로 뽑은 횟수 — PITY 번째는 전설 */
  pity: number;
  shards: number;
  history: Pulled[];
  /** 장착한 것 — 모자(반장)·창밖·펑 대신·반장 액션. 가구·펫 친구는 가지면 늘 나온다 */
  equip: Partial<Record<EquipKind, string>>;
  /** 가구 놓기 — 칸 [gx, gy], null = 창고. 없으면 휴게실 자동 자리 */
  placed?: Record<string, [number, number] | null>;
};
export type EquipKind = 'hat' | 'window' | 'fx' | 'action';
const EQUIPPABLE: ItemKind[] = ['hat', 'window', 'fx', 'action'];
export const EMPTY_GACHA: GachaFile = { coins: 0, since: 0, owned: {}, pity: 0, shards: 0, history: [], equip: {} };

/** 파일 글자 → 상태. 없거나 깨졌으면 빈 상태에 since 만 채운다(처음 켠 날 새벽 5시부터 세려고) */
export function parseGacha(text: string, since: number): GachaFile {
  try {
    const v = JSON.parse(text) as Partial<GachaFile>;
    if (typeof v.coins !== 'number' || typeof v.since !== 'number') return { ...EMPTY_GACHA, since };
    const l = v.late;
    const late = l && typeof l.floor === 'number' && typeof l.at === 'number' && Array.isArray(l.keys) ? l : undefined;
    return { ...EMPTY_GACHA, ...v, owned: v.owned ?? {}, history: v.history ?? [], equip: v.equip ?? {}, late } as GachaFile;
  } catch {
    return { ...EMPTY_GACHA, since };
  }
}

/** 코인 버는 법(뽑기 화면 표) — coinsFor 와 같은 값이어야 한다(테스트가 맞춘다). 끝낸 일 상한은 tama/sources.balanceFeed */
export const COIN_RULES: [number, string][] = [
  [10, tr('머지 · 결과물', 'Merge · result')],
  [3, tr('시킨 일 끝남', 'Task done')],
  [2, tr('CI 통과 · 검토 · 예약 · 테스트 든 커밋', 'CI pass · review · schedule · commit with tests')],
  [1, tr('300줄 이하 커밋 · 대화 · 문서', 'Commit ≤300 lines · talk · doc')],
];
/** 상한 — 구절마다 끊기지 않게 배열로 */
export const COIN_LIMITS: string[] = [
  tr(`결과물 하루 ${SHOW_PER_DAY}`, `Results ${SHOW_PER_DAY}/day`),
  tr('대화·문서 한 시간 1', 'Talk & docs 1/hour'),
  tr(`커밋·머지·CI 말고는 하루 ${DAY_EXTRA}건까지`, `Besides commits, merges and CI: ${DAY_EXTRA}/day`),
];

/** 사건 하나의 코인 — 다마고치 먹이와 같은 '끝낸 일' 통. 마무리(머지·결과물) 10 · 시킨 일 끝남 3 · 검사 통과(CI·예약·시안 검토) 2
 *  · 테스트 커밋 2 · 작은 일(+300줄 이하 커밋·대화·문서 고침) 1. 메아리(같은 일 두 번·하루 상한 넘음, tama/sources.balanceFeed)는 0 */
function coinsFor(e: TamaEvent): number {
  if (e.echo) return 0;
  switch (e.type) {
    case 'show': return 10;
    case 'routine': return e.pass ? 2 : 0;
    case 'review': return 2;
    case 'talk': case 'doc': return 1;
    case 'pr': return 10;
    case 'task': return 3;
    case 'ci': return e.pass ? 2 : 0;
    case 'commit': return (e.hasTest ? 2 : 0) + (e.lines <= 300 ? 1 : 0);
    default: return 0;
  }
}

/** 늦게 온 사건을 얼마나 기다리나 — 그보다 늦으면 안 센다(키를 무한히 쌓지 않게) */
export const LATE_MS = 86_400_000;
const KIND: Record<TamaEvent['type'], string> = { commit: 'c', ci: 'i', pr: 'p', task: 't', show: 's', talk: 'k', routine: 'r', doc: 'd', review: 'v', work: 'w' };
const keyT = (k: string) => parseInt(k.slice(1), 36);

/** 하루 소프트 상한 — 200 까지 그대로, 600 까지 절반, 그 위 1/5. 끝수가 새지 않게 '누적 지급액'의 차로 준다 */
const SOFT = [[200, 1], [600, 0.5], [Infinity, 0.2]] as const;
const softTotal = (raw: number) => {
  let paid = 0, from = 0;
  for (const [to, rate] of SOFT) { paid += (Math.min(raw, to) - from) * rate; if (raw <= to) break; from = to; }
  return Math.floor(paid + 1e-9);
};
/** 그날 이미 raw 만큼 번 뒤에 add 를 더 벌면 실제로 받는 코인 */
export const softPay = (raw: number, add: number) => softTotal(raw + add) - softTotal(raw);

export function earn(f: GachaFile, events: TamaEvent[], _now: number): { file: GachaFile; gained: number } {
  // 처음(옛 파일)이거나 옛 판이 since 를 옮겼으면 since 까지는 이미 센 것 — 지난 구멍은 소급하지 않는다
  const fresh = !f.late || f.late.at !== f.since;
  const floor = fresh ? f.since : f.late!.floor;
  const seen = new Set(fresh ? [] : f.late!.keys);
  const nth = new Map<string, number>();
  let gained = 0, since = f.since;
  let today = f.today ?? { start: 0, raw: 0 };
  const added: string[] = [];
  for (const e of events) {
    if (e.t <= floor) continue;
    const base = KIND[e.type] + e.t.toString(36);
    const n = nth.get(base) ?? 0;
    nth.set(base, n + 1);
    const key = n ? `${base}~${n}` : base; // 같은 시각·같은 종류가 여럿이면 몇 번째인지로
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(key);
    const c = coinsFor(e);
    if (f.softCap && c) {
      const day = dayStartAt(e.t);
      if (day > today.start) today = { start: day, raw: 0 };
      gained += softPay(today.raw, c);
      today = { ...today, raw: today.raw + c };
    } else gained += c;
    since = Math.max(since, e.t);
  }
  if (!added.length && !fresh) return { file: f, gained: 0 };
  const nextFloor = Math.max(floor, since - LATE_MS);
  const keys = [...seen].filter((k) => keyT(k) > nextFloor);
  return { file: { ...f, coins: f.coins + gained, since, late: { floor: nextFloor, at: since, keys }, ...(f.softCap ? { today } : {}) }, gained };
}

export function rollRarity(x: number): Rarity {
  return x < 0.6 ? '흔함' : x < 0.88 ? '보통' : x < 0.98 ? '희귀' : '전설';
}

const pick = (rarity: Rarity, x: number): Item => {
  const list = CATALOG.filter((c) => c.rarity === rarity);
  return list[Math.min(list.length - 1, Math.floor(x * list.length))]!;
};

/** star = 뽑은 뒤 별, up = 이번에 별이 올랐나 */
export type PullResult = { id: string; rarity: Rarity; name: string; dup: boolean; refund: number; star: number; up: boolean };

/** n = 1 | 10. rng 는 0~1 (테스트에서 고정). 코인이 모자라면 null */
export function pull(f: GachaFile, n: 1 | 10, rng: () => number, now = Date.now()): { file: GachaFile; results: PullResult[] } | null {
  const cost = n === 10 ? PRICE_TEN : PRICE;
  if (f.coins < cost) return null;
  const owned = { ...f.owned };
  let pity = f.pity, shards = f.shards, refund = 0;
  const rarities: Rarity[] = [];
  for (let i = 0; i < n; i++) {
    pity += 1;
    let r = rollRarity(rng());
    if (pity >= PITY) r = '전설';
    if (r === '전설') pity = 0;
    rarities.push(r);
  }
  // 10연: 희귀 이상 하나 보장 — 없으면 마지막을 희귀로
  if (n === 10 && !rarities.some((r) => r === '희귀' || r === '전설')) rarities[9] = '희귀';
  const results = rarities.map((r): PullResult => {
    const item = pick(r, rng());
    const had = owned[item.id] ?? 0;
    const dup = had > 0;
    owned[item.id] = had + 1;
    // 이미 ★5 인 것의 중복만 50. 조각은 이제 화면에 안 쓰지만 옛 판으로 되돌려도 숫자가 맞게 계속 센다
    const back = !dup ? 0 : starOf(had) === MAX_STAR ? REFUND : REFUND_LOW;
    if (dup) { refund += back; shards += 1; }
    const star = starOf(had + 1);
    return { id: item.id, rarity: r, name: item.name, dup, refund: back, star, up: dup && star > starOf(had) };
  });
  const history = [...f.history, ...results.map((x) => ({ t: now, id: x.id, dup: x.dup }))].slice(-HISTORY);
  return { file: { ...f, coins: f.coins - cost + refund, owned, pity, shards, history }, results };
}

/** 사무실에서 고를 수 있는 스킨 — 나무는 처음부터 */
export function ownedSkins(f: GachaFile): string[] {
  return ['wood', ...CATALOG.filter((c) => c.kind === 'skin' && (f.owned[c.id] ?? 0) > 0).map((c) => c.id.slice(5))];
}

/** 하루 = 새벽 5시부터(하루 리플레이·작업 패널과 같은 기준). 처음 켠 날의 코인 시작점 */
export function dayStartAt(now: number): number {
  const d = new Date(now);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
}

/** 도감에서 누르기 — 가진 모자·창밖·이펙트·반장 액션을 장착(같은 종류는 바꿔 낌), 같은 걸 또 누르면 해제 */
export function toggleEquip(f: GachaFile, id: string): GachaFile {
  const it = itemOf(id);
  if (!it || !EQUIPPABLE.includes(it.kind) || !(f.owned[id] ?? 0)) return f;
  const kind = it.kind as EquipKind;
  const equip = { ...f.equip };
  if (equip[kind] === id) delete equip[kind]; else equip[kind] = id;
  return { ...f, equip };
}

/** 가진 것(여러 개여도 하나씩), 도감 순서 */
export const ownedOf = (f: GachaFile, kind: ItemKind) => CATALOG.filter((c) => c.kind === kind && (f.owned[c.id] ?? 0) > 0).map((c) => c.id);

/** 가구 놓기 — 가진 가구를 칸에(null = 창고로). 그 칸에 있던 다른 가구는 창고로 */
export function place(f: GachaFile, id: string, cell: [number, number] | null): GachaFile {
  if (itemOf(id)?.kind !== 'furn' || !(f.owned[id] ?? 0)) return f;
  const placed = { ...(f.placed ?? {}) };
  if (cell) for (const [k, v] of Object.entries(placed)) if (k !== id && v && v[0] === cell[0] && v[1] === cell[1]) placed[k] = null;
  placed[id] = cell;
  return { ...f, placed };
}
