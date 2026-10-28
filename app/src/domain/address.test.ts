import { describe, expect, it } from 'vitest';
import { addressTarget, searchUrl, shownAddress } from './address';

describe('브라우저 칸 주소창', () => {
  it('주소면 그 주소로 — 앞에 https:// 를 붙인다', () => {
    expect(addressTarget('naver.com', 'google')).toBe('https://naver.com/');
    expect(addressTarget('  m.naver.com/search?q=1 ', 'google')).toBe('https://m.naver.com/search?q=1');
    expect(addressTarget('https://example.com/a b', 'google')).toBe('https://example.com/a%20b');
    expect(addressTarget('http://192.168.0.10:5000', 'google')).toBe('http://192.168.0.10:5000/');
  });
  it('localhost·IP·포트는 http', () => {
    expect(addressTarget('localhost:3000', 'google')).toBe('http://localhost:3000/');
    expect(addressTarget('127.0.0.1:8080/x', 'google')).toBe('http://127.0.0.1:8080/x');
  });
  it('주소가 아니면 검색 — 기본 구글, 설정에서 네이버', () => {
    expect(addressTarget('유튜브', 'google')).toBe('https://www.google.com/search?q=%EC%9C%A0%ED%8A%9C%EB%B8%8C');
    expect(addressTarget('유튜브', 'naver')).toBe('https://search.naver.com/search.naver?query=%EC%9C%A0%ED%8A%9C%EB%B8%8C');
    expect(addressTarget('how to cook rice', 'google')).toBe('https://www.google.com/search?q=how%20to%20cook%20rice');
    expect(addressTarget('node.js tutorial', 'google')).toContain('google.com/search'); // 띄어쓰기 = 검색
    expect(addressTarget('hello', '')).toContain('google.com/search'); // 모르는 값은 구글
  });
  it('위험하거나 빈 것은 안 간다', () => {
    expect(addressTarget('javascript:alert(1)', 'google')).toContain('google.com/search');
    expect(addressTarget('file:///etc/passwd', 'google')).toContain('google.com/search');
    expect(addressTarget('chrome://settings', 'google')).toContain('google.com/search');
    expect(addressTarget('   ', 'google')).toBeNull();
  });
  it('검색 주소', () => {
    expect(searchUrl('a&b', 'naver')).toBe('https://search.naver.com/search.naver?query=a%26b');
  });
  it('보여 줄 주소 — about:blank 는 빈 칸', () => {
    expect(shownAddress('about:blank')).toBe('');
    expect(shownAddress('https://www.naver.com/')).toBe('https://www.naver.com/');
    expect(shownAddress(undefined)).toBe('');
    // 크롬처럼 읽을 수 있게 — %EC… 대신 한글(못 풀면 그대로)
    expect(shownAddress('https://search.naver.com/search.naver?query=%EC%9C%A0%ED%8A%9C%EB%B8%8C')).toBe('https://search.naver.com/search.naver?query=유튜브');
    expect(shownAddress('https://a.com/%E0%A4%A')).toBe('https://a.com/%E0%A4%A');
  });
});
