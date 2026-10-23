import { describe, expect, it } from 'vitest';
import css from './goalProgress.css?raw';
import space from './space/SpaceView.tsx?raw';
import home from './space/HomeView.tsx?raw';
import dash from './mobile/OrchDash.tsx?raw';
import comp from './GoalProgress.tsx?raw';

// 사용자 10-23: 진행 막대는 홈 진행 칸에만(데스크톱 스페이스 홈 + 폰 홈), 사라질 땐 반짝 → 접힘, 동작 줄이기면 페이드만
describe('진행 칸 — 홈에만, 사라짐 효과', () => {
  it('데스크톱 홈 맨 위와 폰 홈 맨 위에 같은 진행 칸', () => {
    expect(space).toMatch(/progress=\{<HomeProgress orch=\{lo\} events=\{events\} sessions=\{sessions\} readFill=\{sessionFill\} \/>\}/);
    expect(home).toMatch(/<div className="hm">\s*\{progress\}/);
    expect(dash).toMatch(/<div className="m-top">\s*<HomeProgress orch=\{orch\} events=\{events\} sessions=\{sessions\} \/>/);
  });
  it('끝난 줄은 반짝인 뒤 접히고, 기타의 끝난 칸은 폭이 줄어 옆 칸이 당겨진다', () => {
    expect(css).toMatch(/\.gp-leave \{[^}]*animation: gp-fold/);
    expect(css).toMatch(/\.gp-leave \.gp-c \{ animation: gp-flash/);
    expect(css).toMatch(/\.gp-cleave \{ animation: gp-flash[^;]*gp-shrink/);
  });
  it('동작 줄이기면 페이드만 — 끝 사건 이름도 받는다', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.gp-leave \{ animation: gp-fade/);
    expect(reduced).toMatch(/\.gp-cleave \{ animation: gp-cfade/);
    expect(comp).toMatch(/'gp-fold' \|\| e\.animationName === 'gp-fade'/);
    expect(comp).toMatch(/'gp-shrink' \|\| e\.animationName === 'gp-cfade'/);
  });
  it('왼쪽 색 띠 없음', () => {
    expect(css).not.toMatch(/border-left\s*:/);
  });
});
