// 위 막대 한도 칸 — 앱 테스트엔 DOM 이 없어 renderToStaticMarkup 으로 글만 본다
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LimitMeters } from './TopBar';
import { setLang } from '../i18n';
import type { Usage } from '../domain/usage';

const html = (usage: Usage) => renderToStaticMarkup(createElement(LimitMeters, { usage, age: null }));

afterEach(() => setLang('ko'));

describe('LimitMeters — Claude 한도 칸', () => {
  it('5시간 한도가 있으면 지금처럼 5시간 %', () => {
    const h = html({ five: { left: 58, resetIn: 3600 }, week: { left: 54, resetIn: 9000 } });
    expect(h).toContain('5시간');
    expect(h).toContain('58%');
  });
  it('못 읽었으면 지금처럼 "5시간 —"', () => {
    expect(html({ week: { left: 54, resetIn: 9000 } })).toContain('5시간 —');
  });
  it('한도가 없으면 5시간 자리에 요금제 이름(화면에서 대문자) — 막대 없이, 마우스 올림 설명', () => {
    const h = html({ week: { left: 54, resetIn: 9000 }, noFive: 'Ultra' });
    expect(h).not.toContain('5시간 —');
    expect(h).toMatch(/class="meter plan"[^>]*title="Ultra 요금제는 5시간 한도가 없어요. 주간 한도만 봐요"/);
    expect(h).toContain('aria-label="5시간 한도 없음, Ultra 요금제"');
    expect(h).toContain('>Ultra<');
    expect(h.match(/m-track/g)?.length).toBe(1); // 주간 막대만
  });
  it('영어', () => {
    setLang('en');
    expect(html({ noFive: 'Ultra' })).toContain('title="Ultra has no 5-hour limit. Only the weekly limit applies"');
  });
});
