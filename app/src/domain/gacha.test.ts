import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { CATALOG, COIN_RULES, dayStartAt, earn, EMPTY_GACHA, starOf, starTotal, nextStar, softPay, ownedOf, ownedSkins, parseGacha, place, pull, rarityLabel, rollRarity, seeItem, setSkin, skinOfFile, toggleEquip, type GachaFile } from './gacha';

const rngOf = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };
const withCoins = (coins: number, extra: Partial<GachaFile> = {}): GachaFile => ({ ...EMPTY_GACHA, coins, ...extra });

describe('earn — 코인은 일한 만큼(다마고치 먹이와 같은 사건)', () => {
  it('PR 머지 10 · 시킨 일 끝남 3 · CI 첫 통과 2 · 테스트 커밋 2 · +300줄 이하 커밋 1', () => {
    const f = withCoins(0, { since: 0 });
    const r = earn(f, [
      { t: 10, type: 'pr' },
      { t: 11, type: 'task' },
      { t: 12, type: 'ci', pass: true },
      { t: 13, type: 'ci', pass: false },
      { t: 14, type: 'commit', lines: 120, hasTest: true },
      { t: 15, type: 'commit', lines: 900, hasTest: false },
    ], 100);
    expect(r.gained).toBe(10 + 3 + 2 + (2 + 1) + 0);
    expect(r.file.coins).toBe(18);
  });

  it('이미 센 사건(since 이전)은 다시 안 센다', () => {
    const f = withCoins(5, { since: 50 });
    const r = earn(f, [{ t: 40, type: 'pr' }, { t: 60, type: 'pr' }], 100);
    expect(r.gained).toBe(10);
    expect(r.file.since).toBe(60);
  });

  it('끝낸 일도 같은 통 — 결과물 10 · 예약 성공 2 · 시안 검토 2 · 대화 1 · 문서 고침 1, 메아리는 0', () => {
    const r = earn(withCoins(0, { since: 0 }), [
      { t: 10, type: 'show' },
      { t: 11, type: 'routine', pass: true },
      { t: 12, type: 'routine', pass: false },
      { t: 13, type: 'review' },
      { t: 14, type: 'talk' },
      { t: 15, type: 'doc' },
      { t: 16, type: 'task', echo: true },
      { t: 17, type: 'show', echo: true },
    ], 100);
    expect(r.gained).toBe(10 + 2 + 0 + 2 + 1 + 1);
    expect(r.file.since).toBe(17);
  });

  it('옛 gacha.json(새 칸 없음)도 그대로 읽고, 이미 센 시각 앞의 새 갈래 사건은 소급하지 않는다', () => {
    const old = parseGacha(JSON.stringify({ coins: 42, since: 1000, owned: {}, pity: 3, shards: 0, history: [] }), 0);
    expect(old.coins).toBe(42);
    expect(earn(old, [{ t: 900, type: 'show' }, { t: 950, type: 'talk' }], 2000).gained).toBe(0);
  });

  it('일한 시간(work)은 코인이 아니다', () => {
    expect(earn(withCoins(0, { since: 0 }), [{ t: 5, type: 'work', minutes: 30 }], 10).gained).toBe(0);
  });

  // 늦게 읽힌 사건(2026-10-04 QA 1번) — 대화·시킨 일은 1분, 커밋은 5분, CI 는 10분마다 읽고 CI 는 시작 시각으로 찍힌다
  it('대화가 먼저 들어와 since 가 앞으로 가도, 그 뒤 늦게 읽힌 커밋·CI 는 센다', () => {
    const first = earn(withCoins(0, { since: 0 }), [{ t: 1000, type: 'talk' }], 1000).file;
    const r = earn(first, [
      { t: 1000, type: 'talk' },
      { t: 900, type: 'commit', lines: 50, hasTest: true },
      { t: 800, type: 'ci', pass: true },
    ], 1100);
    expect(r.gained).toBe(3 + 2);
    expect(r.file.coins).toBe(1 + 3 + 2);
  });

  it('같은 사건을 몇 번 다시 읽어도 한 번만 센다', () => {
    const evs = [{ t: 1000, type: 'talk' as const }];
    let f = earn(withCoins(0, { since: 0 }), evs, 1000).file;
    const late = [...evs, { t: 900, type: 'pr' as const }, { t: 950, type: 'ci' as const, pass: true }];
    f = earn(f, late, 1100).file;
    const again = earn(f, late, 1200);
    expect(again.gained).toBe(0);
    expect(again.file.coins).toBe(1 + 10 + 2);
  });

  it('같은 시각·같은 종류 사건이 둘이면 둘 다, 다시 읽어도 둘만', () => {
    const evs = [{ t: 500, type: 'pr' as const }, { t: 500, type: 'pr' as const }];
    const a = earn(withCoins(0, { since: 0 }), evs, 600);
    expect(a.gained).toBe(20);
    expect(earn(a.file, evs, 700).gained).toBe(0);
  });

  it('하루보다 더 늦게 온 사건은 세지 않고, 기억해 둔 키는 하루치만 남긴다', () => {
    const DAY = 86_400_000;
    let f = earn(withCoins(0, { since: 0 }), [{ t: 1, type: 'pr' }], 1).file;
    f = earn(f, [{ t: 3 * DAY, type: 'talk' }], 3 * DAY).file;
    expect(earn(f, [{ t: 2 * DAY - 10, type: 'pr' }], 3 * DAY).gained).toBe(0);
    expect(earn(f, [{ t: 2 * DAY + 10, type: 'pr' }], 3 * DAY).gained).toBe(10);
    expect(JSON.stringify(f)).not.toContain('"p1'); // 하루 넘게 지난 키는 지운다
  });

  it('옛 파일(늦은 사건 칸 없음)은 since 까지를 이미 센 것으로 — 지난 구멍은 소급하지 않는다', () => {
    const old = parseGacha(JSON.stringify({ coins: 42, since: 1000, owned: {}, pity: 0, shards: 0, history: [] }), 0);
    const r = earn(old, [{ t: 900, type: 'pr' }, { t: 1100, type: 'talk' }], 1200);
    expect(r.gained).toBe(1);
    expect(earn(r.file, [{ t: 1050, type: 'pr' }, { t: 1100, type: 'talk' }], 1300).gained).toBe(10);
  });

  it('늦은 사건 칸이 깨졌으면 버리고 since 까지를 센 것으로', () => {
    const f = parseGacha(JSON.stringify({ coins: 1, since: 1000, owned: {}, pity: 0, shards: 0, history: [], late: { floor: 0, at: 1000, keys: 'x' } }), 0);
    expect(f.late).toBeUndefined();
    expect(earn(f, [{ t: 900, type: 'pr' }, { t: 1100, type: 'pr' }], 1200).gained).toBe(10);
  });

  it('옛 판으로 되돌렸다 온 파일(since 만 앞으로 감)은 그 since 까지를 센 것으로 — 두 번 세지 않는다', () => {
    const f = earn(withCoins(0, { since: 0 }), [{ t: 1000, type: 'talk' }], 1000).file;
    // 옛 판은 since 만 알고 earn 해서 since 를 2000 으로 옮겼다(그 사이 900 의 PR 은 옛 판이 셌다고 친다)
    const rolled: GachaFile = { ...f, since: 2000, coins: f.coins + 10 };
    expect(earn(rolled, [{ t: 900, type: 'pr' }, { t: 1500, type: 'pr' }, { t: 2500, type: 'pr' }], 2600).gained).toBe(10);
  });
});

