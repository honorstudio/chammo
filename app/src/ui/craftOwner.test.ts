import { describe, expect, it } from 'vitest';
import { craftOwner, forgetCraftOwner, setCraftOwner } from './craftOwner';

describe('칸이 놓인 참모 기억', () => {
  it('꺼짐 판정보다 늦게 적힌 것은 안 지운다 — 끈 뒤 곧바로 같은 키로 다시 띄웠다(2026-10-21 리뷰)', () => {
    setCraftOwner('gridcraft-2', 'A', 1_000);
    forgetCraftOwner('gridcraft-2', 5_000, 4_000); // 4초 전부터 안 보였다 → 1초에 적힌 건 옛 것
    expect(craftOwner('gridcraft-2')).toBeUndefined();
    setCraftOwner('gridcraft-2', 'B', 9_000);
    forgetCraftOwner('gridcraft-2', 10_000, 4_000); // 6초 전부터 안 보였다 — 9초에 적힌 건 새 인스턴스 것
    expect(craftOwner('gridcraft-2')).toBe('B');
  });
});
