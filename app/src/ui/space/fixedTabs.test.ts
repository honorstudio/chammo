import { describe, expect, it } from 'vitest';
import side from './LockerSide.tsx?raw';
import icons from '../Icons.tsx?raw';
import view from './SpaceView.tsx?raw';
import css from './locker.css?raw';

// 2026-10-12 사용자(참모-2 전달): 나무 머리 '집 | 폴더' 두 갈래 켜기는 설정 토글(카드|목록 같은 것)로 착각된다 — 켜고 끄는 게 아니라 자리를 옮기는 것.
// 홈은 탭 줄 맨 왼쪽 고정 탭(집), 바로 옆이 보관함 고정 탭(폴더), 둘 다 닫기 없음. 연 문서가 없어도 탭 줄은 늘. 나무는 보관함 폴더 나무로만
describe('탭 줄 고정 탭 — 홈 · 보관함', () => {
  it('집 아이콘은 직접 그린 SVG', () => expect(icons).toMatch(/export const IconHome = \(\) => \(\s*<svg viewBox="0 0 16 16" \{\.\.\.P\}>/));
  it('탭 줄 맨 왼쪽 = 홈(집) 다음 보관함(폴더), 이름은 aria-label·title', () => {
    const i = view.indexOf('className={`lk-tab home ');
    const j = view.indexOf('className={`lk-tab folder ');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(view.slice(i, j)).toMatch(/aria-label=\{tr\('홈', 'Home'\)\}[^>]*><IconHome \/>/);
    expect(view.slice(j, j + 400)).toMatch(/aria-label=\{tr\('보관함', 'Locker'\)\}[^>]*><IconFolder \/>/);
  });
  it('탭 줄은 늘 그린다(연 탭이 없다고 숨기지 않음)', () => expect(view).not.toMatch(/if \(!row \|\| !lkHold\) return null/));
  it('나무 머리엔 두 갈래 켜기·홈 줄이 없다', () => {
    expect(side).not.toMatch(/lk-switch|IconHome|tl-seg/);
    expect(css).not.toMatch(/\.lk-switch/);
  });
});
