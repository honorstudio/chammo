// 짝짓기 QR 의 # 뒤 읽기 · 중계 서명 글 · 껍데기 받기 거름
import { describe, expect, it } from 'vitest';
import { parsePairHash } from './link';
import { signingText } from './relayClient';
import { cssAssets, linkedAssets, shellCsp } from './shell';

const K = `B${'A'.repeat(86)}`;
const ok = `#p=${'a'.repeat(32)}&m=3f2c-11&k=${K}&r=https%3A%2F%2Frelay.example`;

describe('parsePairHash', () => {
  it('Rust qr_url 이 만든 모양을 읽는다', () => {
    expect(parsePairHash(ok)).toEqual({ code: 'a'.repeat(32), mac: '3f2c-11', macX: K, relay: 'https://relay.example' });
  });
  it('코드·열쇠·기기 id 모양이 틀리면 null', () => {
    expect(parsePairHash(ok.replace('a'.repeat(32), 'zz'))).toBeNull();
    expect(parsePairHash(ok.replace(K, 'short'))).toBeNull();
    expect(parsePairHash(ok.replace('3f2c-11', 'a/b'))).toBeNull();
    expect(parsePairHash('')).toBeNull();
  });
  it('중계 주소는 https 오리진만(개발은 로컬 http)', () => {
    expect(parsePairHash(ok.replace('https%3A%2F%2Frelay.example', 'http%3A%2F%2Frelay.example'))).toBeNull();
    expect(parsePairHash(ok.replace('https%3A%2F%2Frelay.example', 'https%3A%2F%2Frelay.example%2Fx'))).toBeNull();
    expect(parsePairHash(ok.replace('https%3A%2F%2Frelay.example', 'javascript%3Aalert(1)'))).toBeNull();
    expect(parsePairHash(ok.replace('https%3A%2F%2Frelay.example', 'http%3A%2F%2F127.0.0.1%3A8787'))?.relay).toBe('http://127.0.0.1:8787');
  });
});

it('서명할 글 = 서버 ADR 0002 모양(본문 SHA-256 base64url)', async () => {
  const t = await signingText('GET', '/v0/hubs/x/ws', '1700000000000', 'n'.repeat(22), new Uint8Array());
  expect(t).toBe(`chammo-relay/v0\nGET\n/v0/hubs/x/ws\n1700000000000\n${'n'.repeat(22)}\n47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`);
});

describe('껍데기', () => {
  it('html·css 가 가리키는 /assets 파일만 고른다', () => {
    const html = '<script type="module" src="/assets/mobile-AbCd1234.js"></script><link rel="stylesheet" href="/assets/mobile-x.css"><link rel="manifest" href="/manifest.webmanifest"><img src="https://evil/assets/a.js">';
    expect(linkedAssets(html)).toEqual(['/assets/mobile-AbCd1234.js', '/assets/mobile-x.css']);
    expect(cssAssets('a{src:url(/assets/Pretendard-1.woff2)} b{background:url(https://x/y.png)}')).toEqual(['/assets/Pretendard-1.woff2']);
  });
  it('CSP 는 연결만 중계·테일넷으로 넓힌다', () => {
    const c = shellCsp('https://relay.example');
    expect(c).toContain("connect-src 'self' https://relay.example wss://relay.example https://*.ts.net;");
    expect(c).toContain("default-src 'self'");
    expect(c).not.toContain('unsafe-eval');
  });
});
