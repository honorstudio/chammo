// 첫 그림(mobile.html #boot-splash)이 앱 대표 모찌(BrandMark)와 같은 모양·색인지 — 손으로 옮긴 그림이라 모찌가 바뀌면 여기서 걸린다.
// 폰 서버 CSP(script-src 'self')가 인라인 스크립트를 막으니 껍데기엔 그림·스타일만 둔다
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import mobileHtml from '../../../mobile.html?raw';
import { BrandMark } from '../avatar/BrandMark';
import { BRAND } from '../../domain/avatar';

describe('mobile.html 첫 그림 — 모찌 한 장', () => {
  const mark = renderToStaticMarkup(createElement(BrandMark, { size: 96 }));
  const splash = /<div id="boot-splash"[^>]*>([\s\S]*?)<\/div>/.exec(mobileHtml)?.[1] ?? '';
  it('JS 전에 보이게 body 맨 앞(#root 보다 먼저)에 있다', () => {
    expect(splash).not.toBe('');
    expect(mobileHtml.indexOf('id="boot-splash"')).toBeLessThan(mobileHtml.indexOf('id="root"'));
  });
  it('몸·눈 모양과 색이 BrandMark 와 같다', () => {
    const body = /class="oa-body" d="([^"]+)"/.exec(mark)![1]!;
    expect(splash).toContain(`fill="${BRAND.color}" d="${body}"`);
    for (const m of mark.matchAll(/<ellipse class="oa-w" cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/g)) {
      expect(splash).toContain(`cx="${m[1]}" cy="${m[2]}" rx="${m[3]}" ry="${m[4]}"`);
    }
  });
  it('인라인 스크립트가 없다(CSP 에 막혀 조용히 안 돈다)', () => {
    expect(/<script(?![^>]*\bsrc=)[^>]*>/.test(mobileHtml)).toBe(false);
  });
});
