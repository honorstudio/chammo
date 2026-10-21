import { describe, expect, it } from 'vitest';
import { SPR } from '../tama/sprites';
import { transparentCells } from './draw';

const body = (name: string) => { const rows = SPR[name]!; const out = transparentCells(name); let n = 0; rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '.' && !out.has(y * r.length + x)) n++; })); return n; };

describe('캐릭터 몸통 — 외곽선에 틈이 있어도 투명해지지 않는다(2026-09-27 사용자: acme-shop 캐릭터 몸이 투명)', () => {
  it('틈 있는 도트도 몸통이 찬다', () => {
    expect(body('fire_cG')).toBeGreaterThanOrEqual(60); // 전엔 20
    expect(body('wave_cT')).toBeGreaterThanOrEqual(40); // 전엔 0
    expect(body('wave_cS')).toBeGreaterThanOrEqual(60); // 전엔 12
  });
  it('원래 잘 차던 도트는 그대로', () => {
    expect(body('bear')).toBe(106);
  });
  it('다리 사이·귀 사이 같은 바깥은 여전히 투명', () => {
    const out = transparentCells('fire_cG'), w = SPR.fire_cG![0]!.length;
    expect(out.has(0 * w + 1)).toBe(true); // 머리 위 뿔 사이
    expect(out.has(14 * w + 7)).toBe(true); // 다리 사이
  });
  it('배에 세로 투명 줄이 안 난다 — 다리 사이 물이 몸통까지 파고들던 것(2026-10-21 사용자 도트 구멍)', () => {
    const slit = (name: string, x: number, y: number) => transparentCells(name).has(y * SPR[name]![0]!.length + x);
    for (const [name, x, y] of [['fire_cG', 7, 9], ['fire_p3', 7, 9], ['wave_r1', 5, 13], ['leaf_cS', 7, 6], ['leaf_p1', 7, 11], ['leaf_m2', 7, 9]] as const) expect(slit(name, x, y), `${name} ${x},${y}`).toBe(false);
    // 슬릿 = 양옆이 몸통·무늬인 투명 칸. 바깥 다리 사이(양옆이 외곽선)는 그대로
    for (const name of Object.keys(SPR)) {
      const rows = SPR[name]!, w = rows[0]!.length, out = transparentCells(name);
      const inner = (y: number, x: number) => x >= 0 && x < w && !(rows[y]![x] === '.' && out.has(y * w + x)) && rows[y]![x] !== '#';
      rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '.' && out.has(y * w + x) && y > 0 && inner(y, x - 1) && inner(y, x + 1) && inner(y - 1, x)) expect.fail(`${name} ${x},${y}`); }));
    }
  });
});
