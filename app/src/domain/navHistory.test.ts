import { describe, expect, it } from 'vitest';
import { EMPTY_NAV, goBack, goForward, visit, keyFallback } from './navHistory';

describe('navHistory — 뒤로 = 왔던 곳(브라우저처럼), 2026-10-04 QA D2', () => {
  it('재현: 문서 → 링크로 다른 문서 → 뒤로 = 처음 문서(위 칸·오케스트레이터 홈이 아니라)', () => {
    let n = visit(EMPTY_NAV, 'o:참모', 'd:/p/장보기.md');
    n = visit(n, 'd:/p/장보기.md', 'd:/notes/다른 문서.md');
    const b = goBack(n, 'd:/notes/다른 문서.md')!;
    expect(b.to).toBe('d:/p/장보기.md');
    expect(goBack(b.nav, b.to)!.to).toBe('o:참모');
  });
  it('뒤로 갔다 앞으로 — 갔던 곳으로 다시', () => {
    let n = visit(EMPTY_NAV, 'a', 'b');
    n = visit(n, 'b', 'c');
    const b = goBack(n, 'c')!;
    const f = goForward(b.nav, b.to)!;
    expect(f.to).toBe('c');
    expect(goForward(f.nav, f.to)).toBeNull();
  });
  it('뒤로 간 뒤 새 곳으로 가면 앞으로 기록은 버린다', () => {
    let n = visit(EMPTY_NAV, 'a', 'b');
    const b = goBack(n, 'b')!;
    n = visit(b.nav, b.to, 'x');
    expect(goForward(n, 'x')).toBeNull();
    expect(goBack(n, 'x')!.to).toBe('a');
  });
  it('같은 곳·빈 곳은 안 쌓는다, 처음이면 뒤로 없음(부르는 쪽이 위 칸으로)', () => {
    expect(visit(EMPTY_NAV, 'a', 'a')).toBe(EMPTY_NAV);
    expect(visit(EMPTY_NAV, '', 'a')).toBe(EMPTY_NAV);
    expect(goBack(EMPTY_NAV, 'a')).toBeNull();
  });
  it('기록은 최근 50개까지', () => {
    let n = EMPTY_NAV;
    for (let i = 0; i < 80; i++) n = visit(n, `p${i}`, `p${i + 1}`);
    expect(n.back.length).toBe(50);
    expect(n.back[0]).toBe('p30');
  });
  it('되돌아가는 곳이 지금과 같으면 건너뛴다(다른 길로 같은 곳에 와 있을 때)', () => {
    let n = visit(EMPTY_NAV, 'a', 'b');
    n = visit(n, 'b', 'a'); // back = [a, b]
    expect(goBack(n, 'b')!.to).toBe('a');
  });
});

describe('keyFallback — ⌘[·마우스 뒤로가 기록이 없을 때(roadmap 문서 ⑥)', () => {
  it('가운데가 문서면 문서 뒤로 버튼과 같은 위 칸 — 예전엔 아무 일도 없었다', () => {
    expect(keyFallback(-1, 'd:/a/b.md', 'd:/a.md')).toBe('d:/a.md');
  });
  it('문서가 아니거나 앞으로·위 칸 모름이면 없음', () => {
    expect(keyFallback(-1, 'o:x', 'd:/a.md')).toBeUndefined();
    expect(keyFallback(1, 'd:/a/b.md', 'd:/a.md')).toBeUndefined();
    expect(keyFallback(-1, 'd:/a/b.md', '')).toBeUndefined();
  });
});
