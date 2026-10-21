import { describe, expect, it } from 'vitest';
import { CATALOG, EVENTS } from '../../../domain/gacha';
import { PACK, PACKS } from '.';

// 옛 그림(icons.ts·draw.ts 안)에 있는 이름 — 이것 말고는 전부 팩에 그리는 법이 있어야 한다
const OLD: Record<string, string[]> = {
  furn: ['sofa', 'board', 'lamp', 'vending', 'tank', 'cattower', 'arcade', 'trophy'], hat: ['crown', 'headset', 'beanie', 'straw'],
  window: ['rain', 'night', 'snow', 'blossom', 'sunset', 'aurora', 'city', 'rainbow', 'fireworks', 'meteor'], fx: ['heart', 'petal', 'firework'],
  action: ['coffee', 'dance'], friend: ['cat'], desk: ['duck', 'cactus', 'ramen', 'keeb', 'lava'], title: ['commit', 'night', 'bug', 'review', 'merge', 'ten'],
  light: ['fairy', 'warm', 'neon', 'spot', 'disco'],
};

describe('그림 팩', () => {
  it('뽑기 풀의 아이템은 전부 사무실에 그리는 법이 있다 — 뽑았는데 끼워도 안 보이는 일 없게', () => {
    for (const c of CATALOG.filter((x) => x.kind !== 'skin')) {
      const name = c.id.slice(c.id.indexOf('.') + 1);
      if (OLD[c.kind]?.includes(name)) continue;
      expect((PACK as Record<string, Record<string, unknown>>)[c.kind]?.[name], c.id).toBeDefined();
    }
  });
  it('팩끼리 이름이 겹치지 않는다(뒤 팩이 앞 팩을 조용히 덮지 않게)', () => {
    for (const k of ['furn', 'hat', 'window', 'desk', 'light', 'fx', 'title', 'friend', 'action', 'skin', 'scene'] as const) {
      const names = PACKS.flatMap((p) => Object.keys(p[k] ?? {}));
      expect(new Set(names).size, k).toBe(names.length);
      for (const n of names) expect(OLD[k]?.includes(n) ?? false, `${k}.${n}`).toBe(false);
    }
  });
  it('스킨 장식은 팩에 있는 이름만 쓴다', () => {
    for (const [k, v] of Object.entries(PACK.skin)) for (const n of v.skin.scene ?? []) expect(PACK.scene[n], `${k} → ${n}`).toBeDefined();
  });
  it('한정 아이템은 있는 이벤트 키를 쓰고, 이벤트마다 네 등급이 다 있다(기간 중 어느 등급을 굴려도 한정이 나올 수 있게)', () => {
    const lim = CATALOG.filter((c) => c.limited);
    for (const c of lim) expect(EVENTS[c.limited!], c.id).toBeDefined();
    for (const k of new Set(lim.map((c) => c.limited!))) for (const r of ['흔함', '보통', '희귀', '전설'] as const) expect(lim.some((c) => c.limited === k && c.rarity === r), `${k} ${r}`).toBe(true);
  });
});
