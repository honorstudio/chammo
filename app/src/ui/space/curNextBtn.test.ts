import { describe, expect, it } from 'vitest';
import css from './space.css?raw';
import src from './CurationMode.tsx?raw';

// 2026-10-11 사용자: 시안 검토 머리 '남은 20 · 다음' 이 30px 정사각 닫기 칸 클래스를 같이 써서 '남/은/20' 으로 세로로 눌렸다
describe('시안 검토 머리 — 남은 · 다음 버튼', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('닫기 칸 클래스를 안 빌려 쓰고 글자가 한 줄로 선다', () => {
    expect(src).toMatch(/className="cur-mode-next"/);
    const m = /\.cur-mode-next \{([^}]*)\}/.exec(css);
    expect(m?.[1]).toMatch(/white-space:\s*nowrap/);
    expect(m?.[1]).not.toMatch(/width:\s*30px/);
  });
});
