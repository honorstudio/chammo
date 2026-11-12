import { describe, expect, it } from 'vitest';
import { copyKeyAction, parseOsc52, winTermKey } from './clipboard';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const key = (k: string, mods: Partial<{ metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
});

describe('parseOsc52', () => {
  it('클립보드(c)에 쓰라는 요청을 글자로 푼다', () => {
    expect(parseOsc52(`c;${b64('hello world')}`)).toBe('hello world');
  });

  it('한글·이모지 같은 UTF-8도 깨지지 않는다', () => {
    expect(parseOsc52(`c;${b64('복사된 한글 줄\n둘째 줄')}`)).toBe('복사된 한글 줄\n둘째 줄');
  });

  it('선택 대상이 비어 있거나 여러 개여도 쓴다 (Claude Code 는 c, tmux 는 빈 칸을 보낸다)', () => {
    expect(parseOsc52(`;${b64('a')}`)).toBe('a');
    expect(parseOsc52(`pc;${b64('b')}`)).toBe('b');
  });

  it('클립보드 읽기 요청(?)은 무시한다 — 세션이 사용자 클립보드를 훔쳐보지 못하게', () => {
    expect(parseOsc52('c;?')).toBeNull();
  });

  it('형식이 틀리면 무시한다', () => {
    expect(parseOsc52('no-semicolon')).toBeNull();
    expect(parseOsc52('c;@@@not base64@@@')).toBeNull();
  });

  it('빈 내용은 무시한다 (xterm 규약상 "지워라"지만 사용자 클립보드를 날리지 않는다)', () => {
    expect(parseOsc52('c;')).toBeNull();
  });
});

describe('copyKeyAction', () => {
  it('⌘C + xterm 선택이 있으면 그 선택을 복사한다', () => {
    expect(copyKeyAction(key('c', { metaKey: true }), true)).toBe('copySelection');
  });

  it('⌘C + 선택이 없으면 삼킨다 — 드래그 복사는 이미 OSC 52 로 끝났고, 넘기면 편집 메뉴가 삑 소리를 낸다', () => {
    expect(copyKeyAction(key('c', { metaKey: true }), false)).toBe('swallow');
  });

  it('한글 입력 상태의 ⌘ㅊ 도 ⌘C 다', () => {
    expect(copyKeyAction(key('ㅊ', { metaKey: true }), false)).toBe('swallow');
  });

  it('⌘C 가 아니면 상관하지 않는다', () => {
    expect(copyKeyAction(key('c'), true)).toBeNull();
    expect(copyKeyAction(key('c', { ctrlKey: true }), true)).toBeNull(); // Ctrl+C 는 Claude 로 가는 중단 키
    expect(copyKeyAction(key('c', { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(copyKeyAction(key('v', { metaKey: true }), true)).toBeNull();
  });
});

describe('윈도우 터미널 복사·붙여넣기 — 윈도우 터미널 관례(Ctrl+C 는 선택이 있을 때만 복사, 없으면 멈추기)', () => {
  const k = (code: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
    ({ key: code.slice(3).toLowerCase(), code, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, metaKey: false });
  it('Ctrl+Shift+C = 복사(선택 없으면 삼킴), Ctrl+C 는 선택이 있을 때만 복사', () => {
    expect(winTermKey(k('KeyC', { ctrl: true, shift: true }), true)).toBe('copy');
    expect(winTermKey(k('KeyC', { ctrl: true, shift: true }), false)).toBe('swallow');
    expect(winTermKey(k('KeyC', { ctrl: true }), true)).toBe('copy');
    expect(winTermKey(k('KeyC', { ctrl: true }), false)).toBeNull(); // 터미널로 — Claude 멈추기
  });
  it('Ctrl+V·Ctrl+Shift+V = 글 붙여넣기(웹뷰에 맡긴다), Alt+V 는 Claude 그림 붙여넣기라 그대로', () => {
    expect(winTermKey(k('KeyV', { ctrl: true }), false)).toBe('paste');
    expect(winTermKey(k('KeyV', { ctrl: true, shift: true }), false)).toBe('paste');
    expect(winTermKey(k('KeyV', { alt: true }), false)).toBeNull();
    expect(winTermKey(k('KeyX', { ctrl: true }), false)).toBeNull();
  });
});

// 공개 이슈 #21: 윈도우 터미널 보기에서 그림만 든 클립보드로 Ctrl+V 하면 xterm 은 글만 읽어 아무 일도 없었다 —
// Claude 의 윈도우 그림 붙여넣기 키(Alt+V = ESC v)를 대신 넣는다. 글이 있으면 웹뷰 붙여넣기 그대로
import { winPasteKeys } from './clipboard';
import termPane from '../ui/TerminalPane.tsx?raw';
describe('윈도우 터미널 Ctrl+V — 그림이면 Alt+V', () => {
  it('그림·파일만 → ESC v, 글이 있으면 null(웹뷰가 붙여넣는다)', () => {
    expect(winPasteKeys([{ kind: 'file', type: 'image/png' }], false)).toBe('\x1bv');
    expect(winPasteKeys([{ kind: 'string', type: 'text/plain' }], true)).toBeNull();
    expect(winPasteKeys([], false)).toBe('\x1bv');
  });
  it('글과 그림이 같이 든 클립보드(엑셀·워드 복사는 비트맵도 싣는다)는 글로 — 0.4.13 처럼 null', () => {
    expect(winPasteKeys([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png' }], true)).toBeNull();
    expect(winPasteKeys([{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/bmp' }], true)).toBeNull();
  });
  it('터미널 보기는 윈도우에서만 붙여넣기 사건을 먼저 받아 그 키를 쓴다', () => {
    expect(termPane).toMatch(/IS_WIN && !readOnly[^\n]*addEventListener\('paste', [a-zA-Z]+, true\)/);
    expect(termPane).toContain('winPasteKeys([...');
  });
});

// 공개 이슈 #23(추정): WebView2 글 예측이 xterm 숨은 입력칸에 제안을 붙인다 — 자동 완성·글 제안 끄기
describe('터미널 입력칸 글 제안 끄기', () => {
  it('xterm 입력칸에 autocomplete off · writingsuggestions false', () => {
    expect(termPane).toContain("term.textarea?.setAttribute('autocomplete', 'off')");
    expect(termPane).toContain("term.textarea?.setAttribute('writingsuggestions', 'false')");
  });
});
