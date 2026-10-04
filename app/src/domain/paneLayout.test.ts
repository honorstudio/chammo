import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT, gridKeyOf, layoutReducer, visiblePanes, paneToFocus, revealPane, maxTarget, type PaneLayout } from './paneLayout';

const ids = ['a', 'b', 'c'];

describe('visiblePanes — 격자에 뜰 창 / 아래 띠로 내려간 창', () => {
  it('기본은 전부 격자에', () => {
    expect(visiblePanes(ids, EMPTY_LAYOUT)).toEqual({ shown: ['a', 'b', 'c'], strip: [] });
  });

  it('접은 창은 띠로 내려간다 (순서는 원래 순서)', () => {
    expect(visiblePanes(ids, { maximized: null, collapsed: ['c', 'a'] })).toEqual({ shown: ['b'], strip: ['a', 'c'] });
  });

  it('크게 한 창만 격자에, 나머지는 전부 띠로', () => {
    expect(visiblePanes(ids, { maximized: 'b', collapsed: [] })).toEqual({ shown: ['b'], strip: ['a', 'c'] });
  });

  it('크게 한 창이 사라졌으면(세션 끝남) 크게를 무시한다', () => {
    expect(visiblePanes(ids, { maximized: 'zz', collapsed: ['a'] })).toEqual({ shown: ['b', 'c'], strip: ['a'] });
  });

  it('사라진 세션의 접힘 기록은 무시한다', () => {
    expect(visiblePanes(ids, { maximized: null, collapsed: ['zz'] })).toEqual({ shown: ids, strip: [] });
  });

  it('전부 접으면 격자는 비고 띠에 다 있다', () => {
    expect(visiblePanes(ids, { maximized: null, collapsed: ids })).toEqual({ shown: [], strip: ids });
  });
});

describe('layoutReducer — 창 버튼 동작', () => {
  it('크게: 그 창을 크게, 접혀 있었으면 펼친다', () => {
    const s: PaneLayout = { maximized: null, collapsed: ['b'] };
    expect(layoutReducer(s, { type: 'maximize', id: 'b' })).toEqual({ maximized: 'b', collapsed: [] });
  });

  it('원래대로: 크게를 푼다, 접힘은 그대로', () => {
    expect(layoutReducer({ maximized: 'a', collapsed: ['c'] }, { type: 'restore' })).toEqual({ maximized: null, collapsed: ['c'] });
  });

  it('접기: 크게 한 창을 접으면 크게도 풀린다', () => {
    expect(layoutReducer({ maximized: 'a', collapsed: [] }, { type: 'collapse', id: 'a' })).toEqual({ maximized: null, collapsed: ['a'] });
  });

  it('접기: 다른 창을 접어도 크게는 유지', () => {
    expect(layoutReducer({ maximized: 'a', collapsed: [] }, { type: 'collapse', id: 'b' })).toEqual({ maximized: 'a', collapsed: ['b'] });
  });

  it('접기를 두 번 해도 한 번만 들어간다', () => {
    expect(layoutReducer({ maximized: null, collapsed: ['b'] }, { type: 'collapse', id: 'b' })).toEqual({ maximized: null, collapsed: ['b'] });
  });

  it('펼치기: 띠에서 꺼낸다. 크게 상태였으면 크게를 풀어 같이 보이게 한다', () => {
    expect(layoutReducer({ maximized: 'a', collapsed: ['b'] }, { type: 'expand', id: 'b' })).toEqual({ maximized: null, collapsed: [] });
  });

  it('끈 창은 기록에서 지운다', () => {
    expect(layoutReducer({ maximized: 'a', collapsed: ['b', 'c'] }, { type: 'forget', id: 'a' })).toEqual({ maximized: null, collapsed: ['b', 'c'] });
    expect(layoutReducer({ maximized: null, collapsed: ['b', 'c'] }, { type: 'forget', id: 'b' })).toEqual({ maximized: null, collapsed: ['c'] });
  });
});

