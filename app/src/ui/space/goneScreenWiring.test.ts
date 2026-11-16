import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';

// 2026-11-16 사용자 after-blank.png — 브라우저 칸에서 도구를 열고 그사이 브라우저가 꺼진 뒤 닫으면 탭 줄만 남은 빈 칸.
// 돌아갈 자리를 고르는 길(기능 닫기·탭 바꾸기·⌘`·홈 대시보드·⌘[ ⌘])이 다 같은 '사라진 화면' 판정을 지나야 한다
describe('사라진 화면(꺼진 브라우저·Craft 칸)으로 돌아가지 않는다', () => {
  it('판정은 지금 브라우저 목록·Craft 독을 본다 — 첫 그리기에 붙은 듣기도 최신을 보게 ref 로', () => {
    expect(view).toMatch(/const goneScreen = \(p: string\) => \{\n\s+const b = browserOfPick\(p\);\n\s+if \(b !== null\) return !liveB\(b\);\n\s+return p\.startsWith\('k:'\) && p !== APPS_KEY && !dock\.some\(\(d\) => craftKey\(d\.app\) === p\);/);
    expect(view).toMatch(/goneRef\.current = goneScreen;/);
    expect(view).toMatch(/const gone = \(p: string\) => goneRef\.current\(p\);/);
  });
  it('기능 화면 닫기(다섯 화면 같은 길)·뒤로·앞으로가 판정을 넘긴다', () => {
    expect(view).toMatch(/featurePick\(key, pick, req, beforeF\.current\.get\(k\) \?\? '', fnHome, gone\)/);
    expect(view).toMatch(/goBack\(n, cur, gone\) : goForward\(n, cur, gone\)/);
  });
  it('기억한 화면 되살리기(ownPick)는 다 판정을 넘긴다', () => {
    const lines = view.split('\n').filter((l) => l.includes('ownPick(') && !l.startsWith('import'));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const l of lines) expect(l).toMatch(/ownPick\([^\n]*, gone\)/);
  });
});
