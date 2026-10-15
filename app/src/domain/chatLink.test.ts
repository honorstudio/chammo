import { describe, expect, it } from 'vitest';
import { linkGeom, linkPath } from './chatLink';

// 2026-10-12 사용자(201.png): 고른 프사와 채팅 칸이 구분이 잘 안 된다 → 탭이 내용에 붙은 모양처럼, 맞닿는 변만 열린 참모 색 윤곽선 하나
const card = { x: 100, y: 10, w: 300, h: 500 };

/** 경로를 따라가며 x 위에서 그은 세로 토막([작은 y, 큰 y]) */
function leftSpans(d: string, x: number): [number, number][] {
  const t = d.match(/[MLHVAZ]|-?[\d.]+/g) ?? [];
  let cx = 0; let cy = 0; let i = 0;
  const out: [number, number][] = [];
  const n = () => Number(t[i++]);
  while (i < t.length) {
    const c = t[i++];
    if (c === 'M' || c === 'L') { cx = n(); cy = n(); } else if (c === 'H') cx = n();
    else if (c === 'V') { const y = n(); if (Math.abs(cx - x) < 0.01) out.push([Math.min(cy, y), Math.max(cy, y)]); cy = y; } else if (c === 'A') { i += 5; cx = n(); cy = n(); }
  }
  return out;
}
const tab = { x: 8, y: 200, w: 92, h: 48 };

describe('채팅 이음 윤곽 경로', () => {
  it('탭이 없으면 둥근 카드 하나', () => {
    const d = linkPath(card, null);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/A/g) ?? []).length).toBe(4); // 모서리 넷
  });

  it('탭이 있으면 한 줄로 이어진다 — 카드 모서리 넷 + 맞닿는 곳 오목 둘 + 탭 바깥 모서리 둘', () => {
    const d = linkPath(card, tab);
    expect((d.match(/M/g) ?? []).length).toBe(1); // 끊긴 조각 없이 한 번에
    expect((d.match(/A/g) ?? []).length).toBe(8);
  });

  it('맞닿는 변은 열려 있다 — 카드 왼쪽 변이 탭 높이 구간을 지나지 않는다', () => {
    const g = linkGeom(card, tab);
    expect(g.tab).not.toBeNull();
    // 카드 왼쪽 변(x0)은 탭 위(ty0 - 오목)까지 올라가고, 탭 아래(ty1 + 오목)에서 다시 시작
    const { x0 } = g.card;
    const spans = leftSpans(linkPath(card, tab), x0);
    expect(spans.length).toBe(2); // 탭 위 한 토막 + 탭 아래 한 토막
    expect(spans.some(([a, b]) => b > g.tab!.ty0 && a < g.tab!.ty1)).toBe(false);
    expect(x0).toBe(101); // 선 두께 2 의 가운데 = 안쪽 1px
  });

  it('탭 오목 모서리는 카드 안쪽 면(오목 채움 둘)을 따로 준다', () => {
    const g = linkGeom(card, tab);
    expect(g.fills.length).toBe(2);
    for (const f of g.fills) expect(f).toMatch(/^M[^Z]+A[^Z]+Z$/);
  });

  it('탭이 카드 위쪽 끝에 붙어 있으면 모서리를 줄여 꼬이지 않는다', () => {
    const g = linkGeom(card, { ...tab, y: 14 });
    expect(g.tab!.rTop).toBeLessThanOrEqual((g.tab!.ty0 - g.card.y0) / 2 + 0.001);
    expect(linkPath(card, { ...tab, y: 14 })).not.toMatch(/NaN/);
  });

  it('탭이 카드 위아래 밖이면 탭 없이 카드만', () => {
    expect(linkGeom(card, { ...tab, y: 600 }).tab).toBeNull();
    expect(linkGeom(card, { ...tab, y: -100 }).tab).toBeNull();
  });

  it('숫자는 짧게(소수 한 자리) — 매 프레임 다시 그린다', () => {
    const d = linkPath({ x: 100.333, y: 10.777, w: 300.5, h: 500.25 }, { x: 8.1, y: 200.66, w: 92, h: 48.4 });
    expect(d).not.toMatch(/\d\.\d{2,}/);
  });
});