describe('rollRarity — 흔함 60 · 보통 28 · 희귀 10 · 전설 2', () => {
  it('경계값', () => {
    expect(rollRarity(0)).toBe('흔함');
    expect(rollRarity(0.599)).toBe('흔함');
    expect(rollRarity(0.6)).toBe('보통');
    expect(rollRarity(0.88)).toBe('희귀');
    expect(rollRarity(0.98)).toBe('전설');
  });
});

describe('pull — 뽑기', () => {
  it('한 번 = 코인 100, 코인이 모자라면 못 뽑는다', () => {
    expect(pull(withCoins(99), 1, rngOf(0.1, 0))).toBeNull();
    const r = pull(withCoins(250), 1, rngOf(0.1, 0))!;
    expect(r.file.coins).toBe(150);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.rarity).toBe('흔함');
    expect(r.file.owned[r.results[0]!.id]).toBe(1);
  });

  it('중복이면 별이 오른다(★5 전엔 코인 10만 돌려받음) — 조각은 옛 판을 위해 그대로 센다', () => {
    const first = pull(withCoins(300), 1, rngOf(0.1, 0))!;
    expect(first.results[0]).toMatchObject({ dup: false, star: 1, up: false, refund: 0 });
    const again = pull(first.file, 1, rngOf(0.1, 0))!;
    expect(again.results[0]).toMatchObject({ dup: true, star: 2, up: true, refund: 10 });
    expect(again.file.coins).toBe(300 - 100 - 100 + 10);
    expect(again.file.shards).toBe(1);
  });

  it('★5(중복 10) 뒤의 중복은 코인 50 — 별은 ★5 에서 멈춘다', () => {
    const id = pull(withCoins(100), 1, rngOf(0.1, 0))!.results[0]!.id;
    const at = (n: number) => pull(withCoins(100, { owned: { [id]: n } }), 1, rngOf(0.1, 0))!.results[0]!;
    expect(at(10)).toMatchObject({ star: 5, up: true, refund: 10 }); // 중복 9 → 10 = ★5 가 되는 판
    expect(at(11)).toMatchObject({ star: 5, up: false, refund: 50 });
    expect(at(4)).toMatchObject({ star: 3, up: false, refund: 10 }); // 중복 3 → 4 는 아직 ★3
  });

  it('10번 = 900, 희귀 이상이 하나도 없으면 마지막이 희귀로', () => {
    const r = pull(withCoins(900), 10, rngOf(0.1, 0))!;
    expect(r.file.coins).toBe(r.results.reduce((n, x) => n + x.refund, 0)); // 900 - 900 + 중복 환급
    expect(r.results).toHaveLength(10);
    expect(r.results.filter((x) => x.rarity === '희귀' || x.rarity === '전설').length).toBeGreaterThanOrEqual(1);
    expect(r.results[9]!.rarity).toBe('희귀');
  });

  it('천장: 50번째까지 전설이 없으면 50번째는 전설, 전설이 나오면 다시 0부터', () => {
    const r = pull(withCoins(100, { pity: 49 }), 1, rngOf(0.1, 0))!;
    expect(r.results[0]!.rarity).toBe('전설');
    expect(r.file.pity).toBe(0);
    const s = pull(withCoins(100, { pity: 10 }), 1, rngOf(0.1, 0))!;
    expect(s.file.pity).toBe(11);
  });

  it('뽑은 기록은 최근 30개까지', () => {
    let f = withCoins(100 * 40);
    for (let i = 0; i < 40; i++) f = pull(f, 1, rngOf(0.1, i / 40))!.file;
    expect(f.history).toHaveLength(30);
  });
});

