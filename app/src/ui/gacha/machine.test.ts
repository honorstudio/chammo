import { describe, expect, it } from 'vitest';
import type { Brush } from '../office/draw';
import { drawMachine, drawTen, newShow, skipShow } from './machine';

const noop = new Proxy({}, { get: () => () => {} }) as Brush;

describe('뽑기 연출 건너뛰기 — 누르면 바로 결과', () => {
  it('한 번 뽑기: 건너뛰면 다음 프레임에 결과 카드', () => {
    let card = 0;
    const s = newShow('one', [{ id: 'skin.mint', rarity: '희귀' }], () => { card++; });
    const now = s.t0 + 100;
    drawMachine(noop, 220, 184, s, now);
    expect(card).toBe(0);
    skipShow(s, now);
    drawMachine(noop, 220, 184, s, now + 16);
    expect(card).toBe(1);
    drawMachine(noop, 220, 184, s, now + 32);
    expect(card).toBe(1); // 카드는 한 번만
  });

  it('10번 뽑기: 건너뛰면 다음 프레임에 결과, 선반의 10개도 다 열린 채', () => {
    let card = 0, rects = 0;
    const items = Array.from({ length: 10 }, (_, i) => ({ id: 'skin.mint', rarity: i === 9 ? '전설' as const : '흔함' as const }));
    const s = newShow('ten', items, () => { card++; });
    const t0 = s.t0;
    skipShow(s, t0 + 50);
    drawTen({ ...noop, rect: () => { rects++; } } as Brush, 300, 120, s, t0 + 66);
    expect(card).toBe(1);
    expect([...s.flags].filter((f) => /^p\d$/.test(f))).toHaveLength(10);
    expect(rects).toBeGreaterThan(0);
  });
});
