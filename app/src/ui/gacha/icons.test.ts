import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../domain/gacha';
import { drawItem, windowScene } from './icons';

describe('뽑기 아이템 아이콘', () => {
  it('풀의 29종 모두 무언가를 그린다 — 뽑았는데 빈 칸이 뜨는 일 없게', () => {
    for (const c of CATALOG) {
      let n = 0;
      drawItem({ rect: () => { n++; } }, c.id);
      expect(n, c.id).toBeGreaterThanOrEqual(4);
    }
  });
  it('창밖 풍경은 사무실 창문에도 전부 그려진다', () => {
    for (const c of CATALOG.filter((x) => x.kind === 'window')) {
      let n = 0;
      for (let t = 0; t < 40; t++) windowScene(c.id, t, () => { n++; });
      expect(n, c.id).toBeGreaterThan(0);
    }
  });
});