describe('layoutReducer — 순서·크기', () => {
  it('reorder: 끌어 놓은 순서를 저장한다 (지금 보이는 목록 기준)', () => {
    expect(layoutReducer(EMPTY_LAYOUT, { type: 'reorder', ids: ['a', 'b', 'c'], from: 'a', to: 'c' }).order).toEqual(['b', 'c', 'a']);
  });

  it('reorder: 이미 저장된 순서 위에서 또 옮긴다', () => {
    const s = { ...EMPTY_LAYOUT, order: ['c', 'a', 'b'] };
    expect(layoutReducer(s, { type: 'reorder', ids: ['a', 'b', 'c'], from: 'b', to: 'c' }).order).toEqual(['b', 'c', 'a']);
  });

  it('resize: 열·줄 비율을 따로 저장', () => {
    const s = layoutReducer(EMPTY_LAYOUT, { type: 'resize', axis: 'cols', tracks: [2, 1] });
    expect(layoutReducer(s, { type: 'resize', axis: 'rows', tracks: [1, 3] })).toMatchObject({ cols: [2, 1], rows: [1, 3] });
  });

  it('visiblePanes 는 저장된 순서를 따른다', () => {
    expect(visiblePanes(['a', 'b', 'c'], { ...EMPTY_LAYOUT, order: ['c', 'a'] }).shown).toEqual(['c', 'a', 'b']);
  });
});

describe('paneToFocus — 크게·되돌리기·화면 전환 뒤 키 입력을 받을 창', () => {
  it('크게 한 창이 있으면 그 창', () => expect(paneToFocus({ maximized: 'b', wasMaximized: null, last: 'a' })).toBe('b'));
  it('되돌리면 방금 크게 했던 창을 그대로', () => expect(paneToFocus({ maximized: null, wasMaximized: 'b', last: 'a' })).toBe('b'));
  it('둘 다 없으면 마지막으로 누른 창', () => expect(paneToFocus({ maximized: null, wasMaximized: null, last: 'a' })).toBe('a'));
  it('아무것도 모르면 null', () => expect(paneToFocus({ maximized: null, wasMaximized: null, last: null })).toBeNull());
});

describe('revealPane — 알림·작업 패널에서 "그 세션으로" 갈 때 가려진 창을 드러낸다', () => {
  it('다른 창이 크게 돼 있으면 되돌린다', () => expect(revealPane({ maximized: 'a', collapsed: [] }, 'b')).toEqual([{ type: 'restore' }]));
  it('그 창이 크게 돼 있으면 그대로', () => expect(revealPane({ maximized: 'b', collapsed: [] }, 'b')).toEqual([]));
  it('접혀 있으면 펼친다', () => expect(revealPane({ maximized: null, collapsed: ['b'] }, 'b')).toEqual([{ type: 'expand', id: 'b' }]));
  it('보이는 창이면 할 일 없음', () => expect(revealPane({ maximized: null, collapsed: [] }, 'b')).toEqual([]));
});

describe('maxTarget — ⌘Enter 로 크게 할 창(재시작·⌘2 직후엔 누른 기록이 없어 아무 일도 안 했다)', () => {
  it('마지막으로 누른 창이 먼저', () => expect(maxTarget('b', 'c', ['a', 'b', 'c'])).toBe('b'));
  it('기록이 없으면 지금 입력 커서가 있는 창', () => expect(maxTarget(undefined, 'c', ['a', 'b', 'c'])).toBe('c'));
  it('그것도 없으면 첫 창', () => expect(maxTarget(undefined, null, ['a', 'b'])).toBe('a'));
  it('기록된 창이 이 화면에 없으면(꺼졌으면) 무시', () => expect(maxTarget('z', null, ['a', 'b'])).toBe('a'));
  it('창이 없으면 null', () => expect(maxTarget(undefined, null, [])).toBeNull());
});

describe('gridKeyOf — 알림·결정 대기함에서 "그 세션으로" 갈 격자', () => {
  it('참모는 스페이스·사무실이면 오른쪽 열, 아니면 참모 격자', () => {
    expect(gridKeyOf({ kind: 'orch' }, { space: true, office: false })).toBe('orch-col');
    expect(gridKeyOf({ kind: 'orch' }, { space: false, office: true })).toBe('orch-col');
    expect(gridKeyOf({ kind: 'orch' }, { space: false, office: false })).toBe('orch');
  });
  it('도우미·프로젝트는 그대로', () => {
    expect(gridKeyOf({ kind: 'helper' }, { space: true, office: false })).toBe('helpers');
    expect(gridKeyOf({ kind: 'project', project: 'project-x-app' }, { space: true, office: false })).toBe('p:project-x-app');
  });
});

describe('visiblePanes 고정 — 고정한 참모 탭은 끌어 둔 순서보다 앞(2026-10-03 사용자 "PC 에도")', () => {
  it('pinned(고정 순서) 먼저, 나머지는 끌어 둔 순서', () => {
    const s: PaneLayout = { ...EMPTY_LAYOUT, order: ['c', 'b', 'a'] };
    expect(visiblePanes(['a', 'b', 'c'], s).shown).toEqual(['c', 'b', 'a']);
    expect(visiblePanes(['a', 'b', 'c'], s, ['a']).shown).toEqual(['a', 'c', 'b']);
  });
});
