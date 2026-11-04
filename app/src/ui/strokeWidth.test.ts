import { describe, expect, it } from 'vitest';
import layers from './layers.css?raw';

// 2026-11-01 사용자 제보: '모든 프로젝트' 칩 테두리가 위·왼쪽은 두껍고 아래·오른쪽은 얇다.
// 원인 — box-shadow 퍼짐(spread)을 1.5px 처럼 소수점으로 주면 웹킷(맥 앱 창)이 안쪽 가장자리를 픽셀에 반올림해
// 1배 화면에선 칸이 놓인 소수점 자리에 따라 한쪽 2px·반대쪽 1px 가 된다(3배 폰은 5·4). 1px·2px 같은 정수는 늘 같다.
// 그래서 획처럼 쓰는 그림자 퍼짐은 정수 px 이거나 layers.css 의 --ring-w(배율마다 장치 픽셀 정수)만 쓴다.
const sheets = import.meta.glob('/src/ui/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** box-shadow 값마다 퍼짐(네 번째 길이)이 소수점 px 인 그림자 */
function fractionalSpreads(css: string): string[] {
  const bad: string[] = [];
  for (const m of noComments(css).matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    for (const part of m[1]!.split(/,(?![^(]*\))/)) {
      const lens = part.replace(/\binset\b/, '').trim().match(/-?(?:\d*\.)?\d+px|\b0\b/g) ?? [];
      if (lens.length >= 4 && /\.\d/.test(lens[3]!)) bad.push(part.trim());
    }
  }
  return bad;
}

describe('획 두께 — 소수점 그림자 퍼짐 금지', () => {
  it('앱 CSS 어디에도 퍼짐이 소수점 px 인 box-shadow 가 없다', () => {
    const found = Object.entries(sheets).flatMap(([f, css]) => fractionalSpreads(css).map((s) => `${f}: ${s}`));
    expect(found).toEqual([]);
  });

  it('잡는 모양을 안다 — inset·바깥·여러 겹', () => {
    expect(fractionalSpreads('.a { box-shadow: inset 0 0 0 1.5px var(--x); }')).toHaveLength(1);
    expect(fractionalSpreads('.a { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px red; }')).toHaveLength(1);
    expect(fractionalSpreads('.a { box-shadow: 0 2px 12px rgba(0, 0, 0, .08), 0 0 0 var(--ring-w) red; }')).toEqual([]);
    expect(fractionalSpreads('.a { box-shadow: 0 0 0 1px color-mix(in srgb, red 35%, transparent); }')).toEqual([]);
  });

  it('--ring-w 는 배율마다 장치 픽셀 정수다(2배만 1.5px, 1배·3배는 2px)', () => {
    const css = noComments(layers);
    expect(css).toMatch(/:root\s*\{[^}]*--ring-w:\s*2px/);
    // 1.5px 는 2배(3 장치 픽셀)에서만 — 3배면 4.5 라 다시 짝짝이가 된다
    expect(css).toMatch(/@media \(min-resolution: 2dppx\) and \(max-resolution: 2\.99dppx\)\s*\{\s*:root\s*\{\s*--ring-w:\s*1\.5px/);
    expect(css.match(/--ring-w:/g)).toHaveLength(2);
  });
});
