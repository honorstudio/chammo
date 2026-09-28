import { describe, expect, it } from 'vitest';
import type { Egg, Slot } from '../../domain/tama/tree';
import { spriteOf } from './lcd';
import { SPR } from './sprites';

const EGGS: Egg[] = ['fire', 'wave', 'leaf', 'star'];
const SLOTS: Slot[] = ['egg', 'i1', 'i2', 'r1', 'r2', 'cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN', 'cX', 'p1', 'p2', 'p3', 'm1', 'm2'];

describe('spriteOf — 도감 74종 전부 전용 그림 (알 4 + 계열 4 × 17(숨은 성숙기 포함) + 합체 2)', () => {
  it('모든 계열·자리에 16×16 그림이 있고, 서로 다르다', () => {
    const names = EGGS.flatMap((e) => SLOTS.map((s) => spriteOf(e, s)));
    for (const n of names) {
      expect(SPR[n], n).toBeDefined();
      expect(SPR[n]!.length, n).toBe(16);
      expect(SPR[n]!.every((r) => r.length === 16), n).toBe(true);
    }
    expect(new Set(names).size).toBe(names.length);
    const fused = [spriteOf('fire', 'jA'), spriteOf('star', 'jB')];
    for (const n of fused) expect(SPR[n], n).toBeDefined();
    expect(names.length + fused.length).toBe(74);
  });

  it('망치곰은 표정 변형이 있는 그림을 쓴다', () => {
    expect(spriteOf('fire', 'r1')).toBe('bear');
  });
});
