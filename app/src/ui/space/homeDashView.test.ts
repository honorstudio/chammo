import { describe, expect, it } from 'vitest';
import dash from './HomeDash.tsx?raw';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import css from './homeDash.css?raw';

// 2026-10-24 사용자 시안 home-dash v1 HA — 띠 맨 위 홈 = 참모 채팅 없는 전체 한눈에(타일 격자)
describe('홈 대시보드 HA', () => {
  it('홈(oh:)에 참모가 있으면 홈 대시보드, 없으면 지금 오케스트레이터 홈(참모 고르기)', () => {
    const at = view.indexOf('} else if (atHome && homeDash && orchs.length > 0) {');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(view.indexOf('} else if (atHome && orchHome) {'));
  });
  it('누르면 그 참모(채팅 탭까지)·그 세션·그 기능·사무실', () => {
    const b = view.slice(view.indexOf('main = homeDash({'), view.indexOf('} else if (atHome && orchHome) {'));
    expect(b).toMatch(/orch: goOrch/);
    expect(view).toMatch(/const goOrch = \(id: string\) => \{[^\n]*setPick\(homeOf\(o\)\); setNav\(\{ view: id, chat: id \}\); onChatTab\?\.\(id\);/);
    expect(b).toMatch(/session: \(t\) => \{ const s = findTarget\(sessions, t\)/);
    expect(b).toMatch(/feature: \(k\) => featureTo\(k, 'open'\)/);
  });
  it('앱이 홈에 데이터를 넘긴다 — 결정 대기 = 위 종과 같은 물음·직접 카드, 누르면 결정 대기함', () => {
    expect(app).toMatch(/homeDash=\{homeDashNode\}/);
    expect(app).toMatch(/\.\.\.direct\.inboxCards\.map\(/);
    expect(app).toMatch(/\.\.\.inbox\.map\(/);
    expect(app).toMatch(/onAsks=\{\(\) => setInboxOpen\(true\)\}/);
  });
  it('홈 칸 — 숫자 넷·참모 타일·쉬는 참모·결정 대기·오래 조용·참모별 진행 칸·기기·도구·오늘 끝남·사무실', () => {
    for (const k of ['hd-stats', 'hd-otiles', 'hd-shelf', 'hd-a-ask', 'hd-quiet', 'hd-a-gp', 'hd-a-dev', 'hd-tools', 'hd-a-done', 'hd-a-office']) expect(dash).toContain(k);
    expect(dash).toMatch(/<HomeProgress orch=/); // 진행 칸은 참모 홈과 같은 컴포넌트
  });
  it('도구는 아이콘만 — 이름은 aria-label·title(아이콘+글자 줄줄이 금지)', () => {
    const t = dash.slice(dash.indexOf('<div className="hd-tools"'), dash.indexOf('</section>', dash.indexOf('<div className="hd-tools"')));
    expect(t).toMatch(/aria-label=\{t\.n \?/);
    expect(t).toMatch(/title=\{t\.name\}/);
    expect(t).not.toMatch(/<span>\{t\.name\}<\/span>/);
  });
  it('사무실 미리보기는 못 누르게(inert) 깔고 위를 덮는 단추 하나', () => {
    expect(dash).toMatch(/<div className="hd-office-in" inert aria-hidden="true">\{office\}<\/div>/);
    expect(dash).toMatch(/className="hd-office-go" onClick=\{go\.office\}/);
  });
  it('왼쪽 색 띠·이모지 없음, 누름 칸 44px', () => {
    expect(css).not.toMatch(/border-left:\s*\d/);
    expect(css).toMatch(/\.hd-tool \{[^}]*width: 44px; height: 44px/);
    expect(css).toMatch(/\.hd-ask \{[^}]*min-height: 44px/);
  });
});
