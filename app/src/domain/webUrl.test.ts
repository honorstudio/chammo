import { describe, expect, it } from 'vitest';
import { addressToUrl, isWebUrl, webTitle } from './webUrl';
import { kindOf } from './reader';
import { zoomable } from './readerZoom';

describe('isWebUrl — scripts/show 로 온 http(s) 주소', () => {
  it('http·https 만', () => {
    expect(isWebUrl('http://localhost:3000')).toBe(true);
    expect(isWebUrl('https://example.com/a?b=1')).toBe(true);
    for (const bad of ['/Users/a/b.html', 'localhost:3000', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'hodoc://localhost/a', 'https:///x', 'http://a b', '']) {
      expect(isWebUrl(bad), bad).toBe(false);
    }
  });
  it('kindOf 는 web — 경로 끝 .html 이어도', () => {
    expect(kindOf('http://localhost:3000/index.html')).toBe('web');
    expect(kindOf('/Users/a/index.html')).toBe('html');
    expect(zoomable('web')).toBe(false); // 앱 확대 버튼은 주소엔 안 먹는다
  });
});

describe('addressToUrl — 주소 줄에 친 것', () => {
  it('스킴이 있으면 그대로', () => {
    expect(addressToUrl('https://a.com/x')).toBe('https://a.com/x');
    expect(addressToUrl('  http://localhost:5173/  ')).toBe('http://localhost:5173/');
  });
  it('로컬·IP 는 http, 그 밖은 https', () => {
    expect(addressToUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(addressToUrl('127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080/a');
    expect(addressToUrl('192.168.0.5')).toBe('http://192.168.0.5');
    expect(addressToUrl('myapp.localhost:3000')).toBe('http://myapp.localhost:3000');
    expect(addressToUrl('example.com')).toBe('https://example.com');
  });
  it('주소가 아니면 null — 다른 스킴·빈칸 든 말', () => {
    for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'hodoc://localhost/a', 'data:text/html,x', '그냥 말', 'a b.com', 'mailto:a@b.com']) {
      expect(addressToUrl(bad), bad).toBeNull();
    }
  });
});

describe('webTitle — 막대·카드 이름', () => {
  it('호스트 + 경로', () => {
    expect(webTitle('http://localhost:3000/')).toBe('localhost:3000');
    expect(webTitle('https://example.com/a/b?x=1')).toBe('example.com/a/b');
    expect(webTitle('이상한')).toBe('이상한');
  });
});
