import { describe, expect, it } from 'vitest';
import view from './ModeSvg.tsx?raw';
import tree from './ModeTree.tsx?raw';
import card from './ModeCardArt.tsx?raw';
import scheme from '../scheme.ts?raw';

// 정지판으로 바꾸는 때 — 줄이기·끄기(ui/calm), 사람이 안 볼 때(oa-paused 와 같은 판단), 칸이 화면에 안 보일 때
describe('모드 Svg — 움직일 때만 움직이는 그림', () => {
  it('줄이기·끄기·안 볼 때·안 보이는 칸이면 정지판 src', () => {
    expect(view).toMatch(/const moving = !calm && seen && inView;/);
    expect(view).toMatch(/onCalm\(/);
    expect(view).toMatch(/onAttention\(/);
    expect(view).toMatch(/new IntersectionObserver\(/);
  });
  it('렌더러는 Svg 칸을 ModeSvg 로 — 주소는 그림·테마·움직임이 바뀔 때만 다시 만든다', () => {
    expect(tree).toMatch(/<ModeSvg svg=\{n\.svg\} alt=\{n\.alt\} \/>/);
    expect(view).toMatch(/useMemo\(\(\) => \(moving \? svgSrc : svgStillSrc\)\(svg, scheme\), \[svg, scheme, moving\]\)/);
    expect(view).toMatch(/src=\{src \?\? ''\}/);
    expect(view).not.toMatch(/encodeURIComponent/);
  });
  // 2026-10-16 폰 다크: <img> 안 SVG 는 앱 테마를 못 본다 — 지금 테마(데스크톱 테마 메뉴가 바꾸는 창 모양·폰 화면)를 넘기고, 바뀌면 다시 그린다
  it('앱 테마를 넘긴다 — 테마가 바뀌면 다시 그림', () => {
    expect(view).toMatch(/const scheme = useScheme\(\);/);
    expect(scheme).toMatch(/addEventListener\('change', on\)/);
    expect(scheme).toMatch(/removeEventListener\('change', on\)/);
    expect(card).toMatch(/useScheme\(\)/);
    expect(card).toMatch(/svgSrc\(art\.svg, scheme\)|svgSrc\(svg, scheme\)/);
  });
});
