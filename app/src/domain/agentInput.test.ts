import { describe, expect, it } from 'vitest';
import { escClose, keyEvents, keyTarget, menuRoute, modsOf, pointIn, unfocusedKey } from './agentInput';

describe('pointIn — 모달 화면(contain) 위 마우스 → 그림 안 비율', () => {
  // 1000x600 칸에 1280x800 그림 → 폭 맞춤 1000x625? 아니, 높이가 넘쳐 높이 맞춤: 960x600, 좌우 20px 여백
  const box = { left: 100, top: 50, width: 1000, height: 600 };
  it('가운데', () => expect(pointIn(600, 350, box, 1280, 800)).toEqual({ x: 0.5, y: 0.5 }));
  it('왼쪽 위 모서리(여백 20px 안쪽부터 그림)', () => expect(pointIn(120, 50, box, 1280, 800)).toEqual({ x: 0, y: 0 }));
  it('여백(그림 밖)은 null', () => expect(pointIn(110, 300, box, 1280, 800)).toBeNull());
  it('그림 크기를 모르면 null', () => expect(pointIn(600, 350, box, 0, 0)).toBeNull());
});

describe('modsOf — CDP modifiers(Alt 1·Ctrl 2·Meta 4·Shift 8)', () => {
  it('합친다', () => expect(modsOf({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(13));
});

describe('keyEvents — 글자가 아닌 키만 CDP 키로(글자는 insertText 로 따로)', () => {
  const k = (key: string, code: string, keyCode: number, m: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    keyEvents({ key, code, keyCode, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...m });
  it('Enter 는 누름·글자(\\r)·뗌', () => {
    const e = k('Enter', 'Enter', 13)!;
    expect(e.map((x) => (x as { type: string }).type)).toEqual(['rawKeyDown', 'char', 'keyUp']);
    expect(e[1]).toMatchObject({ kind: 'key', type: 'char', text: '\r', keyCode: 13 });
  });
  it('Backspace·방향키·Tab 은 키로', () => {
    expect(k('Backspace', 'Backspace', 8)!.map((x) => (x as { type: string }).type)).toEqual(['rawKeyDown', 'keyUp']);
    expect(k('ArrowLeft', 'ArrowLeft', 37)![0]).toMatchObject({ key: 'ArrowLeft', keyCode: 37 });
    expect(k('Tab', 'Tab', 9, { shiftKey: true })![0]).toMatchObject({ modifiers: 8 });
  });
  it('⌘A 는 전체 선택 명령, ⌘Z 되돌리기', () => {
    expect(k('a', 'KeyA', 65, { metaKey: true })![0]).toMatchObject({ type: 'rawKeyDown', modifiers: 4, commands: ['selectAll'] });
    expect(k('z', 'KeyZ', 90, { metaKey: true })![0]).toMatchObject({ commands: ['undo'] });
  });
  it('보통 글자·⌘V·한글 조합 키(229)는 null — 글칸(input·paste·compositionend)이 맡는다', () => {
    expect(k('a', 'KeyA', 65)).toBeNull();
    expect(k('v', 'KeyV', 86, { metaKey: true })).toBeNull();
    expect(k('Process', 'KeyR', 229)).toBeNull();
  });
  it('한글 자판이어도 ⌘ 조합은 키 자리(code)로 — ⌘ㅁ = ⌘A', () => {
    expect(k('ㅁ', 'KeyA', 65, { metaKey: true })![0]).toMatchObject({ commands: ['selectAll'], key: 'a' });
  });
  it('⇧⌘Z 다시 하기, ⌘C 복사', () => {
    expect(k('z', 'KeyZ', 90, { metaKey: true, shiftKey: true })![0]).toMatchObject({ commands: ['redo'] });
    expect(k('c', 'KeyC', 67, { metaKey: true })![0]).toMatchObject({ commands: ['copy'] });
  });
  it('⌘R 새로고침·⌘[ 뒤로·⌘] 앞으로', () => {
    expect(k('r', 'KeyR', 82, { metaKey: true })).toEqual([{ kind: 'nav', action: 'reload' }]);
    expect(k('[', 'BracketLeft', 219, { metaKey: true })).toEqual([{ kind: 'nav', action: 'back' }]);
    expect(k(']', 'BracketRight', 221, { metaKey: true })).toEqual([{ kind: 'nav', action: 'forward' }]);
  });
  it('그 밖의 ⌘ 조합은 페이지 단축키로 그대로(⌘F·⌘K 등 — 페이지가 쓰면 먹는다)', () => {
    const f = k('f', 'KeyF', 70, { metaKey: true })!;
    expect(f.map((x) => (x as { type: string }).type)).toEqual(['rawKeyDown', 'keyUp']);
    expect(f[0]).toMatchObject({ key: 'f', code: 'KeyF', modifiers: 4 });
  });
});

describe('keyTarget — 모달 글칸에 포커스가 있으면 키는 브라우저 몫', () => {
  const e = (key: string, code: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...m });
  it('포커스가 없으면 앱', () => expect(keyTarget(e('1', 'Digit1', { metaKey: true }), false)).toBe('app'));
  it('⌘1~9·⌘E·⌘K·⌘B·⌘T·⌘F·⌘C 는 브라우저', () => {
    for (const [key, code] of <[string, string][]>[['1', 'Digit1'], ['4', 'Digit4'], ['e', 'KeyE'], ['k', 'KeyK'], ['b', 'KeyB'], ['t', 'KeyT'], ['f', 'KeyF'], ['c', 'KeyC']]) expect(keyTarget(e(key, code, { metaKey: true }), true)).toBe('browser');
    expect(keyTarget(e('Tab', 'Tab', { shiftKey: true }), true)).toBe('browser');
  });
  it('⌘W 는 모달 닫기(세션 브라우저 탭을 닫지 않게)', () => expect(keyTarget(e('w', 'KeyW', { metaKey: true }), true)).toBe('close'));
  it('⌘Q·⌘H·⌘, 와 ⌥⌘ 화면 이동은 앱', () => {
    expect(keyTarget(e('q', 'KeyQ', { metaKey: true }), true)).toBe('app');
    expect(keyTarget(e('h', 'KeyH', { metaKey: true }), true)).toBe('app');
    expect(keyTarget(e(',', 'Comma', { metaKey: true }), true)).toBe('app');
    expect(keyTarget(e('¡', 'Digit1', { metaKey: true, altKey: true }), true)).toBe('app');
  });
  it('⌘L·⌘+·⌘−·⌘0 은 아무 데도(주소창 없음, 앱 글자 크기 안 바뀌게)', () => {
    for (const [key, code] of <[string, string][]>[['l', 'KeyL'], ['=', 'Equal'], ['-', 'Minus'], ['0', 'Digit0']]) expect(keyTarget(e(key, code, { metaKey: true }), true)).toBe('none');
  });
});

describe('menuRoute — 브라우저가 키를 가진 동안 메뉴바 단축키(같은 누름이 메뉴로도 온다)', () => {
  it('⌘W(close_pane)는 모달 닫기 — 세션 끄기 아님', () => expect(menuRoute('close_pane')).toBe('close'));
  it('설정·완전 종료·⌥⌘ 화면 이동은 앱', () => { for (const id of ['settings', 'app_quit_all', 'goto_office']) expect(menuRoute(id)).toBe('app'); });
  it('나머지(글자 크기·검색·리더·⌘A …)는 버린다 — 키 쪽이 이미 브라우저로 보냈다', () => {
    for (const id of ['font_up', 'font_reset', 'search', 'reader_toggle', 'select_all', 'new_session', 'memo']) expect(menuRoute(id)).toBe('none');
  });
});

describe('escClose — Esc 한 번은 페이지로, 빠르게 두 번이면 모달 닫기', () => {
  it('0.5초 안 두 번째', () => { expect(escClose(1000, 1400)).toBe(true); expect(escClose(1000, 1600)).toBe(false); expect(escClose(0, 1000)).toBe(false); });
});

import { approach } from './agentInput';
describe('approach — 멀리서 바로 누르면 사이에 이동을 끼운다(순간이동으로 안 보이게)', () => {
  it('가까우면 없음', () => expect(approach({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 })).toEqual([]));
  it('멀면 고르게 4걸음(도착점은 빼고)', () => {
    const s = approach({ x: 0, y: 0 }, { x: 0.5, y: 0.25 });
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ x: 0.1, y: 0.05 });
    expect(s[3]).toEqual({ x: 0.4, y: 0.2 });
  });
  it('처음(어디서 왔는지 모름)이면 없음', () => expect(approach(null, { x: 0.9, y: 0.9 })).toEqual([]));
});

describe('unfocusedKey — 저절로 뜬 모달(글칸 포커스 없음)에서 닫기 키는 모달 몫(리뷰: ⌘W 가 뒤 세션을 껐다)', () => {
  const k = (key: string, code: string, o: Partial<{ metaKey: boolean }> = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  it('Esc·⌘W 는 모달 닫기', () => {
    expect(unfocusedKey(k('Escape', 'Escape'))).toBe('close');
    expect(unfocusedKey(k('w', 'KeyW', { metaKey: true }))).toBe('close');
  });
  it('나머지는 그대로(앱 단축키·대화상자 입력칸)', () => {
    expect(unfocusedKey(k('a', 'KeyA'))).toBe('pass');
    expect(unfocusedKey(k('1', 'Digit1', { metaKey: true }))).toBe('pass');
  });
});

import { escCancelsDialog } from './agentInput';
describe('escCancelsDialog — 페이지 대화상자가 떠 있으면 Esc 는 대화상자 취소(QA N7: 모달이 닫히고 대화상자는 남았다)', () => {
  it('대화상자가 있을 때 Esc 만', () => {
    expect(escCancelsDialog({ key: 'Escape' }, true)).toBe(true);
    expect(escCancelsDialog({ key: 'Escape' }, false)).toBe(false);
    expect(escCancelsDialog({ key: 'Enter' }, true)).toBe(false);
  });
});
