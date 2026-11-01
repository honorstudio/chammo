import { describe, expect, it } from 'vitest';
import { HTML_SANDBOX, htmlFrame } from './htmlFrame';
import { frameSafe } from '../../phone-web/proxy';

describe('html 파일 보기 — 샌드박스', () => {
  it('스크립트만 허용, 같은 출처는 절대 아님(부모 localStorage·/api 에 못 닿게)', () => {
    const v = HTML_SANDBOX.split(/\s+/);
    expect(v).toContain('allow-scripts');
    expect(v).not.toContain('allow-same-origin');
    // 위로 이동·팝업·폼 보내기도 안 준다
    for (const bad of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-forms', 'allow-modals']) expect(v).not.toContain(bad);
  });

  it('테일넷 길은 sandbox 속성 + 곁 파일 주소 그대로', () => {
    expect(htmlFrame('/api/html/t/a.html', false)).toEqual({ src: '/api/html/t/a.html', sandbox: HTML_SANDBOX });
  });

  it('중계 길은 sandbox 속성 없이(속성이 있으면 서비스 워커가 칸 요청을 못 받아 입구 404 — 2026-11-01 흰 화면), 그림은 품어서', () => {
    expect(htmlFrame('/api/html/t/a.html', true)).toEqual({ src: '/api/html/t/a.html?inline=1' });
    expect(htmlFrame('/api/html?t=x', true).src).toBe('/api/html?t=x&inline=1');
  });
});

describe('대신 받기 거름 — 시안 칸 답은 응답 CSP sandbox 가 있어야', () => {
  const box = "sandbox allow-scripts; default-src 'none'";
  it('시안 길 답은 sandbox 가 있어야 넘긴다', () => {
    expect(frameSafe('/api/html/t/a.html?inline=1', { 'content-security-policy': box })).toBe(true);
    expect(frameSafe('/api/html/t/a.html', { 'Content-Security-Policy': "default-src 'none'; sandbox" })).toBe(true);
    expect(frameSafe('/api/html/t/a.html', {})).toBe(false);
    expect(frameSafe('/api/html/t/a.html', { 'content-type': 'text/html' })).toBe(false);
    expect(frameSafe('/api/html?t=x', { 'content-security-policy': "default-src 'self'" })).toBe(false);
    expect(frameSafe('/api/html/t/a.html', { 'content-security-policy': 'sandbox allow-scripts allow-same-origin' })).toBe(false);
    expect(frameSafe('/api/html/t/a.html', { 'content-security-policy': "default-src 'none'; script-src 'self' x-sandbox" })).toBe(false);
  });
  it('다른 길은 그대로', () => {
    expect(frameSafe('/api/sessions', {})).toBe(true);
    expect(frameSafe('/api/htmlx', {})).toBe(true);
  });
});
