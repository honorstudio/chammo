import { describe, expect, it } from 'vitest';
import { isCompacting } from './compacting';

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
