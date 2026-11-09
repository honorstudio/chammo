import { describe, expect, it } from 'vitest';
import { DOC_SANITIZE, docImages } from './md';
import readerSrc from './reader/Reader.tsx?raw';

// 보안 점검 M-2(2026-11-07) — 남의 .md 를 열면 메인 창 안에 가짜 승인 카드를 그리고, 바깥 그림으로 '열었다' 신호를 보낼 수 있었다.
// 시험 환경엔 DOM 이 없어 DOMPurify 는 거름 설정과 그 뒤 단계만 본다(실제 거름은 WKWebView 로 실측)
const local = (src: string) => `hodoc://x/${src}`;

describe('DOC_SANITIZE — 리더 문서 거름 설정', () => {
  it('화면을 흉내 내는 속성과 바깥을 부르는 속성을 막는다', () => {
    for (const a of ['style', 'class', 'id', 'srcset', 'background', 'poster']) expect(DOC_SANITIZE.FORBID_ATTR).toContain(a);
    expect(DOC_SANITIZE.ALLOW_DATA_ATTR).toBe(false);
  });
  it('틀·영상·소리·svg 그림을 막고 그림은 둔다', () => {
    for (const t of ['style', 'iframe', 'object', 'embed', 'form', 'video', 'audio', 'source', 'picture', 'image', 'link', 'meta', 'base']) expect(DOC_SANITIZE.FORBID_TAGS).toContain(t);
    expect(DOC_SANITIZE.FORBID_TAGS).not.toContain('img');
  });
  it('리더가 이 길을 쓴다 — 거름을 따로 두지 않는다', () => {
    expect(readerSrc).toMatch(/docHtml\(md, /);
    expect(readerSrc).not.toMatch(/DOMPurify\.sanitize|from 'dompurify'/);
  });
});

describe('docImages — 거른 뒤 그림 주소', () => {
  it('상대 그림은 문서 폴더 기준으로', () => {
    expect(docImages('<p><img src="shots/a.png" alt="화면"></p>', local)).toBe('<p><img src="hodoc://x/shots/a.png" alt="화면"></p>');
  });
  it('바깥 그림은 안 불러오고 눌러서 여는 링크가 된다', () => {
    for (const src of ['https://evil.example/p.png?u=1', '//evil.example/p.png', 'HTTP://evil.example/p.png']) {
      const h = docImages(`<img src="${src}" alt="그림">`, local);
      expect(h, src).not.toMatch(/<img/i);
      expect(h, src).toBe(`<a href="${src}" title="${src}">그림</a>`);
    }
  });
  it('이름이 없으면 주소를 글로', () => {
    expect(docImages('<img src="https://a.example/b.png">', local)).toContain('>https://a.example/b.png</a>');
  });
  it('주소 없는 그림·그림 아닌 글은 그대로', () => {
    expect(docImages('<img alt="x"><p>https://a.example/b.png</p>', local)).toBe('<img alt="x"><p>https://a.example/b.png</p>');
  });
});
