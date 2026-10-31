import { describe, expect, it } from 'vitest';
import dash from './OrchDash.tsx?raw';
import css from './mobile.css?raw';

// 2026-10-12 사용자 "ㄱㄱ"(참모-2 전달) — 폰 '홈 | 보관함' 알약 두 칸이 카드|목록 같은 켜기로 보였다(데스크톱과 같은 착각).
// 켜고 끄는 게 아니라 자리를 옮기는 것 → 탭 모양(데스크톱 탭 줄 맨 왼쪽 고정 탭 홈·보관함과 같은 말)
describe('폰 홈 | 보관함 = 탭', () => {
  it('알약(m-seg) 대신 탭 줄', () => {
    expect(dash).toMatch(/className="m-dash-tabs" role="tablist" aria-label=\{tr\('홈·보관함', 'Home and locker'\)\}/);
    expect(dash).not.toMatch(/m-seg m-dash-seg/);
  });
  it('탭 모양 — 아래 선 위 글자, 고른 탭은 굵게 + 아래 굵은 밑줄(알약 면 없음), 누르는 자리 44', () => {
    expect(css).toMatch(/\.m-dash-tabs \{[^}]*border-bottom: 1px solid var\(--line\)/);
    expect(css).toMatch(/\.m-dash-tabs button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.m-dash-tabs button\.m-on \{[^}]*box-shadow: inset 0 -2px 0 var\(--text\)/);
    expect(css).not.toMatch(/\.m-dash-seg/);
  });
});
