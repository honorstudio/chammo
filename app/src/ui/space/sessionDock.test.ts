import { describe, expect, it } from 'vitest';
import bar from './ActivityBar.tsx?raw';
import home from './HomeView.tsx?raw';
import view from './SpaceView.tsx?raw';
import dash from './DashboardView.tsx?raw';
import css from './locker.css?raw';

// 2026-10-12 사용자 "잡고 있는 세션이 일하는 걸 홈이든 보관함이든 그 참모 안이면 어디서나" — 패널 하나로 S1·S2·S3·S5
describe('세션 독 — 어디서나 같은 자리', () => {
  it('홈에서도 독이 있다(세션 줄 대신) — lockerFrame 의 독을 끄지 않는다', () => {
    expect(view).not.toMatch(/\), false\) : lo && ls && place\.kind !== 'home'/);
  });
  it('보관함 밖 화면(세션·기능)도 그 참모 독으로 감싼다', () => expect(view).toMatch(/main = lockerFrame\(dockOrch, main\)/));
  it('홈은 모드만 — 세션 접힌 줄·할 일·결정 줄이 없다', () => {
    expect(home).not.toMatch(/hm-ses|hm-row|onOpenSession/);
  });
  it('펼침 높이는 위 손잡이로 끌어 — 앱 전체 한 값(dockHeight)', () => {
    expect(bar).toMatch(/className="lk-act-grip"/);
    expect(bar).toMatch(/onPointerDown=/);
    expect(bar).toMatch(/dockHeight\(/);
    expect(bar).toMatch(/localStorage\.setItem\(H_KEY/);
  });
  it('칸 최소 300 가로 한 줄, 넘치면 민다', () => expect(css).toMatch(/\.lk-act-panes \{[^}]*grid-auto-columns: minmax\(300px, 1fr\)[^}]*overflow-x: auto/));
  it('칸 머리 크게 = 가운데 세션 탭(아이콘, 이름은 aria-label)', () => {
    expect(dash).toMatch(/onBig && \(\s*<button className="cv-pane-tog" onClick=\{onBig\}[^>]*aria-label=\{tr\('크게', 'Open large'\)\}><IconMaximize \/>/);
    expect(bar).toMatch(/onBig=\{own \? undefined : \(\) => onOpenSession\(l\.id\)\}/);
  });
  it('칸 안에서 바로 터미널(직접 칠 수 있다)', () => expect(bar).toMatch(/term=\{own \? undefined : term\(l\.id\)\}/));
});
