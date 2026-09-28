import { describe, expect, it } from 'vitest';
import { copyKeyAction, parseOsc52 } from './clipboard';

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
