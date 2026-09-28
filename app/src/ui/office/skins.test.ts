import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../domain/gacha';
import { SKIN_NAMES, SKINS } from './skins';

describe('스킨 ↔ 뽑기 풀', () => {
  it('뽑기 풀의 스킨은 전부 색 묶음이 있다 — 뽑았는데 안 바뀌는 일 없게', () => {
    for (const c of CATALOG.filter((x) => x.kind === 'skin')) expect(SKINS[c.id.slice(5)], c.id).toBeDefined();
  });
  it('모든 스킨은 고르는 버튼 이름이 있다', () => {
    expect(SKIN_NAMES.map(([id]) => id).sort()).toEqual(Object.keys(SKINS).sort());
  });
});