describe('도감·스킨', () => {
  it('모든 아이템 id 는 겹치지 않고 등급이 있다', () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const r of ['흔함', '보통', '희귀', '전설'] as const) expect(CATALOG.some((c) => c.rarity === r)).toBe(true);
  });
  it('나무는 처음부터, 나머지 스킨은 뽑아야 열린다', () => {
    expect(ownedSkins(EMPTY_GACHA)).toEqual(['wood']);
    expect(ownedSkins({ ...EMPTY_GACHA, owned: { 'skin.neon': 1, 'furn.sofa': 2 } })).toEqual(['wood', 'neon']);
  });
  it('파일이 없거나 깨졌으면 빈 상태 — 코인 시작점은 부르는 쪽이 정한다', () => {
    expect(parseGacha('', 777)).toEqual({ ...EMPTY_GACHA, since: 777 });
    expect(parseGacha('{"coins":5', 777).coins).toBe(0);
    expect(parseGacha('{"coins":5,"since":1,"owned":{"skin.mint":1},"pity":3,"shards":0,"history":[]}', 777)).toMatchObject({ coins: 5, since: 1, pity: 3 });
  });
});

describe('dayStartAt — 코인 시작점 = 그날 새벽 5시', () => {
  it('5시 넘었으면 오늘 5시, 전이면 어제 5시', () => {
    expect(dayStartAt(new Date(2026, 8, 27, 22).getTime())).toBe(new Date(2026, 8, 27, 5).getTime());
    expect(dayStartAt(new Date(2026, 8, 28, 3).getTime())).toBe(new Date(2026, 8, 27, 5).getTime());
  });
});

