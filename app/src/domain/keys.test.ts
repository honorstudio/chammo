import { describe, expect, it } from 'vitest';
import { fileManagerLabel, keyLabel, modKey, winToMac } from './keys';
import { shortcutFor } from './shortcuts';

const k = (key: string, code: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  key, code, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, metaKey: !!m.meta,
});

describe('윈도우 키 → 맥 단축키로 읽기 — Ctrl+글자는 터미널(Claude) 몫이라 앱은 Ctrl+Shift+글자', () => {
  it('Ctrl+Shift+글자 = ⌘글자 (한글 입력 상태여도 키 자리로)', () => {
    expect(shortcutFor(k('B', 'KeyB', { ctrl: true, shift: true }), true)).toEqual({ type: 'toggleSidebar' });
    expect(shortcutFor(k('ㅠ', 'KeyB', { ctrl: true, shift: true }), true)).toEqual({ type: 'toggleSidebar' });
    expect(shortcutFor(k('W', 'KeyW', { ctrl: true, shift: true }), true)).toEqual({ type: 'closeTab' });
    expect(shortcutFor(k('M', 'KeyM', { ctrl: true, shift: true }), true)).toEqual({ type: 'memo' });
  });
  it('Ctrl+글자만 누르면 앱은 가만히 — 터미널로 간다', () => {
    for (const c of ['k', 'w', 't', 'b', 'j', 'e', 'a', 'm']) {
      expect(shortcutFor(k(c, `Key${c.toUpperCase()}`, { ctrl: true }), true)).toBeNull();
    }
  });
  it('숫자·기호는 Ctrl 하나로', () => {
    expect(shortcutFor(k('1', 'Digit1', { ctrl: true }), true)).toEqual({ type: 'num', n: 1 });
    expect(shortcutFor(k('=', 'Equal', { ctrl: true }), true)).toEqual({ type: 'font', delta: 1 });
    expect(shortcutFor(k('+', 'Equal', { ctrl: true, shift: true }), true)).toEqual({ type: 'font', delta: 1 });
    expect(shortcutFor(k('-', 'Minus', { ctrl: true }), true)).toEqual({ type: 'font', delta: -1 });
    expect(shortcutFor(k('0', 'Digit0', { ctrl: true }), true)).toEqual({ type: 'fontReset' });
    expect(shortcutFor(k('`', 'Backquote', { ctrl: true }), true)).toEqual({ type: 'homeToggle' });
    expect(shortcutFor(k('~', 'Backquote', { ctrl: true, shift: true }), true)).toEqual({ type: 'maximizePane' }); // Ctrl+Shift+` = 창 크게(2026-10-25)
    expect(shortcutFor(k(',', 'Comma', { ctrl: true }), true)).toEqual({ type: 'settings' });
  });
  it('Ctrl+Alt+숫자 = 화면 이동, Ctrl+Alt+E = 리더 크게, Ctrl+Shift+/ = 둘러보기', () => {
    expect(shortcutFor(k('2', 'Digit2', { ctrl: true, alt: true }), true)).toEqual({ type: 'goto', to: 'all' });
    expect(shortcutFor(k('e', 'KeyE', { ctrl: true, alt: true }), true)).toEqual({ type: 'readerFull' });
    expect(shortcutFor(k('?', 'Slash', { ctrl: true, shift: true }), true)).toEqual({ type: 'tour' });
    expect(shortcutFor(k('/', 'Slash', { ctrl: true }), true)).toBeNull(); // Ctrl+/ 는 터미널 되돌리기
  });
  it('윈도우: ⌘⇧글자(세션 끄기·새 세션·홈·보관함)는 Ctrl+Alt+글자 — Ctrl+Shift+글자는 ⇧ 없는 ⌘글자 몫', () => {
    expect(shortcutFor(k('w', 'KeyW', { ctrl: true, alt: true }), true)).toEqual({ type: 'closePane' });
    expect(shortcutFor(k('t', 'KeyT', { ctrl: true, alt: true }), true)).toEqual({ type: 'newSession' });
    expect(shortcutFor(k('h', 'KeyH', { ctrl: true, alt: true }), true)).toEqual({ type: 'goHome' });
    expect(shortcutFor(k('l', 'KeyL', { ctrl: true, alt: true }), true)).toEqual({ type: 'goLocker' });
    expect(shortcutFor(k('T', 'KeyT', { ctrl: true, shift: true }), true)).toEqual({ type: 'newDoc' });
    expect(shortcutFor(k('q', 'KeyQ', { ctrl: true, alt: true }), true)).toBeNull();
  });
  it('윈도우 키(meta)는 앱이 안 쓴다, 맥은 그대로', () => {
    expect(shortcutFor(k('b', 'KeyB', { meta: true }), true)).toBeNull();
    expect(winToMac(k('a', 'KeyA'))).toBeNull();
    expect(shortcutFor(k('b', 'KeyB', { meta: true }), false)).toEqual({ type: 'toggleSidebar' });
    expect(shortcutFor(k('B', 'KeyB', { ctrl: true, shift: true }), false)).toBeNull();
  });
});

