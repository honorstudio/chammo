import { describe, expect, it } from 'vitest';
import { loginCancelled } from './LoginWait';

describe('로그인 취소(11-01 QA H3)', () => {
  it('사람이 취소한 건 오류로 안 본다 — Rust team_account::CANCELLED 와 같은 글', () => {
    expect(loginCancelled('로그인을 취소했어요')).toBe(true);
    expect(loginCancelled(new Error('로그인을 취소했어요'))).toBe(true);
    expect(loginCancelled('로그인 시간이 지났어(10분) — 다시 해 줘')).toBe(false);
  });
});
