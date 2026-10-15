import { describe, expect, it } from 'vitest';
import { hostState, manageGroups, phoneRemove, removeUndo, sizeText, trashChoice, type ManageRow } from './modeManage';

// 모드 관리(10/12 사용자) — 기본 모드는 숨기기(견본이라 아예 제거는 안 됨), 사용자 모드는 진짜 제거. 원본 폴더는 고른 때만 휴지통
const row = (name: string, source: ManageRow['source'], over: Partial<ManageRow> = {}): ManageRow => ({
  name, title: name.toUpperCase(), source, dir: `/x/${name}`, on: false, where: 'window', alive: false, pid: 0, dash: null, hidden: false, way: source === 'added' || source === 'folder' ? 'remove' : 'hide', size: 0, ...over,
});

describe('manageGroups — 관리 목록', () => {
  it('한 목록에 사용자 모드가 위(이름 순), 기본 모드가 아래 — 숨긴 것은 맨 아래 따로', () => {
    const g = manageGroups([row('home-todo', 'example'), row('zeta', 'added'), row('home-board', 'example', { hidden: true }), row('alpha', 'folder'), row('plug', 'plugin', { hidden: true }), row('counter', 'example')]);
    expect(g.list.map((r) => r.name)).toEqual(['alpha', 'zeta', 'home-todo', 'counter']);
    expect(g.hidden.map((r) => r.name)).toEqual(['home-board', 'plug']);
  });
});

describe('trashChoice — 원본 폴더 휴지통 체크', () => {
  it('내가 등록한 것은 고를 수 있고, 데이터 폴더 모드는 그 폴더가 원본이라 늘 켜짐, 기본·플러그인은 없음', () => {
    expect(trashChoice('added')).toBe('optional');
    expect(trashChoice('folder')).toBe('required');
    expect(trashChoice('example')).toBe('none');
    expect(trashChoice('plugin')).toBe('none');
  });
});

describe('removeUndo — 되돌리기 토스트', () => {
  it('숨기기·원본을 안 보낸 제거만 되돌린다', () => {
    expect(removeUndo({ kind: 'hidden', trashed: null, undo: true })).toBe(true);
    expect(removeUndo({ kind: 'removed', trashed: null, undo: true })).toBe(true);
    expect(removeUndo({ kind: 'removed', trashed: '/Users/a/.Trash/shop-mode', undo: false })).toBe(false);
  });
});

describe('sizeText — 데이터 크기', () => {
  it('바이트를 읽기 좋게', () => {
    expect(sizeText(0)).toBe('0 B');
    expect(sizeText(900)).toBe('900 B');
    expect(sizeText(2048)).toBe('2 KB');
    expect(sizeText(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(sizeText(12 * 1024 * 1024 * 1024)).toBe('12 GB');
  });
});

describe('phoneRemove — 폰 지우기 단추', () => {
  it('기본·플러그인 = 숨기기, 내가 등록한 것 = 제거, 데이터 폴더 모드는 원본 휴지통이 필요해 폰엔 단추가 없다', () => {
    expect(phoneRemove('example')).toBe('hide');
    expect(phoneRemove('plugin')).toBe('hide');
    expect(phoneRemove('added')).toBe('remove');
    expect(phoneRemove('folder')).toBeNull();
  });
});

describe('hostState — 깨어 있음/잠듦·메모리', () => {
  it('깨어 있으면 메모리, 재웠으면 잠듦, 꺼졌으면 없음', () => {
    expect(hostState({ alive: true, memKb: 246000 })).toEqual({ kind: 'awake', mem: '240 MB', shared: false });
    expect(hostState({ alive: true, memKb: 0 })).toEqual({ kind: 'awake', mem: null, shared: false });
    // 가벼운 모드끼리 같이 쓰는 호스트(ADR 0006) — 메모리는 그 호스트 하나의 것
    expect(hostState({ alive: true, memKb: 246000, shared: true })).toEqual({ kind: 'awake', mem: '240 MB', shared: true });
    expect(hostState({ alive: false, asleep: true })).toEqual({ kind: 'asleep' });
    expect(hostState({ alive: false })).toBeNull();
  });
});
