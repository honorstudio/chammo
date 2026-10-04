import { describe, expect, it } from 'vitest';
import { codeFromText, groupCode, pairCodeFrom } from './mobileAuth';

describe('짝짓기 주소에서 코드 읽기', () => {
  it('?pair= 의 16진 32자만', () => {
    const c = 'a'.repeat(32);
    expect(pairCodeFrom(`?pair=${c}`)).toBe(c);
    expect(pairCodeFrom(`?x=1&pair=${c}`)).toBe(c);
    expect(pairCodeFrom('?pair=zz')).toBeNull();
    expect(pairCodeFrom(`?pair=${c}0`)).toBeNull();
    expect(pairCodeFrom(`?k=${'f'.repeat(64)}`)).toBeNull();
    expect(pairCodeFrom('')).toBeNull();
  });
});

describe('codeFromText — 붙여 넣은 글에서 연결 코드(홈 화면 앱 연결)', () => {
  const c = '0123456789abcdef0123456789abcdef';
  it('코드 그대로·띄어 쓴 묶음·대문자·앞뒤 공백', () => {
    expect(codeFromText(c)).toBe(c);
    expect(codeFromText(' 0123 4567 89ab cdef 0123 4567 89AB CDEF\n')).toBe(c);
  });
  it('주소를 통째로 붙여도(?pair=)', () => {
    expect(codeFromText(`https://mac.ts.net/?pair=${c}`)).toBe(c);
  });
  it('모양이 다르면 null', () => {
    expect(codeFromText('hello')).toBeNull();
    expect(codeFromText(c.slice(1))).toBeNull();
    expect(codeFromText(`${c}0`)).toBeNull();
  });
});

describe('groupCode — 화면에 읽기 좋게 4자씩', () => {
  it('묶음', () => {
    expect(groupCode('0123456789abcdef0123456789abcdef')).toBe('0123 4567 89ab cdef 0123 4567 89ab cdef');
  });
});
