import { describe, expect, it } from 'vitest';
import { isCompacting, isPasting } from './compacting';

describe('isCompacting — 터미널 화면에서 대화 압축 중인지', () => {
  it('압축 줄이 화면 아래쪽에 있으면 압축 중', () => {
    expect(isCompacting(['', '✻ Compacting conversation… (12s · esc to interrupt)', '', '> '])).toBe(true);
  });
  it('끝난 뒤의 기록 줄(Conversation compacted)은 압축 중이 아니다', () => {
    expect(isCompacting(['⎿ Conversation compacted · ctrl+o for history', '> '])).toBe(false);
  });
  it('위로 밀려난 옛 줄은 안 본다 — 아래 12줄만', () => {
    expect(isCompacting(['✻ Compacting conversation…', ...Array(14).fill('x')])).toBe(false);
  });
  it('화면이 없으면 아니다', () => {
    expect(isCompacting(undefined)).toBe(false);
  });
});

describe('isPasting — Claude 가 붙여넣은 그림을 읽는 중인지(입력칸 아래 Pasting…, 2.1.318 실측)', () => {
  const rule = '─'.repeat(30);
  it('입력칸 아래 줄이 Pasting… 이면 읽는 중', () => {
    expect(isPasting([rule, '❯ #img1 심볼', rule, '  Pasting…'])).toBe(true);
  });
  it('보통 상태 줄·입력칸 안 글은 아니다', () => {
    expect(isPasting([rule, '❯ #img1 심볼', rule, '  main* · Opus'])).toBe(false);
    expect(isPasting([rule, '❯ Pasting… 이라고 쓴 글', rule, '  main* · Opus'])).toBe(false);
    expect(isPasting(undefined)).toBe(false);
  });
});
