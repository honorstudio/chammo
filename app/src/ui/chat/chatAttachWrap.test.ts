import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 붙인 파일 칩이 많으면 입력칸 위 칸을 뚫고 나가던 것(2026-10-26) — 줄을 바꿔 쌓고 칸 폭 안에 머문다
describe('chat-attach', () => {
  const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf8');
  const rule = css.match(/\.chat-attach \{[^}]*\}/)?.[0] ?? '';
  it('줄을 바꾸고 줄어들 수 있다', () => {
    expect(rule).toContain('flex-wrap: wrap');
    expect(rule).toContain('min-width: 0');
    expect(rule).not.toContain('flex: 0 0 auto');
  });
});

// 2026-11-05 사용자 캡처: 썸네일 크기가 그림마다 달랐고(높이만 고정), 넓은 그림은 잘리고, 좁은 그림은 이름표(#img3)가 칸 밖으로 나가 '#i' 만 보였다
describe('chat-att 썸네일', () => {
  const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf8');
  const img = css.match(/\.chat-attach img \{[^}]*\}/)?.[0] ?? '';
  const em = css.match(/\.chat-att em \{[^}]*\}/)?.[0] ?? '';
  it('모든 썸네일이 같은 칸 크기, 그림은 안 자르고 칸 안에 다 보인다', () => {
    expect(img).toMatch(/\bwidth: \d+px/);
    expect(img).toMatch(/\bheight: \d+px/);
    expect(img).toContain('object-fit: contain');
    expect(img).not.toContain('max-width');
  });
  it('이름표는 썸네일 칸을 넘지 않는다', () => {
    expect(em).toContain('max-width: calc(100% - 6px)');
    expect(em).toContain('overflow: hidden');
  });
});
