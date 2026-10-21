import { describe, expect, it } from 'vitest';
import { craftOwnerOf, dockFor, dockLetter, dockNo, dockTitle, dotWord, drawerOpen, recentLabel, type DockItem } from './craftDock';
import { craftBase } from './craftTab';

const item = (o: Partial<DockItem> = {}): DockItem => ({ app: 'photocraft', name: '참모 포토', icon: '', dot: '', hidden: false, recent: [], ...o });

describe('Craft 독', () => {
  it('점은 사람 개입·참모 중·저장 안 됨, 조용하면 없음', () => {
    expect(dotWord('human')).toBe('직접 조작 중');
    expect(dotWord('agent')).toBe('참모가 다루는 중');
    expect(dotWord('dirty')).toBe('저장 안 됨');
    expect(dotWord('')).toBe('');
  });

  it('이름표는 앱 이름 + 상태(글자 없이 아이콘만 보이니 title·aria 로)', () => {
    expect(dockTitle(item({ dot: 'dirty' }))).toBe('참모 포토 · 저장 안 됨');
    expect(dockTitle(item())).toBe('참모 포토');
  });

  it('같은 앱이 세션마다 떠 있으면 이름표에 그 세션 별명, 모서리에 번호', () => {
    const a = item({ by: 'aaaa' }), b = item({ app: 'photocraft-2', name: '참모 포토 2', by: 'bbbb', dot: 'agent' }), g = item({ app: 'gridcraft', name: '참모 그리드' });
    expect(dockTitle(b, '개발 담당')).toBe('참모 포토 2 · 개발 담당 · 참모가 다루는 중');
    expect([dockNo([a, b, g], a), dockNo([a, b, g], b), dockNo([a, b, g], g)]).toEqual(['1', '2', '']);
    expect(dockNo([b, g], b)).toBe(''); // 하나만 남으면 번호 없이
    expect([craftBase('photocraft-2'), craftBase('photocraft'), craftBase('vectorcraft-3'), craftBase('photocraft-4')]).toEqual(['photocraft', 'photocraft', 'vectorcraft', 'photocraft-4']);
  });

  it('아이콘을 못 구하면 첫 글자, 최근 문서는 파일 이름', () => {
    expect(dockLetter(item({ name: 'gridcraft' }))).toBe('G');
    expect(recentLabel('/u/Pictures/card-1.psd')).toBe('card-1.psd');
  });
});

// 2026-10-21 사용자 '참모 앱 칸 주인 가르기' — 참모가 여럿일 때 모든 참모 탭에 같은 앱이 보였다
describe('참모 앱 인스턴스 주인', () => {
  const held = new Map([['sess-x', 'A'], ['A', 'A'], ['B', 'B']]);
  const ownerOfBy = (by: string) => held.get(by) ?? null;
  const placed = new Map([['gridcraft-3', 'C']]);
  const at = (k: string) => placed.get(k);
  it('띄운 세션(by)을 맡은 참모가 먼저 — 참모가 직접 띄웠으면 그 참모', () => {
    expect(craftOwnerOf('sess-x', 'gridcraft', ownerOfBy, at)).toBe('A');
    expect(craftOwnerOf('B', 'gridcraft-2', ownerOfBy, at)).toBe('B');
    expect(craftOwnerOf('sess-x', 'gridcraft-3', ownerOfBy, at)).toBe('A'); // 칸이 놓인 자리보다 주인 세션
  });
  it('칸이 놓인 참모가 지금 참모 목록에 없으면(꺼짐) 주인 없음', () => {
    expect(craftOwnerOf('', 'gridcraft-3', ownerOfBy, at, ['A', 'B'])).toBeNull();
    expect(craftOwnerOf('', 'gridcraft-3', ownerOfBy, at, ['C'])).toBe('C');
  });
  it('사람이 연 것(by 없음)·주인 모르는 세션은 칸이 놓인 참모, 그것도 없으면 null(아무 참모)', () => {
    expect(craftOwnerOf('', 'gridcraft-3', ownerOfBy, at)).toBe('C');
    expect(craftOwnerOf('old-sess', 'gridcraft-3', ownerOfBy, at)).toBe('C');
    expect(craftOwnerOf('', 'gridcraft', ownerOfBy, at)).toBeNull();
  });
});

describe('독은 주인 참모 것만', () => {
  const it3 = [item({ app: 'gridcraft', by: 'A' }), item({ app: 'gridcraft-2', by: 'B' }), item({ app: 'gridcraft-3', by: '' })];
  const owner = (x: DockItem) => (x.by ? x.by : null);
  it('내 것 + 주인 없는 것', () => {
    expect(dockFor(it3, 'A', owner).map((x) => x.app)).toEqual(['gridcraft', 'gridcraft-3']);
    expect(dockFor(it3, 'B', owner).map((x) => x.app)).toEqual(['gridcraft-2', 'gridcraft-3']);
    expect(dockFor(it3, 'C', owner).map((x) => x.app)).toEqual(['gridcraft-3']);
  });
  it('보는 참모가 없으면(참모 0) 다', () => {
    expect(dockFor(it3, undefined, owner)).toHaveLength(3);
  });
  it('번호는 이 참모 독 안에서만 — 내 것이 하나면 번호 없음', () => {
    const mine = dockFor(it3, 'B', (x) => (x.app === 'gridcraft-3' ? 'C' : owner(x)));
    expect(mine.map((x) => dockNo(mine, x))).toEqual(['']);
  });
});

describe('서랍에서 앱 누르기 — 이 참모 것이 있으면 보이고, 없으면 빈 자리에 새로', () => {
  it('이 참모 것이 떠 있으면 그것(남의 것은 안 건드린다)', () => {
    expect(drawerOpen('gridcraft', ['gridcraft', 'gridcraft-2'], ['gridcraft-2'])).toEqual({ show: 'gridcraft-2' });
  });
  it('이 참모 것이 없으면 빈 자리 키로 새로 — 남의 것을 가져오지 않는다', () => {
    expect(drawerOpen('gridcraft', ['gridcraft'], [])).toEqual({ launch: 'gridcraft', key: 'gridcraft-2' });
    expect(drawerOpen('gridcraft', ['gridcraft-2'], [])).toEqual({ launch: 'gridcraft', key: 'gridcraft' });
    expect(drawerOpen('gridcraft', [], [])).toEqual({ launch: 'gridcraft', key: 'gridcraft' });
  });
  it('셋 다 남이 쓰면 full — 남의 것을 가져오지 않는다', () => {
    expect(drawerOpen('gridcraft', ['gridcraft', 'gridcraft-2', 'gridcraft-3'], [])).toEqual({ full: true });
  });
  it('다른 앱 인스턴스는 상관없다', () => {
    expect(drawerOpen('photocraft', ['gridcraft', 'photocraft-2'], ['gridcraft'])).toEqual({ launch: 'photocraft', key: 'photocraft' });
  });
});
