import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';

// 2026-10-12 사용자(참모-2 전달): 보관함에서 파일을 탭으로 열어 보다 보관함 탭으로 돌아오면 맨 위 — 참모 + 폴더마다 자리 기억,
// 탭을 바꿨다 오면 되살리고, 폴더를 새로 들어갈 땐 맨 위(하네스 lkscroll.cjs 로 재현: 600 → 0, 새 폴더에 앞 폴더 600 이 남음)
describe('보관함 스크롤 자리', () => {
  it('떠날 때 재는 칸 = SCROLL_PANES(문서만이 아니라)', () => {
    expect(view).toMatch(/const scrollEl = \(\) => document\.querySelector<HTMLElement>\(SCROLL_PANES\.map/);
  });
  it('폴더를 새로 들어가면(경로 줄·폴더 카드·프로젝트 칩) 그 자리 기억을 지워 맨 위', () => {
    expect(view).toMatch(/onPlace=\{\(p\) => \{ const k = lkPick\(lo\.id, p\); docScroll\.current\.delete\(scrollKey\(now\.current\.view, k\)\); setPick\(k\); \}\}/);
  });
  it('되살리기는 restoreTop — 보관함 칸은 기억이 없으면 0 으로', () => {
    expect(view).toMatch(/restoreTop\(docScroll\.current\.get\(scrollKey\(nav\.view, pick\)\), /);
  });
  it('홈 탭으로 갈 때도 보관함 탭이 돌아올 폴더를 적는다', () => {
    // 단추와 ⌘⇧H 가 같은 goHome 을 지난다(2026-10-12)
    expect(view).toMatch(/className=\{`lk-tab home[^>]*onClick=\{\(\) => goHome\(lo\)\}/);
    expect(view).toMatch(/const goHome = \(lo: Session\) => \{ if \(tabRow\(lkHold, lo\.id, pick\)\.homeOn\) return; setLkHold\(\(x\) => leaveFolder\(x, lo\.id, pick\)\);/);
  });
});
