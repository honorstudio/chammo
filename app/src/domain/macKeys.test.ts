import { describe, expect, it } from 'vitest';
import { ctrlLetter, macKeySequence, type KeyLike } from './macKeys';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
});

describe('macKeySequence — Terminal.app이 보내는 것과 같은 시퀀스로', () => {
  it('⌘⌫ → 줄 처음까지 지우기 (Ctrl+U)', () => {
    expect(macKeySequence(key('Backspace', { metaKey: true }))).toBe('\x15');
  });

  it('⌘← → 줄 처음 (Ctrl+A)', () => {
    expect(macKeySequence(key('ArrowLeft', { metaKey: true }))).toBe('\x01');
  });

  it('⌘→ → 줄 끝 (Ctrl+E)', () => {
    expect(macKeySequence(key('ArrowRight', { metaKey: true }))).toBe('\x05');
  });

  it('⌥⌫ → 단어 지우기 (ESC DEL)', () => {
    expect(macKeySequence(key('Backspace', { altKey: true }))).toBe('\x1b\x7f');
  });

  it('⌥← → 단어 뒤로 (ESC b)', () => {
    expect(macKeySequence(key('ArrowLeft', { altKey: true }))).toBe('\x1bb');
  });

  it('⌥→ → 단어 앞으로 (ESC f)', () => {
    expect(macKeySequence(key('ArrowRight', { altKey: true }))).toBe('\x1bf');
  });

  it('수식키가 하나 더 붙으면(⌘⇧⌫) 건드리지 않는다', () => {
    expect(macKeySequence(key('Backspace', { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('수식키 없는 Backspace는 xterm 몫', () => {
    expect(macKeySequence(key('Backspace'))).toBeNull();
  });

  it('⌘C 같은 다른 조합은 모른 척한다 (브라우저·xterm이 처리)', () => {
    expect(macKeySequence(key('c', { metaKey: true }))).toBeNull();
  });
});

describe('줄바꿈 — Shift+Enter · ⌥Enter (보내지 않고 입력칸에서 다음 줄)', () => {
  it('Shift+Enter → ESC CR (Claude Code 가 줄바꿈으로 받음 — 실제 세션으로 확인 2026-09-27)', () => {
    expect(macKeySequence(key('Enter', { shiftKey: true }))).toBe('\x1b\r');
  });
  it('⌥Enter 도 같은 줄바꿈', () => {
    expect(macKeySequence(key('Enter', { altKey: true }))).toBe('\x1b\r');
  });
  it('그냥 Enter 는 그대로 (보내기)', () => {
    expect(macKeySequence(key('Enter'))).toBeNull();
  });
});

describe('ctrlLetter — 한글 조합 중에도 Ctrl+글자는 제어 문자로(ctrl+x ctrl+s 가 사라지던 것)', () => {
  const k = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }> = {}) =>
    ({ code, key: 'Process', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o });
  it('물리 키 자리로 — 입력기가 key 를 Process(229)로 줘도', () => {
    expect(ctrlLetter(k('KeyX'))).toBe('\x18');
    expect(ctrlLetter(k('KeyS'))).toBe('\x13');
    expect(ctrlLetter(k('KeyC', { key: 'ㅊ' }))).toBe('\x03');
  });
  it('Ctrl 만 — ⌘·⌥·Shift 가 같이 눌리거나 글자 키가 아니면 null', () => {
    expect(ctrlLetter(k('KeyX', { metaKey: true }))).toBeNull();
    expect(ctrlLetter(k('KeyX', { altKey: true }))).toBeNull();
    expect(ctrlLetter(k('KeyX', { shiftKey: true }))).toBeNull();
    expect(ctrlLetter(k('Tab'))).toBeNull();
    expect(ctrlLetter(k('KeyX', { ctrlKey: false }))).toBeNull();
  });
});
