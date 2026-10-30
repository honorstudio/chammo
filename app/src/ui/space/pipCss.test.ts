import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';

// 2026-10-12 사용자(캡처 197.png, 참모-2 전달): 띠 프사 오른쪽 위 상태 점이 캐릭터 얼굴·머리를 너무 가려 '안 귀엽다' —
// 점은 작게(10 → 8), 그림 안쪽이 아니라 프사 칸 바깥 모서리에 걸치게, 둘레 고리는 띠 바탕색 1.5px. 도우미 숫자 배지도 같은 기준
const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.:()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('띠 상태 점 — 얼굴을 덜 가리게', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(100));
  const pip = rule('.lk-pip');
  it('8px, 프사 칸 바깥 모서리(음수 자리)에 걸친다', () => {
    expect(pip).toMatch(/width: 8px; height: 8px;/);
    expect(pip).toMatch(/top: -3px; right: -3px;/);
  });
  // 2026-10-29 사용자: 고른 줄 면(흰 이음 면·펼친 띠 회색 면)을 걷어 고른 줄도 띠 바탕 — 고리는 어디서나 띠 바탕색(railPick.test.ts)
  it('둘레 고리는 띠 바탕색 1.5px — 고른 줄도 면이 없어 같은 색', () => {
    expect(pip).toMatch(/box-shadow: 0 0 0 1\.5px var\(--pip-ring\)/);
    expect(rule('.lk-strip')).toMatch(/--pip-ring: var\(--panel\)/);
    expect(css).not.toMatch(/\.lk-av\.on \{[^}]*--pip-ring/);
  });
  it('쉼은 빈 고리 그대로(바탕색 속 + 안쪽 고리)', () => {
    expect(rule('.lk-pip.p-rest')).toMatch(/background: var\(--pip-ring\); box-shadow: 0 0 0 1\.5px var\(--pip-ring\), inset 0 0 0 1\.6px var\(--text-3\)/);
  });
});

describe('도우미 숫자 배지 — 같은 기준', () => {
  const n = rule('.lk-grp-n');
  it('작게(14px — 숫자는 읽는 글이라 11px 그대로), 둘레는 띠 바탕색 1.5px', () => {
    expect(n).toMatch(/min-width: 14px; height: 14px;/);
    expect(n).toMatch(/font-size: 11px/);
    expect(n).toMatch(/box-shadow: 0 0 0 1\.5px var\(--pip-ring\)/);
  });
  it('접힌 띠에선 아이콘이 아니라 묶음 칸(44) 바깥 모서리에', () => {
    expect(css).toMatch(/\.lk-strip:not\(\.wide\) \.lk-av\.grp \.lk-av-pic \{ position: static; \}/);
    expect(n).toMatch(/right: -4px; bottom: -4px;/);
  });
});