describe('toggleEquip — 모자·창밖·이펙트·반장 액션은 종류마다 하나 장착', () => {
  const f = { ...EMPTY_GACHA, owned: { 'hat.crown': 1, 'hat.beanie': 1, 'furn.sofa': 1, 'window.snow': 1 } };
  it('가진 걸 누르면 장착, 같은 걸 또 누르면 해제', () => {
    const a = toggleEquip(f, 'hat.crown');
    expect(a.equip).toEqual({ hat: 'hat.crown' });
    expect(toggleEquip(a, 'hat.crown').equip).toEqual({});
  });
  it('같은 종류 다른 걸 누르면 바꿔 낀다, 다른 종류는 같이', () => {
    const a = toggleEquip(toggleEquip(f, 'hat.crown'), 'hat.beanie');
    expect(toggleEquip(a, 'window.snow').equip).toEqual({ hat: 'hat.beanie', window: 'window.snow' });
  });
  it('안 가진 것·가구(늘 놓임)는 못 낀다', () => {
    expect(toggleEquip(f, 'hat.straw')).toBe(f);
    expect(toggleEquip(f, 'furn.sofa')).toBe(f);
  });
  it('가진 가구 목록(여러 개여도 하나씩)', () => {
    expect(ownedOf({ ...f, owned: { 'furn.sofa': 3, 'furn.lamp': 1, 'hat.crown': 1 } }, 'furn')).toEqual(['furn.sofa', 'furn.lamp']);
  });
});

describe('스킨도 장착 한 곳(equip.skin) — 도감·스킨 화면이 같은 상태를 본다(2026-10-10 사용자: 따로 따로 먹는다)', () => {
  const f = { ...EMPTY_GACHA, owned: { 'skin.neon': 1, 'skin.mint': 2 } };
  it('스킨 화면에서 고르면 equip.skin, 나무는 기본이라 비운다', () => {
    const a = setSkin(f, 'neon');
    expect(a.equip).toEqual({ skin: 'skin.neon' });
    expect(skinOfFile(a)).toBe('neon');
    expect(setSkin(a, 'wood').equip).toEqual({});
    expect(skinOfFile(setSkin(a, 'wood'))).toBe('wood');
  });
  it('도감에서 누르면 같은 칸 — 입은 걸 또 누르면 나무로', () => {
    const a = toggleEquip(f, 'skin.mint');
    expect(skinOfFile(a)).toBe('mint');
    expect(skinOfFile(toggleEquip(a, 'skin.mint'))).toBe('wood');
  });
  it('안 가진 스킨은 못 입고, 장착 칸에 안 가진 게 있어도 나무로 보인다', () => {
    expect(setSkin(f, 'space')).toBe(f);
    expect(skinOfFile({ ...f, equip: { skin: 'skin.space' } })).toBe('wood');
  });
});

describe('NEW — 처음 얻고 아직 안 눌러 본 것(gacha.json fresh — 폰·PC 같은 파일)', () => {
  const rich = { ...EMPTY_GACHA, coins: 1000, owned: { 'skin.mint': 1 } };
  const rng = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };
  it('뽑아서 처음 얻은 것만 NEW — 중복(별)은 안 붙는다', () => {
    const r = pull(rich, 1, rng([0.0, 0.0]))!; // 흔함 첫 번째
    expect(r.results[0]!.dup).toBe(false);
    expect(r.file.fresh).toEqual([r.results[0]!.id]);
    const again = pull(r.file, 1, rng([0.0, 0.0]))!;
    expect(again.results[0]!.dup).toBe(true);
    expect(again.file.fresh).toEqual([r.results[0]!.id]);
  });
  it('눌러 보면 꺼진다 — 없는 걸 누르면 그대로', () => {
    const f = { ...rich, fresh: ['hat.crown', 'skin.neon'] };
    expect(seeItem(f, 'hat.crown').fresh).toEqual(['skin.neon']);
    expect(seeItem(f, 'furn.sofa')).toBe(f);
  });
  it('옛 파일(fresh 없음)은 가진 게 많아도 NEW 가 쏟아지지 않는다', () => {
    expect(parseGacha(JSON.stringify({ ...rich, since: 1 }), 0).fresh ?? []).toEqual([]);
  });
});

