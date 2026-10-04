// 대시보드 접는 칸(시킨 일·할 일) — 펼친 목록은 그 자리에서 늘어나 아래 칸을 밀어야 한다.
// 떠 있는 판(absolute)이면 아래 할 일 칸·파일 카드를 덮었다(2026-10-04 사용자 실기기 캡처)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)\\${sel}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1];
};

describe('대시보드 접는 칸', () => {
  it('펼친 판이 흐름 안에 있다 — 떠서 아래를 덮지 않는다', () => {
    expect(rule('.m-fold-panel')).not.toMatch(/position\s*:\s*(absolute|fixed)/);
  });
  it('펼친 판 안에서 잘리지 않는다 — 높이 상한·안쪽 스크롤 없음(긴 목록은 화면이 스크롤)', () => {
    expect(rule('.m-fold-panel')).not.toMatch(/max-height|overflow-y\s*:\s*auto/);
  });
  it('칸끼리 층을 쌓지 않는다 — 뒤 칸 머리줄이 앞 칸 목록 위로 그려졌다', () => {
    expect(rule('.m-fold-wrap')).not.toMatch(/z-index/);
  });
});
