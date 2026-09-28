import { describe, expect, it } from 'vitest';
import { parseAllowLog } from './autoAllow';

describe('parseAllowLog — 자동 허용 기록 (최근 것이 위, 최대 n 개)', () => {
  it('깨진 줄은 건너뛰고 최근 순', () => {
    const raw = [
      JSON.stringify({ ts: '2026-09-27T01:00:00Z', where: 'acme-shop', option: 'Allow for this session', result: '허용됨' }),
      '{깨짐',
      JSON.stringify({ ts: '2026-09-27T02:00:00Z', where: 'oms', option: '1. Yes', result: '풀리지 않음' }),
    ].join('\n');
    expect(parseAllowLog(raw, 5).map((e) => e.where)).toEqual(['oms', 'acme-shop']);
    expect(parseAllowLog(raw, 1)).toHaveLength(1);
  });
});
