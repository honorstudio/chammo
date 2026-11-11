// 못 닿음 표시는 오래 끊길 때만 — 받기 한 번 실패로 폰 전체가 '맥에 못 닿았어요: Load failed' 가 됐다(2026-11-02 23:25 사용자 캡처).
// 맥↔중계 허브가 끊겼다 붙는 몇 초(로그: 4~16초)는 보던 화면(첫 켜기면 모찌)을 그대로 두고 빨리 다시 받는다
import { describe, expect, it } from 'vitest';
import { FAIL_EVERY_MS, netText, OK_EVERY_MS, UNREACH_GRACE_MS, unreachStep } from './unreach';

describe('못 닿음 표시 유예', () => {
  it('첫 실패는 숨긴다 — 실패 줄의 시작(그 받기를 시작한 때)을 기억', () => {
    expect(unreachStep({ since: 0 }, { ok: false, startedAt: 1000, now: 1500 })).toEqual({ since: 1000, show: false });
  });
  it('계속 실패해도 유예 안이면 숨긴다', () => {
    expect(unreachStep({ since: 1000 }, { ok: false, startedAt: 9000, now: 1000 + UNREACH_GRACE_MS - 1 })).toEqual({ since: 1000, show: false });
  });
  it('실패가 유예만큼 이어지면 그때 보인다', () => {
    expect(unreachStep({ since: 1000 }, { ok: false, startedAt: 9000, now: 1000 + UNREACH_GRACE_MS })).toEqual({ since: 1000, show: true });
  });
  it('한 번이라도 받으면 실패 줄이 끊긴다 — 다음 실패는 다시 처음부터 유예', () => {
    const ok = unreachStep({ since: 1000 }, { ok: true, startedAt: 30_000, now: 30_500 });
    expect(ok).toEqual({ since: 0, show: false });
    expect(unreachStep(ok, { ok: false, startedAt: 40_000, now: 41_000 })).toEqual({ since: 40_000, show: false });
  });
  it('유예는 맥이 끊겼다 다시 붙는 보통 시간(로그 4~16초)을 덮을 만큼 — 15초 이상', () => {
    expect(UNREACH_GRACE_MS).toBeGreaterThanOrEqual(15_000);
    // 맥이 정말 꺼졌을 땐 너무 오래 숨기지 않는다
    expect(UNREACH_GRACE_MS).toBeLessThanOrEqual(20_000);
  });
  it('실패 중엔 더 자주 다시 받는다(붙자마자 화면이 따라오게)', () => {
    expect(FAIL_EVERY_MS).toBeLessThan(OK_EVERY_MS);
  });
});

// 11-04 사용자 '저 문구들(이 맥 어쩌구) 정상화' — 윗줄·첫 화면에 'Load failed'·'허브…' 같은 속 오류 글이 그대로 나갔다. 사람 말로 바꾼다
describe('연결 오류 → 화면 글', () => {
  class OfflineError extends TypeError { override name = 'OfflineError'; }
  class TrustError extends TypeError { override name = 'TrustError'; }
  it('망 오류(Load failed·허브 글)는 잠깐 끊김 한 줄', () => {
    expect(netText(new TypeError('Load failed'))).toBe('연결이 잠깐 끊겼어요. 자동으로 재연결해요');
    expect(netText(new TypeError('허브에 못 붙었어요'))).toBe('연결이 잠깐 끊겼어요. 자동으로 재연결해요');
  });
  it('컴퓨터 꺼짐·확인 실패는 할 일 한 가지', () => {
    expect(netText(new OfflineError('x'))).toBe('맥에서 Chammo 를 켜 주세요');
    expect(netText(new TrustError('x'))).toBe('이 폰 연결이 풀렸어요. 다시 연결해 주세요');
  });
  it('이미 사람 말로 만든 오류(느림·답 없음)·서버 글은 그대로', () => {
    expect(netText(new DOMException('연결이 느려요. 자동으로 다시 받아요', 'AbortError'))).toBe('연결이 느려요. 자동으로 다시 받아요');
    expect(netText(new Error('HTTP 500'))).toBe('HTTP 500');
  });
});