describe('새 종류 — 책상 소품·칭호·조명(2026-10-10 사용자: 뽑기 종류 더)', () => {
  const kinds = ['desk', 'title', 'light'] as const;
  it('종류마다 넷 이상, 등급이 섞여 있다(흔함만 있으면 금방 다 모은다)', () => {
    for (const k of kinds) {
      const list = CATALOG.filter((c) => c.kind === k);
      expect(list.length, k).toBeGreaterThanOrEqual(4);
      expect(new Set(list.map((c) => c.rarity)).size, k).toBeGreaterThanOrEqual(3);
    }
  });
  it('종류마다 하나씩 장착 — 같은 종류는 바꿔 낀다', () => {
    const ids = kinds.map((k) => CATALOG.find((c) => c.kind === k)!.id);
    const f = { ...EMPTY_GACHA, owned: Object.fromEntries(CATALOG.filter((c) => (kinds as readonly string[]).includes(c.kind)).map((c) => [c.id, 1])) };
    const a = ids.reduce((g, id) => toggleEquip(g, id), f as GachaFile);
    expect(Object.keys(a.equip).sort()).toEqual(['desk', 'light', 'title']);
    const other = CATALOG.filter((c) => c.kind === 'desk')[1]!.id;
    expect(toggleEquip(a, other).equip.desk).toBe(other);
  });
  it('확률표는 그대로 — 스킨이 여전히 풀의 대부분(새 종류가 스킨 뽑을 맛을 빼앗지 않게)', () => {
    const share = CATALOG.filter((c) => (kinds as readonly string[]).includes(c.kind)).length / CATALOG.length;
    expect(share).toBeLessThan(0.2);
    expect(rollRarity(0.59)).toBe('흔함');
  });
});

describe('place — 가구 놓기', () => {
  const f = { ...EMPTY_GACHA, owned: { 'furn.sofa': 1, 'furn.lamp': 1 } };
  it('가진 가구를 칸에 놓고, null 이면 창고로', () => {
    const a = place(f, 'furn.sofa', [3, 4]);
    expect(a.placed).toEqual({ 'furn.sofa': [3, 4] });
    expect(place(a, 'furn.sofa', null).placed).toEqual({ 'furn.sofa': null });
  });
  it('안 가진 가구·가구 아닌 건 못 놓는다', () => {
    expect(place(f, 'furn.tank', [1, 1])).toBe(f);
    expect(place({ ...f, owned: { 'hat.crown': 1 } }, 'hat.crown', [1, 1]).placed ?? {}).toEqual({});
  });
  it('이미 다른 가구가 있는 칸에 놓으면 그 가구는 창고로', () => {
    const a = place(place(f, 'furn.sofa', [3, 4]), 'furn.lamp', [3, 4]);
    expect(a.placed).toEqual({ 'furn.sofa': null, 'furn.lamp': [3, 4] });
  });
});

describe('영어 — 등급·아이템 이름', () => {
  afterEach(() => { setLang('ko'); vi.resetModules(); });
  it('등급 글자만 바뀌고 등급 키(흔함…)는 그대로', () => {
    expect(rarityLabel('전설')).toBe('전설');
    setLang('en');
    expect(rarityLabel('흔함')).toBe('Common');
    expect(rarityLabel('전설')).toBe('Legendary');
    expect(rollRarity(0.99)).toBe('전설');
  });
  it('카탈로그 이름은 모듈을 불러올 때의 언어 — 영어도 "<종류> — <이름>" 모양', async () => {
    vi.resetModules();
    const i18n = await import('../i18n');
    i18n.setLang('en');
    const g = await import('./gacha');
    expect(g.itemOf('skin.space')?.name).toBe('Room skin — Space Station');
    expect(g.itemOf('friend.cat')?.name).toBe('Pet pal — Office Cat');
    for (const c of g.CATALOG) expect(c.name, c.id).toMatch(/^[\x20-\x7e]+ — [\x20-\x7e]+$/);
    i18n.setLang('ko');
  });
});

