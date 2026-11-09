import { describe, expect, it } from 'vitest';
import { assignProject, buyExpand, buyOffice, CATALOG, EMPTY_GACHA, hangWall, itemOf, moveZoneIn, officeOf, officesOf, parseGacha, placeFloorIn, placeFurnIn, pull, setChar, setOrchSeat, setRoomSkin, skinOfRoom, undecidedOrchs, officeOfProject, type GachaFile } from './gacha';
import { FLOOR_SIZE, WALL_SPAN } from './catalog/art';

const withCoins = (coins: number, extra: Partial<GachaFile> = {}): GachaFile => ({ ...EMPTY_GACHA, coins, ...extra });
const anyFloor = Object.keys(FLOOR_SIZE)[0]!;
const otherFloor = Object.keys(FLOOR_SIZE)[1]!;
const anyWall = Object.keys(WALL_SPAN)[0]!;

describe('뽑기 풀 — 캐릭터·가구·바닥 장식·벽 장식이 같이 나온다', () => {
  it('새 종류가 카탈로그에 있고 이름은 앞머리 달린 모양', () => {
    for (const k of ['chr', 'floor', 'wall'] as const) expect(CATALOG.filter((c) => c.kind === k).length).toBeGreaterThan(10);
    const c = CATALOG.find((x) => x.kind === 'chr')!;
    expect(c.name).toContain(' — ');
  });
  it('id 가 겹치지 않는다', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('다마고치 캐릭터도 등급을 단계로 받아 들어 있다 — 알은 없다', () => {
    expect(itemOf('chr.bear')?.rarity).toBe('흔함');
    expect(itemOf('chr.fire_cG')?.rarity).toBe('보통');
    expect(itemOf('chr.fire_p1')?.rarity).toBe('희귀');
    expect(itemOf('chr.fire_m1')?.rarity).toBe('전설');
    expect(itemOf('chr.fuse_jA')?.rarity).toBe('전설');
    expect(itemOf('chr.fire_egg')).toBeUndefined();
  });
  it('캐릭터 중복도 지금 규칙 그대로 — 별 오르고 ★5 전 10·뒤 50', () => {
    const f = withCoins(100, { owned: { 'chr.bear': 1 } });
    // 흔함 굴림 + 그 등급 첫 줄이 아니어도 되게 — 뽑은 결과의 환급 규칙만 본다
    const r = pull(f, 1, () => 0.01, new Date(2026, 10, 20).getTime())!;
    const had = f.owned[r.results[0]!.id] ?? 0;
    expect(r.results[0]!.refund).toBe(had ? 10 : 0);
  });
});

describe('사무실 — 첫 번째는 무료, 넓히기·추가는 코인', () => {
  it('옛 파일은 기본 사무실 하나로 읽는다', () => {
    const f = parseGacha(JSON.stringify({ coins: 5, since: 1, owned: {} }), 0);
    expect(officesOf(f)).toHaveLength(1);
    expect(officesOf(f)[0]!.lv).toBe(0);
  });
  it('넓히기 — 값만큼 빠지고 한 단계 오른다, 코인이 모자라거나 끝이면 null', () => {
    const f = buyExpand(withCoins(1200), 0)!;
    expect(f.coins).toBe(200);
    expect(officesOf(f)[0]!.lv).toBe(1);
    expect(buyExpand(withCoins(999), 0)).toBeNull();
    const top = withCoins(99999, { offices: [{ ...officesOf(EMPTY_GACHA)[0]!, lv: 3 }] });
    expect(buyExpand(top, 0)).toBeNull();
  });
  it('추가 — 2번째 2,000, 3번째 10,000, 넷째는 없다', () => {
    const a = buyOffice(withCoins(12500))!;
    expect(a.coins).toBe(10500);
    expect(officesOf(a)).toHaveLength(2);
    const b = buyOffice(a)!;
    expect(b.coins).toBe(500);
    expect(officesOf(b)).toHaveLength(3);
    expect(buyOffice({ ...b, coins: 99999 })).toBeNull();
    expect(buyOffice(withCoins(1999))).toBeNull();
  });
});

describe('스킨은 사무실마다', () => {
  it('첫 사무실은 equip.skin(폰·도감과 같은 칸), 그다음은 그 방 칸', () => {
    const f = buyOffice(withCoins(5000, { owned: { 'skin.mint': 1, 'skin.cafe': 1 }, equip: { skin: 'skin.mint' } }))!;
    expect(skinOfRoom(f, 0)).toBe('mint');
    expect(skinOfRoom(f, 1)).toBe('wood');
    const g = setRoomSkin(f, 1, 'cafe');
    expect(skinOfRoom(g, 1)).toBe('cafe');
    expect(skinOfRoom(g, 0)).toBe('mint');
    expect(setRoomSkin(g, 1, 'neon')).toBe(g); // 안 가진 건 그대로
    expect(skinOfRoom(setRoomSkin(g, 1, 'wood'), 1)).toBe('wood');
  });
});

describe('놓기 — 가진 것만, 규칙에 맞을 때만, 한 번에 한 사무실에', () => {
  const rich = (): GachaFile => buyOffice(withCoins(5000, { owned: { 'furn.sofa': 1, [anyFloor]: 1, [otherFloor]: 1, [anyWall]: 1 } }))!;
  it('가구 — 안 가졌거나 못 놓는 칸이면 그대로, null 이면 창고', () => {
    const f = rich();
    expect(placeFurnIn(f, 0, 'furn.tank', [6, 5], [])).toBe(f);
    expect(placeFurnIn(f, 0, 'furn.sofa', [1, 3], [])).toBe(f);
    const g = placeFurnIn(f, 0, 'furn.sofa', [6, 5], []);
    expect(officesOf(g)[0]!.furn['furn.sofa']).toEqual([6, 5]);
    expect(officesOf(placeFurnIn(g, 0, 'furn.sofa', null, []))[0]!.furn['furn.sofa']).toBeUndefined();
  });
  it('다른 사무실에 놓으면 앞 사무실에선 빠진다', () => {
    const g = placeFurnIn(placeFurnIn(rich(), 0, 'furn.sofa', [6, 5], []), 1, 'furn.sofa', [6, 5], []);
    expect(officesOf(g)[0]!.furn['furn.sofa']).toBeUndefined();
    expect(officesOf(g)[1]!.furn['furn.sofa']).toEqual([6, 5]);
  });
  it('바닥 장식 — 책상 아래 되고, 끼리는 못 겹친다', () => {
    const f = rich();
    const a = placeFloorIn(f, 0, anyFloor, [1, 3]);
    expect(officesOf(a)[0]!.floor).toEqual([{ id: anyFloor, x: 1, y: 3 }]);
    expect(placeFloorIn(a, 0, otherFloor, [1, 3])).toBe(a);
    expect(officesOf(placeFloorIn(a, 0, anyFloor, null))[0]!.floor).toEqual([]);
  });
  it('벽 장식 — 벽 칸에, 창문 자리는 안 된다', () => {
    const f = rich();
    expect(hangWall(f, 0, anyWall, 'R', 2)).toBe(f);
    const g = hangWall(f, 0, anyWall, 'L', 0);
    expect(officesOf(g)[0]!.wall).toEqual([{ id: anyWall, side: 'L', at: 0 }]);
    expect(officesOf(hangWall(g, 0, anyWall, null, 0))[0]!.wall).toEqual([]);
  });
  it('직원 묶음 옮기기 — 규칙에 맞을 때만', () => {
    const f = rich();
    expect(officesOf(moveZoneIn(f, 0, [2, 3], []))[0]!.zone).toEqual([2, 3]);
    expect(moveZoneIn(f, 0, [7, 3], [])).toBe(f);
  });
});

describe('참모 캐릭터·자리·출근', () => {
  it('가진 캐릭터만 입는다', () => {
    const f = withCoins(0, { owned: { 'chr.bear': 1 } });
    expect(setChar(f, '참모', 'chr.bear').chars).toEqual({ 참모: 'chr.bear' });
    expect(setChar(f, '참모', 'chr.fire_cG')).toBe(f);
  });
  it('안 정한 참모 — 곰뿐이면 묻지 않는다(둘째가 생기면 묻는다)', () => {
    expect(undecidedOrchs(withCoins(0, { owned: { 'chr.bear': 1 } }), ['참모'])).toEqual([]);
    const two = withCoins(0, { owned: { 'chr.bear': 1, 'chr.a_bunny': 1 } });
    expect(undecidedOrchs(two, ['참모', '참모-2'])).toEqual(['참모', '참모-2']);
    expect(undecidedOrchs(setChar(two, '참모', 'chr.bear'), ['참모', '참모-2'])).toEqual(['참모-2']);
  });
  it('참모 자리 — 어느 사무실 어느 칸, 없는 사무실이면 그대로', () => {
    const f = withCoins(0);
    expect(setOrchSeat(f, '참모', { office: 1, x: 2, y: 2 })).toBe(f);
    const g = buyOffice(withCoins(2000))!;
    expect(officeOf(setOrchSeat(g, '참모', { office: 1, x: 2, y: 2 }), '참모')).toBe(1);
    expect(officeOf(g, '참모')).toBe(0);
  });
  it('프로젝트 출근 — 기본 1번, 없는 사무실로 못 보낸다', () => {
    const f = withCoins(0);
    expect(officeOfProject(f, 'project-b')).toBe(0);
    expect(assignProject(f, 'project-b', 1)).toBe(f);
    const g = assignProject(buyOffice(withCoins(2000))!, 'project-b', 1);
    expect(officeOfProject(g, 'project-b')).toBe(1);
  });
});
