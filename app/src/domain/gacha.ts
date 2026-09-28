// 머지 가챠 — 일한 만큼 코인이 쌓이고, 뽑고 싶을 때 뽑는다. 순수 TS. 시안 docs/design-drafts/pixel-office v2(규칙·풀)·v3(연출)
// 저장은 ~/.honor-orchestrator/gacha.json (다마고치 tama.json 과 같은 방식)

import { tr } from '../i18n';
import type { TamaEvent } from './tama/pet';

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
export const REFUND = 50;
const HISTORY = 30;

export type Pulled = { t: number; id: string; dup: boolean };
export type GachaFile = {
  coins: number;
  /** 이 시각 이후의 사건만 코인으로 센다(이미 센 것 다시 안 셈) */
  since: number;
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
    return { ...EMPTY_GACHA, ...v, owned: v.owned ?? {}, history: v.history ?? [], equip: v.equip ?? {} } as GachaFile;
  } catch {
    return { ...EMPTY_GACHA, since };
  }
}

/** 사건 하나의 코인 — 머지 10 · 시킨 일 끝남 3 · CI 통과 2 · 테스트 커밋 2 · +300줄 이하 커밋 1(쪼갠 커밋 습관) */
function coinsFor(e: TamaEvent): number {
  switch (e.type) {
    case 'pr': return 10;
    case 'task': return 3;
    case 'ci': return e.pass ? 2 : 0;
    case 'commit': return (e.hasTest ? 2 : 0) + (e.lines <= 300 ? 1 : 0);
    default: return 0;
  }
}

export function earn(f: GachaFile, events: TamaEvent[], _now: number): { file: GachaFile; gained: number } {
  let gained = 0, since = f.since;
  for (const e of events) {
    if (e.t <= f.since) continue;
    gained += coinsFor(e);
    since = Math.max(since, e.t);
  }
  return { file: gained || since !== f.since ? { ...f, coins: f.coins + gained, since } : f, gained };
}

export function rollRarity(x: number): Rarity {
  return x < 0.6 ? '흔함' : x < 0.88 ? '보통' : x < 0.98 ? '희귀' : '전설';
}

const pick = (rarity: Rarity, x: number): Item => {
  const list = CATALOG.filter((c) => c.rarity === rarity);
  return list[Math.min(list.length - 1, Math.floor(x * list.length))]!;
};

export type PullResult = { id: string; rarity: Rarity; name: string; dup: boolean; refund: number };

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
    const dup = (owned[item.id] ?? 0) > 0;
    owned[item.id] = (owned[item.id] ?? 0) + 1;
    if (dup) { refund += REFUND; shards += 1; }
    return { id: item.id, rarity: r, name: item.name, dup, refund: dup ? REFUND : 0 };
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