describe('별 — 중복을 별로(★2~★5 = 중복 누적 1·3·6·10)', () => {
  it('가진 개수(owned) → 별. 없으면 0, 하나면 ★1', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 99].map(starOf)).toEqual([0, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5]);
  });

  it('다음 별까지 남은 중복 — ★5 면 null', () => {
    expect(nextStar(1)).toBe(1);
    expect(nextStar(2)).toBe(2);
    expect(nextStar(7)).toBe(4);
    expect(nextStar(11)).toBeNull();
    expect(nextStar(0)).toBeNull();
  });

  it('남아 있던 조각(옛 중복)은 owned 숫자에 이미 들어 있어 새 저장 없이 별로 — 잃는 것 없음', () => {
    const old = parseGacha(JSON.stringify({ coins: 5, since: 1, owned: { 'skin.mint': 4, 'skin.cafe': 1, 'furn.sofa': 12 }, pity: 0, shards: 14, history: [] }), 0);
    expect(starOf(old.owned['skin.mint']!)).toBe(3);
    expect(starTotal(old)).toEqual({ have: 3 + 1 + 5, max: CATALOG.length * 5 });
  });

  it('별 합계는 카탈로그에 없는 옛 id 를 세지 않는다', () => {
    expect(starTotal(withCoins(0, { owned: { 'skin.gone': 30 } })).have).toBe(0);
  });
});


describe('softPay — 하루 소프트 상한 손잡이(기본 꺼짐): 200 까지 그대로, 600 까지 절반, 그 위 1/5', () => {
  it('구간 경계', () => {
    expect(softPay(0, 200)).toBe(200);
    expect(softPay(200, 400)).toBe(200);
    expect(softPay(600, 100)).toBe(20);
    expect(softPay(0, 1500)).toBe(200 + 200 + 180);
  });

  it('조금씩 나눠 받아도 한 번에 받은 것과 같다(끝수 안 샘)', () => {
    let raw = 0, paid = 0;
    for (let i = 0; i < 1500; i++) { paid += softPay(raw, 1); raw += 1; }
    expect(paid).toBe(softPay(0, 1500));
  });

  it('꺼져 있으면(기본) 그대로, 켜면 그날 몫만 줄고 다음 날 다시 200 까지 그대로', () => {
    const H = 3_600_000;
    const day0 = dayStartAt(new Date(2026, 9, 4, 12).getTime());
    const prs = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ t: from + i * 1000, type: 'pr' as const }));
    const ev = prs(day0 + H, 30); // 300 코인
    expect(earn(withCoins(0, { since: day0 }), ev, day0 + 2 * H).gained).toBe(300);
    const on = earn(withCoins(0, { since: day0, softCap: true }), ev, day0 + 2 * H);
    expect(on.gained).toBe(250);
    const next = earn(on.file, [...ev, ...prs(day0 + 25 * H, 10)], day0 + 26 * H);
    expect(next.gained).toBe(100);
  });
});

describe('코인 버는 법 표 — 화면 글과 실제 계산이 같다', () => {
  it('표의 숫자가 earn 과 맞다', () => {
    const one = (e: Parameters<typeof earn>[1][number]) => earn(withCoins(0, { since: 0 }), [e], 10).gained;
    const val = Object.fromEntries(COIN_RULES.map(([n]) => [n, n]));
    expect(one({ t: 1, type: 'pr' })).toBe(val[10]);
    expect(one({ t: 1, type: 'show' })).toBe(val[10]);
    expect(one({ t: 1, type: 'task' })).toBe(val[3]);
    expect([one({ t: 1, type: 'ci', pass: true }), one({ t: 1, type: 'review' }), one({ t: 1, type: 'routine', pass: true }), one({ t: 1, type: 'commit', lines: 900, hasTest: true })]).toEqual([2, 2, 2, 2]);
    expect([one({ t: 1, type: 'commit', lines: 300, hasTest: false }), one({ t: 1, type: 'talk' }), one({ t: 1, type: 'doc' })]).toEqual([1, 1, 1]);
    expect(one({ t: 1, type: 'slay', kind: 'slime', lv: 1 })).toBe(val[5]);
    expect(COIN_RULES.map(([n]) => n)).toEqual([10, 5, 3, 2, 1]);
  });
});