describe('화면 표기 — ⌘ 를 윈도우 키 이름으로', () => {
  it('글자는 Ctrl+Shift, 숫자·기호는 Ctrl', () => {
    expect(keyLabel('메모(⌘M)', true)).toBe('메모(Ctrl+Shift+M)');
    expect(keyLabel('작업 패널(⌘J) · ⌘1', true)).toBe('작업 패널(Ctrl+Shift+J) · Ctrl+1');
    expect(keyLabel('⌘₩ 로 홈', true)).toBe('Ctrl+` 로 홈');
    expect(keyLabel('⌘⇧₩ 로 크게', true)).toBe('Ctrl+Shift+` 로 크게');
    expect(keyLabel('⌘+ ⌘- ⌘0', true)).toBe('Ctrl++ Ctrl+- Ctrl+0');
  });
  it('⌥⌘숫자·⌘⇧E·⌘Enter·⌘클릭·⌘/·⌥⌘Q', () => {
    expect(keyLabel('전체 보기(⌥⌘2)', true)).toBe('전체 보기(Ctrl+Alt+2)');
    expect(keyLabel('⌘⇧E', true)).toBe('Ctrl+Alt+E');
    expect(keyLabel('⌘⇧W · ⌘⇧T · ⌘⇧H · ⌘⇧L', true)).toBe('Ctrl+Alt+W · Ctrl+Alt+T · Ctrl+Alt+H · Ctrl+Alt+L');
    expect(keyLabel('⌘W · ⌘T', true)).toBe('Ctrl+Shift+W · Ctrl+Shift+T');
    expect(keyLabel('⌘Enter 끊고 보내기', true)).toBe('Ctrl+Enter 끊고 보내기');
    expect(keyLabel('⌘클릭', true)).toBe('Ctrl+클릭');
    expect(keyLabel('⌘/', true)).toBe('Ctrl+Shift+/');
    expect(keyLabel('⌥⌘Q', true)).toBe('Ctrl+Alt+Shift+Q');
  });
  it('맥은 그대로', () => {
    expect(keyLabel('메모(⌘M)', false)).toBe('메모(⌘M)');
  });
});

describe('modKey — 맥 ⌘ 자리(⌘Enter·⌘클릭)를 윈도우에선 Ctrl 로', () => {
  it('윈도우 Ctrl, 맥 ⌘', () => {
    expect(modKey({ metaKey: false, ctrlKey: true }, true)).toBe(true);
    expect(modKey({ metaKey: true, ctrlKey: false }, true)).toBe(false);
    expect(modKey({ metaKey: true, ctrlKey: false }, false)).toBe(true);
    expect(modKey({ metaKey: false, ctrlKey: true }, false)).toBe(false);
  });
});

describe('code 가 빈 키(원격 입력·일부 입력기) — key 로 대신 읽는다', () => {
  it('Ctrl+Shift+B, Ctrl+1', () => {
    expect(shortcutFor(k('B', '', { ctrl: true, shift: true }), true)).toEqual({ type: 'toggleSidebar' });
    expect(shortcutFor(k('1', '', { ctrl: true }), true)).toEqual({ type: 'num', n: 1 });
    expect(shortcutFor(k('b', '', { ctrl: true }), true)).toBeNull();
  });
});

