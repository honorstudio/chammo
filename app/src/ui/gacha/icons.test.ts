import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../domain/gacha';
import { deskProp, drawItem, lightScene, titleText, windowScene } from './icons';

describe('뽑기 아이템 아이콘', () => {
  it('풀의 모든 아이템이 무언가를 그린다 — 뽑았는데 빈 칸이 뜨는 일 없게', () => {
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
  it('책상 소품·조명은 사무실에도 그려지고, 칭호는 이름표 글자가 있다', () => {
    for (const c of CATALOG.filter((x) => x.kind === 'desk')) {
      let n = 0;
      for (let t = 0; t < 8; t++) deskProp({ rect: () => { n++; } }, c.id, 0, 0, t, true);
      expect(n, c.id).toBeGreaterThan(8);
    }
    for (const c of CATALOG.filter((x) => x.kind === 'light')) {
      let n = 0;
      for (let t = 0; t < 8; t++) lightScene({ rect: () => { n++; } }, c.id, 300, 200, t, (gx, gy) => [gx * 10, gy * 5]);
      expect(n, c.id).toBeGreaterThan(0);
    }
    for (const c of CATALOG.filter((x) => x.kind === 'title')) expect(titleText(c.id).length, c.id).toBeGreaterThan(1);
  });
});
