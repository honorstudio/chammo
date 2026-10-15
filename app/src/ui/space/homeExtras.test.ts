import { describe, expect, it } from 'vitest';
import home from './HomeView.tsx?raw';
import view from './SpaceView.tsx?raw';
import bar from './ActivityBar.tsx?raw';

// 2026-10-12 패널 하나로 7 — 옛 참모 대시보드(o:)를 지우기 전에 거기만 있던 것을 홈·독으로: 닫히지 않은 일·주인 없는 일(홈 위 알림),
// 참모 할 일·결정(NotePanel)·분신(AgentList)(홈 오른쪽 곁 칸), 참모 자기 브라우저(독 맨 앞 칸)
describe('옛 참모 대시보드의 곁가지 → 홈·독', () => {
  it('홈 = 위 알림 + 모드 + 오른쪽 곁 칸', () => {
    expect(home).toMatch(/\{hint\}/);
    expect(home).toMatch(/className="hm-side"/);
  });
  it('홈에 닫히지 않은 일·주인 없는 일·참모 할 일·분신', () => {
    expect(view).toMatch(/<HomeView key=\{lo\.id\} hint=\{homeHint\(lo\)\} aside=\{homeAside\(lo\)\}/);
    const h = view.slice(view.indexOf('const homeHint = '), view.indexOf('// 가운데 + 아래 세션 독'));
    expect(h).toMatch(/<UnclosedTasks /);
    expect(h).toMatch(/cv-orphans/);
    expect(h).toMatch(/<NotePanel /);
    expect(h).toMatch(/<AgentList /);
  });
  it('참모 자기 브라우저는 독 맨 앞 칸 — 터미널·크게 없음', () => {
    expect(bar).toMatch(/OWN_WEB/);
    expect(bar).toMatch(/own \? undefined : term\(l\.id\)/);
  });
});
