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
