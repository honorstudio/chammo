import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';
import view from './SpaceView.tsx?raw';
import strip from './TabStrip.tsx?raw';

// 2026-10-22 사용자: 스페이스 탭이 넘치면 ① 스크롤 막대(맥 '항상 보기'·마우스 연결 = 17px)가 38px 탭 줄을 먹어 탭이 위로 밀려 잘리고
// ② 홈·보관함·앱 고정 탭이 같이 스크롤돼 밀려났다. 고정 탭은 늘 왼쪽, 나머지만 막대 없는 칸에서 스크롤(휠·트랙패드, 넘친 끝 흐림)
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

describe('탭 줄 — 고정 탭 + 스크롤 칸', () => {
  it('CSS 를 읽었다(빈 글이면 vite test.css.include 밖)', () => {
    expect(css.length).toBeGreaterThan(1000);
  });
  it('탭 줄 자체는 스크롤하지 않는다 — 고정 탭이 같이 밀리지 않게', () => {
    expect(rule('.lk-tabs')).not.toMatch(/overflow-x:\s*auto/);
    expect(rule('.lk-tabs')).toMatch(/overflow:\s*hidden/);
  });
  it('스크롤 칸은 막대를 숨겨 줄 높이를 안 먹는다(WebKit·표준 둘 다)', () => {
    const r = rule('.lk-tabs-scroll');
    expect(r).toMatch(/overflow-x:\s*auto/);
    expect(r).toMatch(/overflow-y:\s*hidden/);
    expect(r).toMatch(/scrollbar-width:\s*none/);
    expect(r).toMatch(/min-width:\s*0/);
    expect(css).toMatch(/\.lk-tabs-scroll::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
  it('넘친 끝은 흐리게(mask) — 왼쪽 색 띠 같은 테두리는 안 쓴다', () => {
    expect(css).toMatch(/\.lk-tabs-scroll\.fade-l[^{]*\{[^}]*mask-image/);
    expect(css).toMatch(/\.lk-tabs-scroll\.fade-r[^{]*\{[^}]*mask-image/);
    expect(rule('.lk-tabs-scroll')).not.toMatch(/border-left/);
  });
  it('홈·보관함·앱은 스크롤 칸 밖(앞), 독·파일 탭은 안', () => {
    const nav = view.slice(view.indexOf('<nav className="lk-tabs"'), view.indexOf('</nav>', view.indexOf('<nav className="lk-tabs"')));
    const s = nav.indexOf('<TabStrip');
    expect(s).toBeGreaterThan(0);
    for (const fixed of ["lk-tab home", "aria-label={tr('보관함', 'Locker')}", "aria-label={tr('Craft 앱', 'Craft apps')}"]) expect(nav.indexOf(fixed)).toBeLessThan(s);
    expect(nav.indexOf('myDock(lo.id)')).toBeGreaterThan(s);
    expect(nav.indexOf('row.tabs.map')).toBeGreaterThan(s);
  });
  it('스크롤 칸 — 세로 휠은 막지 않는 듣기(passive false)로 가로, 고른 탭은 보이게', () => {
    expect(strip).toMatch(/addEventListener\('wheel'[^)]*passive:\s*false/);
    expect(strip).toMatch(/wheelToX/);
    expect(strip).toMatch(/keepInView/);
    expect(strip).toMatch(/tabFade/);
  });
});
