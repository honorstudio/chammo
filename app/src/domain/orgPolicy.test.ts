import { describe, expect, it } from 'vitest';
import { blocksAutoAllow, seenDowngrade, type OrgPolicy } from './orgPolicy';
import { retryAfter } from './autoAllow';

const p = (bypass: OrgPolicy['bypass']): OrgPolicy => ({ source: bypass === 'allowed' ? 'none' : 'file', bypass, auto: 'allowed', hooks: 'ours', permRules: 'ours', agentView: 'on' });
const bg = (startedAt: number, mode?: string) => ({ kind: 'background' as const, startedAt, mode });

describe('회사 정책 — 자동 허용을 끄나 (ADR 0023)', () => {
  it('정책을 아직 못 읽었거나 없으면 지금처럼 자동 허용', () => {
    expect(blocksAutoAllow(null, false)).toBe(false);
    expect(blocksAutoAllow(undefined, false)).toBe(false);
    expect(blocksAutoAllow(p('allowed'), false)).toBe(false);
    // 서버 정책은 먹는데 내용을 못 읽음 — 그것만으론 안 끈다(세션이 실제로 낮아졌을 때 끈다)
    expect(blocksAutoAllow(p('unknown'), false)).toBe(false);
  });
  it('바이패스가 막혔거나 세션이 실제로 낮아졌으면 사람 카드로', () => {
    expect(blocksAutoAllow(p('blocked'), false)).toBe(true);
    expect(blocksAutoAllow(null, true)).toBe(true);
    expect(blocksAutoAllow(p('unknown'), true)).toBe(true);
  });
});

describe('세션 첫 권한 모드로 본 낮춤', () => {
  it('가장 최근 백그라운드 세션 둘이 다 바이패스가 아니면 낮춤', () => {
    expect(seenDowngrade([bg(1, 'bypassPermissions'), bg(5, 'auto'), bg(6, 'default')])).toBe(true);
  });
  it('하나만이면 아직 아니다 — 사람이 손으로 띄운 세션 하나로 꺼지지 않게', () => {
    expect(seenDowngrade([bg(5, 'auto')])).toBe(false);
    expect(seenDowngrade([bg(1, 'auto'), bg(6, 'bypassPermissions')])).toBe(false);
    expect(seenDowngrade([bg(1, 'auto'), bg(2, 'default'), bg(6, 'bypassPermissions')])).toBe(false);
  });
  it('모드를 모르는 세션·대화형 세션은 안 센다', () => {
    expect(seenDowngrade([bg(5, 'auto'), bg(6, undefined)])).toBe(false);
    expect(seenDowngrade([bg(5, 'auto'), { kind: 'interactive', startedAt: 6, mode: 'default' }])).toBe(false);
    expect(seenDowngrade([])).toBe(false);
  });
});

describe('다시 보는 간격', () => {
  it('정책 없을 때 쓰던 값은 그대로', () => {
    expect([retryAfter('allowed'), retryAfter('soon'), retryAfter('skipped'), retryAfter('held'), retryAfter('stillOpen'), retryAfter('failed')]).toEqual([5_000, 5_000, 60_000, 600_000, 60_000, 60_000]);
  });
  it('카드를 띄운 창은 30초마다 다시 본다 — 답한 뒤 곧바로 뜬 다음 창도 카드가 되게', () => {
    expect(retryAfter('carded')).toBe(30_000);
  });
});
