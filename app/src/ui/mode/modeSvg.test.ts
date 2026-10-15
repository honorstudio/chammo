import { describe, expect, it } from 'vitest';
import view from './ModeSvg.tsx?raw';
import tree from './ModeTree.tsx?raw';

// 정지판으로 바꾸는 때 — 줄이기·끄기(ui/calm), 사람이 안 볼 때(oa-paused 와 같은 판단), 칸이 화면에 안 보일 때
describe('모드 Svg — 움직일 때만 움직이는 그림', () => {
  it('줄이기·끄기·안 볼 때·안 보이는 칸이면 정지판 src', () => {
    expect(view).toMatch(/const moving = !calm && seen && inView;/);
    expect(view).toMatch(/src=\{moving \? src : still\}/);
    expect(view).toMatch(/onCalm\(/);
    expect(view).toMatch(/onAttention\(/);
    expect(view).toMatch(/new IntersectionObserver\(/);
  });
  it('렌더러는 Svg 칸을 ModeSvg 로 — 정지판은 새로 만들지 않고 노드의 still 을 꺼내 쓴다', () => {
    expect(tree).toMatch(/<ModeSvg src=\{n\.src\} still=\{n\.still\} alt=\{n\.alt\} \/>/);
    expect(view).not.toMatch(/svgStillSrc|encodeURIComponent/);
  });
});
