import { describe, expect, it } from 'vitest';
import { contrastFor } from './termTheme';

describe('contrastFor — 라이트 모드에서 흐린 글자 자동 진하게', () => {
  it('라이트는 4.5:1(웹 접근성 기준) — Claude Code 가 dark 테마용 트루컬러(흰·연회색)를 보내도 보이게', () => {
    expect(contrastFor(false)).toBe(4.5);
  });
  it('다크는 원래 색 그대로(1)', () => {
    expect(contrastFor(true)).toBe(1);
  });
});
