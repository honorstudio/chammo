// 받기 시간 한도 — 중계 길은 큰 답 뒤에 줄 서 있을 수 있다(느린 셀룰러, 2026-10-27 'aborted').
// 터널이 방금까지 받고 있었으면(느리지만 오는 중) 더 기다리고, 조용하면 끊는다. 먹통 소켓은 터널이 따로 끊는다(hub STALL)
import { describe, expect, it } from 'vitest';
import { READ_LIMIT_MS, READ_MAX_MS, readCheck } from './readLimit';

describe('받기 시간 한도', () => {
  it('직접 길(테일넷)은 예전처럼 20초에 끊는다', () => {
    expect(readCheck({ elapsed: READ_LIMIT_MS, sinceRx: 0, relay: false })).toBe('abort');
  });
  it('중계 길에서 터널이 받고 있으면 더 기다린다 — 다음 확인까지 ms', () => {
    const v = readCheck({ elapsed: READ_LIMIT_MS, sinceRx: 1000, relay: true });
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
  });
  it('중계 길이라도 터널이 조용하면 끊는다', () => {
    expect(readCheck({ elapsed: READ_LIMIT_MS, sinceRx: 30_000, relay: true })).toBe('abort');
  });
  it('받고 있어도 상한(READ_MAX_MS)을 넘으면 끊는다', () => {
    expect(readCheck({ elapsed: READ_MAX_MS, sinceRx: 0, relay: true })).toBe('abort');
  });
});
