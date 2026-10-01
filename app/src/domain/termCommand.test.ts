import { describe, expect, it } from 'vitest';
import { attachCommand } from './termCommand';

describe('attachCommand — 세션 화면을 여는 터미널 명령(운영체제별, 윈도우판 3단계)', () => {
  it('맥: exec + 작은따옴표(셸이 claude 로 바뀐다)', () => {
    expect(attachCommand('/Users/a/.local/bin/claude', 'ab12cd34', false)).toBe("exec '/Users/a/.local/bin/claude' attach ab12cd34");
  });
  it('맥: 경로에 작은따옴표가 있어도 안 깨진다', () => {
    expect(attachCommand("/Users/o'neil/claude", 'x', false)).toBe("exec '/Users/o'\\''neil/claude' attach x");
  });
  it('윈도우: cmd 가 읽는 큰따옴표', () => {
    expect(attachCommand('C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe', 'ab12cd34', true))
      .toBe('"C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe" attach ab12cd34');
  });
});
