import { describe, expect, it } from 'vitest';
import type { Egg, Slot } from '../../domain/tama/tree';
import { draw, spriteOf } from './lcd';
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

describe('draw — 그림이 같으면 다시 안 칠한다(2026-10-11 perf, 480ms 마다 1,440칸을 늘 다시 칠하던 것)', () => {
  const fake = () => {
    let fills = 0;
    const g = { fillStyle: '', globalAlpha: 1, fillRect: () => { fills++; } };
    const c = { width: 64, height: 32, getContext: () => g } as unknown as HTMLCanvasElement;
    return { c, fills: () => fills };
  };
  const st = { scene: 'sleep' as const, lit: [], who: 'egg' };
  it('같은 장면·같은 프레임이면 두 번째는 건너뛴다', () => {
    const f = fake();
    draw(f.c, st, 0, 'light', true);
    const once = f.fills();
    expect(once).toBeGreaterThan(0);
    draw(f.c, st, 6, 'light', true); // sleep 은 6틱마다 같은 그림
    expect(f.fills()).toBe(once);
  });
  it('프레임·색·크기가 바뀌면 다시 칠한다', () => {
    const f = fake();
    draw(f.c, st, 0, 'light', true);
    const a = f.fills();
    draw(f.c, st, 1, 'light', true);
    const b = f.fills();
    expect(b).toBeGreaterThan(a);
    draw(f.c, st, 1, 'dark', true);
    const c2 = f.fills();
    expect(c2).toBeGreaterThan(b);
    (f.c as { width: number }).width = 128;
    draw(f.c, st, 1, 'dark', true);
    expect(f.fills()).toBeGreaterThan(c2);
  });
});
