import { describe, expect, it } from 'vitest';
import { boxOf, coveredAt, popOverlaps, craftAppOf, craftGone, craftKey, dropCraftEverywhere, sameBox, shown, wantStill, leftCraft } from './craftTab';

describe('Craft 스페이스 탭', () => {
  it('탭 열쇠 k:<앱>', () => {
    expect(craftKey('photocraft')).toBe('k:photocraft');
    expect(craftAppOf('k:photocraft')).toBe('photocraft');
    expect(craftAppOf('d:/x.png')).toBe('');
  });

  it('칸 자리는 정수로, 같으면 안 보낸다', () => {
    const b = boxOf({ left: 10.4, top: 80.6, width: 900.2, height: 600 });
    expect(b).toEqual([10, 81, 900, 600]);
    expect(sameBox(b, [10, 81, 900, 600])).toBe(true);
    expect(sameBox(null, b)).toBe(false);
  });

  it('레티나면 칸 자리를 기기 픽셀(0.5점)까지 — 정수로 밀면 칸 끝 1px 에 바탕이 비친다(10-28 사용자)', () => {
    expect(boxOf({ left: 12.5, top: 80.25, width: 780.5, height: 694 }, 2)).toEqual([12.5, 80.5, 780.5, 694]);
    expect(boxOf({ left: 12.5, top: 80.25, width: 780.5, height: 694 }, 1)).toEqual([13, 80, 781, 694]);
    expect(boxOf({ left: 12.5, top: 0, width: 10, height: 10 }, 0)).toEqual([13, 0, 10, 10]);
  });

  it('덮였거나 칸이 없으면 숨긴다', () => {
    expect(shown([0, 0, 900, 600], false)).toBe(true);
    expect(shown([0, 0, 900, 600], true)).toBe(false);
    expect(shown([0, 0, 0, 600], false)).toBe(false);
  });

  it('목록에 없는 팝오버도 칸 안 9점으로 잡는다', () => {
    const stage = { id: 'stage' };
    const pop = { id: 'pop' };
    const inside = (el: unknown) => el === stage;
    expect(coveredAt([0, 0, 1000, 600], () => stage, inside)).toBe(false);
    // 오른쪽 위 구석(900,60)만 결정 대기함 팝오버가 덮음
    expect(coveredAt([0, 0, 1000, 600], (x, y) => (x > 800 && y < 100 ? pop : stage), inside)).toBe(true);
    expect(coveredAt([0, 0, 0, 0], () => pop, inside)).toBe(false);
  });
});

describe('덮일 때 마지막 프레임(2026-10-19 실사용 — 결정 대기함이 뜨면 칸이 통째로 검게)', () => {
  it('칸이 보일 크기인데 덮였을 때만 그림을 깐다 — 탭이 내려간(크기 0) 건 아니다', () => {
    expect(wantStill([0, 0, 800, 600], true)).toBe(true);
    expect(wantStill([0, 0, 800, 600], false)).toBe(false);
    expect(wantStill([0, 0, 0, 0], true)).toBe(false);
    expect(wantStill([0, 0, 30, 600], true)).toBe(false);
  });
});

describe('Craft 글자 탭 없이 — 다른 탭으로 옮기면 숨기기(2026-10-19 사용자 "스페이스 탭이 겹친다")', () => {
  it('Craft 칸에서 다른 데로 옮기면 그 앱', () => {
    expect(leftCraft('k:vectorcraft', 'k:@apps')).toBe('vectorcraft');
    expect(leftCraft('k:vectorcraft', '')).toBe('vectorcraft');
    expect(leftCraft('k:gridcraft', 'k:vectorcraft')).toBe('gridcraft');
  });
  it('같은 칸이거나 Craft 칸이 아니었으면 없음 — 앱 서랍(k:@apps)도 Craft 앱 칸이 아니다', () => {
    expect(leftCraft('k:vectorcraft', 'k:vectorcraft')).toBeNull();
    expect(leftCraft('/a/b.md', 'k:vectorcraft')).toBeNull();
    expect(leftCraft('k:@apps', '/a/b.md')).toBeNull();
  });
});

