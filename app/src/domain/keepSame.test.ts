import { describe, expect, it } from 'vitest';
import { keepSame } from './keepSame';

describe('keepSame — 같은 내용이면 옛 참조 그대로(다시 안 그리게)', () => {
  it('내용이 같으면 옛 값을 돌려준다 — 키 순서는 안 본다', () => {
    const old = { a: 1, b: [{ x: 1 }, { y: 2 }], c: { d: 'e' } };
    expect(keepSame(old, { c: { d: 'e' }, b: [{ x: 1 }, { y: 2 }], a: 1 })).toBe(old);
  });
  it('하나라도 다르면 새 값 — 키가 늘거나 줄어도', () => {
    const old: Record<string, number> = { a: 1, b: 2 };
    expect(keepSame(old, { a: 1, b: 3 })).toEqual({ a: 1, b: 3 });
    expect(keepSame(old, { a: 1 })).toEqual({ a: 1 });
    expect(keepSame({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(keepSame([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(keepSame([1, 2, 3], [1, 2])).toEqual([1, 2]);
  });
  it('일부만 바뀌면 안 바뀐 칸은 옛 참조를 재사용한다 — 줄별 memo 가 산다', () => {
    const a = { id: 'a', s: 'idle' }, b = { id: 'b', s: 'idle' };
    const out = keepSame([a, b], [{ id: 'a', s: 'idle' }, { id: 'b', s: 'busy' }]);
    expect(out[0]).toBe(a);
    expect(out[1]).toEqual({ id: 'b', s: 'busy' });
  });
  it('undefined 칸과 없는 칸을 가른다, 0·빈 글·null·NaN 도 정확히', () => {
    const old: Record<string, unknown> = { a: undefined };
    expect(keepSame(old, {})).toEqual({});
    expect(keepSame({ a: 0 } as Record<string, unknown>, { a: '' })).toEqual({ a: '' });
    expect(keepSame(null as unknown, {})).toEqual({});
    const n = { v: NaN };
    expect(keepSame(n, { v: NaN })).toBe(n);
  });
  it('평범한 객체가 아니면(Map·Date) 그대로 새 값 — 잘못 같다고 치지 않는다', () => {
    const d = new Date(1), m = new Map([[1, 2]]);
    expect(keepSame(d, new Date(1))).not.toBe(d);
    expect(keepSame(m, new Map([[1, 3]]))).not.toBe(m);
  });
});
