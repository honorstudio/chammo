// 허용 기다림 화면 폴링 — DOM 없이 소스로 지키는 규칙(10-31 운영: 서버가 모르는 기기가 이 화면에서 2초마다 401 을 받아 하루 내내 두드림)
import { describe, expect, it } from 'vitest';
import src from './NumberWait.tsx?raw';

describe('허용 기다림 숫자 폴링', () => {
  it('창이 안 보이면 묻지 않고, 보이면 바로 한 번 묻는다', () => {
    expect(src).toMatch(/document\.hidden/);
    expect(src).toContain("addEventListener('visibilitychange'");
  });
  it('끊긴 기기(다시 로그인)라는 답이면 더 묻지 않는다', () => {
    expect(src).toMatch(/다시 로그인/);
    expect(src).toMatch(/stop = true/);
  });
});
