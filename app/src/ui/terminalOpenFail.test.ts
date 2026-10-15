// 터미널 칸이 pty 를 못 열면(claude 경로 틀림·띄우기 실패) 아무 안내 없이 검은 칸으로 남았다 — 실패 한 줄을 그 칸에 쓴다(2026-10-11 bug-hunt)
import { describe, expect, it } from 'vitest';
import src from './TerminalPane.tsx?raw';

describe('터미널 열기 실패', () => {
  it('openPty 거절을 받아 칸에 적는다', () => {
    const call = src.slice(src.indexOf('void openPty('), src.indexOf('const refit = () =>'));
    expect(call).toMatch(/\}, \(e: unknown\) => \{/);
    expect(call).toMatch(/term\.write\(/);
  });
});