// 2026-10-21 사용자 실기(.shots/stale-craft-pane.png): 참모 A 스페이스에 참모 벡터 칸이 떠 있는데 그 앱이 B 를 보는 동안 꺼지고 A 로 돌아오면
// 칸이 '비추기가 멈췄어' + '앱이 꺼져 있어' 로 남았다 — 꺼짐 처리가 지금 보는 참모 탭 줄만 고쳤다. 앱이 여럿이면 겹쳐 쌓였다
describe('craftGone — 독에서 보이던 앱이 두 번 연속 사라지면 꺼짐(사람이 끄기·죽음처럼 closed 알림이 안 오는 길까지)', () => {
  it('보이던 앱이 한 번 빠지면 기다리고, 두 번째에 꺼짐 한 번', () => {
    let r = craftGone({}, ['vectorcraft', 'photocraft']);
    expect(r.gone).toEqual([]);
    r = craftGone(r.track, ['photocraft']);
    expect(r.gone).toEqual([]); // 한 번 빠짐 — 독 읽기가 잠깐 비어도 안 닫는다
    r = craftGone(r.track, ['photocraft']);
    expect(r.gone).toEqual(['vectorcraft']);
    expect(craftGone(r.track, ['photocraft']).gone).toEqual([]); // 한 번만
  });
  it('다시 보이면 처음부터, 본 적 없는 앱은 꺼짐이 아니다', () => {
    let r = craftGone({ vectorcraft: 0 }, []);
    r = craftGone(r.track, ['vectorcraft']);
    r = craftGone(r.track, []);
    expect(r.gone).toEqual([]);
    expect(craftGone({}, []).gone).toEqual([]);
  });
});

describe('dropCraftEverywhere — 꺼진 앱 칸을 모든 참모 탭 줄·보던 화면에서 거둔다', () => {
  const k = craftKey('vectorcraft'), p = craftKey('photocraft');
  it('안 보던 참모 A 의 탭 줄과 보던 화면(그 칸)까지 — 돌아와도 다시 안 그린다', () => {
    const saved = new Map([['A', { orch: 'A', back: 'l:A', tabs: ['/x/a.md', k] }], ['B', { orch: 'B', back: 'l:B', tabs: [k, p] }]]);
    const screens = new Map([['A', { pick: k, modal: null }], ['B', { pick: p, modal: null }]]);
    dropCraftEverywhere(k, saved, screens);
    expect(saved.get('A')!.tabs).toEqual(['/x/a.md']);
    expect(screens.get('A')!.pick).toBe('d:/x/a.md'); // 남은 마지막 탭으로
    expect(saved.get('B')!.tabs).toEqual([p]);
    expect(screens.get('B')!.pick).toBe(p); // 다른 걸 보던 참모는 그대로
  });
  it('여러 앱이 꺼지면 다 — 탭이 없으면 보관함 자리(back)로', () => {
    const saved = new Map([['B', { orch: 'B', back: 'l:B', tabs: [k, p] }]]);
    const screens = new Map([['B', { pick: k, modal: null }]]);
    dropCraftEverywhere(k, saved, screens);
    dropCraftEverywhere(p, saved, screens);
    expect(saved.get('B')!.tabs).toEqual([]);
    expect(screens.get('B')!.pick).toBe('l:B');
  });
  it('탭 줄엔 없는데 보던 화면만 그 칸이면(다른 참모 몫으로 들어온 것) 홈으로', () => {
    const saved = new Map<string, { orch: string; back: string; tabs: string[] }>();
    const screens = new Map([['C', { pick: k, modal: null }]]);
    dropCraftEverywhere(k, saved, screens);
    expect(screens.get('C')!.pick).toBe('');
  });
});

describe('dropCraftEverywhere keep — 주인이 정해지면 다른 참모 탭 줄에서만 거둔다', () => {
  const k = craftKey('gridcraft-2');
  it('keep 참모 줄·화면은 그대로', () => {
    const saved = new Map([['A', { orch: 'A', back: 'l:A', tabs: [k] }], ['B', { orch: 'B', back: 'l:B', tabs: [k] }]]);
    const screens = new Map([['A', { pick: k, modal: null }], ['B', { pick: k, modal: null }]]);
    dropCraftEverywhere(k, saved, screens, 'B');
    expect(saved.get('A')!.tabs).toEqual([]);
    expect(screens.get('A')!.pick).toBe('l:A');
    expect(saved.get('B')!.tabs).toEqual([k]);
    expect(screens.get('B')!.pick).toBe(k);
  });

  it('칸 구석만 살짝 덮는 팝오버(위 막대 계정 메뉴)도 덮임 — 9점 훑기는 구석을 못 봐서 계정 목록이 참모 포토 칸 밑에 깔렸다(2026-10-22 사용자)', () => {
    const pane: [number, number, number, number] = [260, 120, 900, 700];
    expect(popOverlaps(pane, [[48, 40, 300, 250]])).toBe(true); // 계정 메뉴가 칸 왼쪽 위 구석에 걸침
    expect(popOverlaps(pane, [[1200, 40, 200, 200]])).toBe(false); // 칸 밖 팝오버
    expect(popOverlaps(pane, [[0, 0, 0, 0]])).toBe(false); // 숨은(크기 0) 팝오버
    expect(popOverlaps(pane, [])).toBe(false);
  });
});
