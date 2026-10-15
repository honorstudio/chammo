// ui/kit — 데스크톱 공용 조각(의존성 0, 우리 토큰만 읽는다). 앱 테스트엔 DOM 이 없어 renderToStaticMarkup 으로 본다
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconButton } from './IconButton';
import { Badge } from './Badge';
import kitCss from './kit.css?raw';

const svg = createElement('svg', { viewBox: '0 0 16 16' });

describe('IconButton', () => {
  it('아이콘만 그리고 이름은 aria-label·title 로 — type=button', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: '닫기', onClick: () => {} }, svg));
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain('title="닫기"');
    expect(html).toContain('type="button"');
    expect(html).toMatch(/class="kit-ib kit-ib-m"/);
    expect(html).not.toMatch(/>닫기</); // 글자는 안 그린다
  });

  it('title 은 따로 줄 수 있다(긴 설명은 title, 짧은 이름은 aria-label)', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: '다시 읽기', title: '다시 읽기 — 파일을 새로 읽는다' }, svg));
    expect(html).toContain('aria-label="다시 읽기"');
    expect(html).toContain('title="다시 읽기 — 파일을 새로 읽는다"');
  });

  it('하는 중(busy)이면 못 누르고 aria-busy, 이름 뒤에 하는 중 글이 붙는다', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: '이어서 켜기', busy: true, busyLabel: '켜는 중' }, svg));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="켜는 중"');
    expect(html).toMatch(/kit-ib-busy/);
  });

  it('크기·톤·켜짐·더 붙일 클래스', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: '고정', size: 's', tone: 'line', pressed: true, className: 'x-1' }, svg));
    expect(html).toMatch(/class="kit-ib kit-ib-s kit-ib-line on x-1"/);
    expect(html).toContain('aria-pressed="true"');
  });

  it('type=submit 폼 버튼도 된다', () => {
    expect(renderToStaticMarkup(createElement(IconButton, { label: '추가', type: 'submit' }, svg))).toContain('type="submit"');
  });
});

describe('Badge', () => {
  it('숫자 배지 — 0 이면 안 그린다(zero 면 0 도), 99 넘으면 99+', () => {
    expect(renderToStaticMarkup(createElement(Badge, { n: 0 }))).toBe('');
    expect(renderToStaticMarkup(createElement(Badge, { n: 0, zero: true }))).toBe('<span class="kit-badge">0</span>');
    expect(renderToStaticMarkup(createElement(Badge, { n: 3, className: 'rv-n' }))).toBe('<span class="kit-badge rv-n">3</span>');
    expect(renderToStaticMarkup(createElement(Badge, { n: 120 }))).toBe('<span class="kit-badge">99+</span>');
  });
});

describe('kit.css', () => {
  it('읽혔다(빈 글 함정) · 글자는 11px 이상 · 숫자 z-index 없음 · 왼쪽 색 띠 없음', () => {
    expect(kitCss.length).toBeGreaterThan(100);
    for (const m of kitCss.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
    expect(kitCss).not.toMatch(/z-index:\s*\d/);
    expect(kitCss).not.toMatch(/border-left:\s*[2-9]px/);
  });
});