describe('윈도우 뒤로·앞으로 — Ctrl+[ 는 터미널 Esc 라 뺏지 않는다', () => {
  it('Ctrl+Shift+[ ] = ⌘[ ⌘], Ctrl+[ 는 터미널로', () => {
    expect(shortcutFor(k('{', 'BracketLeft', { ctrl: true, shift: true }), true)).toEqual({ type: 'nav', dir: -1 });
    expect(shortcutFor(k('}', 'BracketRight', { ctrl: true, shift: true }), true)).toEqual({ type: 'nav', dir: 1 });
    expect(shortcutFor(k('[', 'BracketLeft', { ctrl: true }), true)).toBeNull();
  });
  it('화면 표기도 Ctrl+Shift+[', () => expect(keyLabel('⌘[', true)).toBe('Ctrl+Shift+['));
});

describe('화면 표기 — 파인더·Finder 를 윈도우 탐색기로', () => {
  it('윈도우는 파인더 → 탐색기, Finder → File Explorer', () => {
    expect(fileManagerLabel('아직 주고받은 파일이 없어요 — 파인더에서 끌어놓거나 + 로 골라 넣어요', true)).toBe('아직 주고받은 파일이 없어요 — 탐색기에서 끌어놓거나 + 로 골라 넣어요');
    expect(fileManagerLabel('Nothing yet — drop files from Finder or press +', true)).toBe('Nothing yet — drop files from File Explorer or press +');
    expect(fileManagerLabel('Show in Finder', true)).toBe('Show in File Explorer');
    expect(fileManagerLabel('파인더와 같은 모양', true)).toBe('탐색기와 같은 모양');
  });
  it('맥은 그대로', () => {
    expect(fileManagerLabel('파인더에서 보기', false)).toBe('파인더에서 보기');
    expect(fileManagerLabel('Show in Finder', false)).toBe('Show in Finder');
  });
  it('tr 가 윈도우 설정이면 파인더 문구를 바꾼다', async () => {
    const i18n = await import('../i18n');
    i18n.setWinKeys(true);
    expect(i18n.tr('파인더에서 보기', 'Show in Finder')).toBe('탐색기에서 보기');
    i18n.setLang('en');
    expect(i18n.tr('파인더에서 보기', 'Show in Finder')).toBe('Show in File Explorer');
    i18n.setLang('ko');
    i18n.setWinKeys(false);
    expect(i18n.tr('파인더에서 보기', 'Show in Finder')).toBe('파인더에서 보기');
  });
});

// 2026-10-22 사용자 제보(윈도우 Ctrl +/- 로 채팅 글자가 안 바뀜) — 시험 PC 진짜 키로 재 보니 숫자패드 +/- 는 code 가 NumpadAdd·NumpadSubtract 라
// winToMac 가 버려 아무 일도 없었다(맥은 메뉴 ⌘+ 가 받는다). 위쪽 줄 Ctrl+= / Ctrl+- / Ctrl+0 은 원래 됐다
describe('윈도우 숫자패드 Ctrl + / - / 0 도 글자 크기', () => {
  it('숫자패드', () => {
    expect(shortcutFor(k('+', 'NumpadAdd', { ctrl: true }), true)).toEqual({ type: 'font', delta: 1 });
    expect(shortcutFor(k('-', 'NumpadSubtract', { ctrl: true }), true)).toEqual({ type: 'font', delta: -1 });
    expect(shortcutFor(k('0', 'Numpad0', { ctrl: true }), true)).toEqual({ type: 'fontReset' });
  });
  it('원래 되던 위쪽 줄은 그대로, Alt·Shift 섞이면 안 잡는다', () => {
    expect(shortcutFor(k('=', 'Equal', { ctrl: true }), true)).toEqual({ type: 'font', delta: 1 });
    expect(shortcutFor(k('-', 'Minus', { ctrl: true }), true)).toEqual({ type: 'font', delta: -1 });
    expect(shortcutFor(k('+', 'NumpadAdd', { ctrl: true, alt: true }), true)).toBeNull();
    expect(winToMac(k('+', 'NumpadAdd', {}))).toBeNull(); // Ctrl 없으면 그냥 글자
  });
});
