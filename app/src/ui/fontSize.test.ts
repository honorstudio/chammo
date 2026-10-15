import { describe, expect, it } from 'vitest';

// 2026-10-11 UI 재조사: PC 글자 10~10.5px(배지 숫자·작업 패널 개수·시간·리플레이 눈금)가 너무 작았다 — 읽는 글은 11px 이상.
// 그림 속 장식 글(프사 머리글자·썸네일 미리보기 글·픽셀 사무실)만 예외. 폰(mobile.css)은 폰 세션 몫.
const sheets = import.meta.glob(['/src/ui/**/*.css', '!/src/ui/mobile/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const DECOR = new Set([
  '.cv-avatar', // 프사 머리글자
  '.dc-done .dc-av, .dc-mini .dc-av', // 작은 프사 머리글자
  '.cv-fchip-th .cv-thumb-kind', // 썸네일 확장자 표
  '.cv-grid .cv-thumb-text', // 썸네일 속 글 미리보기
  '.office-title', // 픽셀 사무실 간판
  '.cv-holders i', // 13px 프사 칸 머리글자
]);

const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function small(css: string): { sel: string; px: number }[] {
  const out: { sel: string; px: number }[] = [];
  for (const m of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const f of (m[2] ?? '').matchAll(/(?:^|;)\s*font(?:-size)?:\s*(?:[^;]*?\s)?([\d.]+)px/g)) { // font: 600 10px/1 … 한 줄 표기도
      const px = Number(f[1]);
      if (px < 11) out.push({ sel: (m[1] ?? '').replace(/\s+/g, ' ').trim(), px });
    }
  }
  return out;
}

describe('PC 글자 크기', () => {
  it('CSS 를 읽었다', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(10);
    for (const [p, css] of Object.entries(sheets)) expect(css.length, p).toBeGreaterThan(0);
  });

  it('읽는 글은 11px 이상 — 장식 글만 예외', () => {
    const bad = Object.entries(sheets).flatMap(([p, css]) => small(css).filter((x) => !DECOR.has(x.sel)).map((x) => `${p} ${x.sel} ${x.px}px`));
    expect(bad).toEqual([]);
  });

  it('작업 패널 제목 줄은 좁으면 다음 줄로 감긴다 — "머지 전에 볼 것" 제목이 98px 에 잘리던 것', () => {
    const css = noComments(sheets['/src/ui/styles.css'] ?? '');
    expect(css).toMatch(/\.thead \{[^}]*flex-wrap: wrap/);
    const tline = /\.tline \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(tline).not.toMatch(/white-space: nowrap/);
    expect(tline).toMatch(/-webkit-line-clamp: 2/);
  });
});
