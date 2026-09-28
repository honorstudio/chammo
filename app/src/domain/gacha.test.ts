import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { CATALOG, dayStartAt, earn, EMPTY_GACHA, ownedOf, ownedSkins, parseGacha, place, pull, rarityLabel, rollRarity, toggleEquip, type GachaFile } from './gacha';

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

  it('일한 시간(work)은 코인이 아니다', () => {
    expect(earn(withCoins(0, { since: 0 }), [{ t: 5, type: 'work', minutes: 30 }], 10).gained).toBe(0);
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

  it('중복이면 코인 50 돌려받고 조각 1', () => {
    const first = pull(withCoins(300), 1, rngOf(0.1, 0))!;
    const again = pull(first.file, 1, rngOf(0.1, 0))!;
    expect(again.results[0]).toMatchObject({ dup: true, refund: 50 });
    expect(again.file.coins).toBe(300 - 100 - 100 + 50);
    expect(again.file.shards).toBe(1);
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
