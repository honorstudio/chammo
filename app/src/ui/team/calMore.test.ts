// 달력 +N개 — 칸이 넓은데 3개에서 잘리고, 누르면 달 전체 목록으로 가서 그날 것을 찾기 어려웠다(11-05 사용자 캡처)
import { describe, expect, it } from 'vitest';
import src from './TeamCal.tsx?raw';

describe('달력 더보기', () => {
  it('누르면 그날 일정 창이 뜬다 — 목록 보기로 안 넘어간다', () => {
    expect(src).toContain('setDayOpen(day)');
    expect(src).not.toMatch(/tcal-more"[^>]*setView\('list'\)/);
  });
  it('칸 높이를 재서 들어가는 만큼 보여 준다', () => {
    expect(src).toContain('monthFit(cellH, list.length)');
    expect(src).toContain('ResizeObserver');
  });
});
