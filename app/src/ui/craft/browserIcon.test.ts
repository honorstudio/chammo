import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import drawer from './CraftDrawer.tsx?raw';
import space from '../space/SpaceView.tsx?raw';
import { BROWSER_ICON, BROWSER_ICON_SMALL } from '../../domain/craftDrawer';

// 10-28 사용자 "참모브라우저 앱아이콘도 정상화" — 서랍에서 혼자 회색 글자칸 + 선 아이콘이라 어색했다. 고른 시안 A(남색 · 창)
describe('참모 브라우저 아이콘', () => {
  it('서랍 칸은 다른 참모 앱처럼 진짜 아이콘 그림(img) — 글자칸·선 아이콘이 아니다', () => {
    const tile = drawer.slice(drawer.indexOf('const browserTile = '), drawer.indexOf('const refreshLabel'));
    expect(tile).toMatch(/<span className="cd-icon"><img src=\{BROWSER_ICON\} alt="" \/>/);
    expect(tile).not.toMatch(/cd-glyph|IconBrowser/);
  });
  it('스페이스 칸 머리 아이콘도 같은 그림(작은 판) — 세션 글자 배지는 그대로', () => {
    const dock = space.slice(space.indexOf('className={`lk-tab bdock'), space.indexOf('lk-bdock-x'));
    expect(dock).toMatch(/<img src=\{BROWSER_ICON_SMALL\} alt="" \/><b className="lk-bdock-letter"/);
    expect(dock).not.toMatch(/IconBrowser/);
  });
  it('그림 파일은 앱 public 에 있고 사본 번들 아이콘(tools/chammo-browser)과 같은 그림', () => {
    const pub = (p: string) => `public${p}`;
    expect(existsSync(pub(BROWSER_ICON))).toBe(true);
    expect(existsSync(pub(BROWSER_ICON_SMALL))).toBe(true);
    expect(readFileSync(pub(BROWSER_ICON), 'utf8')).toBe(readFileSync('../tools/chammo-browser/assets/browser-icon.svg', 'utf8'));
  });
});
