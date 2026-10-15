import { describe, expect, it } from 'vitest';
import modeCss from './mode.css?raw';
import mobileCss from '../mobile/mobile.css?raw';

// 10/12 할 일 모드 입력칸 — 브라우저 기본 파란 고리가 칸 테두리와 어긋나 두 겹으로 보였다.
// 모드가 그리는 입력칸·단추는 앱 입력칸처럼 기본 고리를 끄고 테두리 자체를 강조색으로(한 몸)
const rule = (css: string, sel: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').find((r) => r.split('{')[0]!.split(',').map((x) => x.trim()).includes(sel));

describe('모드 입력칸·단추 포커스', () => {
  it('CSS 를 읽었다(빈 글이면 시험이 헛돈다)', () => {
    expect(modeCss.length).toBeGreaterThan(1000);
    expect(mobileCss.length).toBeGreaterThan(1000);
  });
  for (const sel of ['.mdv-field input:focus', '.mdv-field select:focus', '.mdv .btn:focus-visible']) {
    it(`${sel} — 기본 고리 끄고 테두리가 강조색`, () => {
      const r = rule(modeCss, sel) ?? '';
      expect(r).toMatch(/outline:\s*none/);
      expect(r).toMatch(/border-color:\s*var\(--accent\)/);
    });
  }
  it('폰 모드 입력칸도 같은 모양(폰 테두리 규칙이 덮지 않게)', () => {
    const r = rule(mobileCss, '.m-mode-body .mdv-field input:focus') ?? '';
    expect(r).toMatch(/outline:\s*none/);
    expect(r).toMatch(/border-color:\s*var\(--accent\)/);
  });
});
