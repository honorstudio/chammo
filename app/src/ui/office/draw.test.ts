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
});
