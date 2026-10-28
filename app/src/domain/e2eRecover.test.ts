import { describe, expect, it } from 'vitest';
import { fmtRecoverCode, hoursLeft } from './e2eRecover';

describe('계정 되찾기 화면 글자', () => {
  it('8자리는 4·4 로 띄우고, 서버가 엉뚱한 글을 주면 안 보인다', () => {
    expect(fmtRecoverCode('K7QM2XPA')).toBe('K7QM 2XPA');
    expect(fmtRecoverCode('https://evil.test')).toBe('');
    expect(fmtRecoverCode('K7QM2XP0')).toBe('', );
  });
  it('남은 시간은 올림, 지나면 0', () => {
    expect(hoursLeft(10 * 3_600_000 + 1, 0)).toBe(11);
    expect(hoursLeft(0, 5)).toBe(0);
  });
});
