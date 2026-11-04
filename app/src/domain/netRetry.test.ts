// 잠깐 끊김 조용히 다시 — 맥↔중계 허브 소켓이 몇 초씩 끊겼다 붙는 동안(2026-11-02 사용자 폰 '맥에 못 닿았어요: Load failed')
// 받기(GET) 하나가 바로 실패해 화면에 오류가 떴다. 망 오류만 몇 번 다시, 쓰기(POST)·끊기(Abort)·서버 답 오류는 그대로
import { describe, expect, it } from 'vitest';
import { idempotent, isTransient, netRetry, retryable, RETRY_DELAYS_MS } from './netRetry';

class OfflineLike extends TypeError {}
const noSleep = () => Promise.resolve();

describe('망 오류 가르기', () => {
  it('fetch 망 오류(TypeError)·컴퓨터 꺼짐(TypeError 를 이은 것)은 잠깐 끊김', () => {
    expect(isTransient(new TypeError('Load failed'))).toBe(true);
    expect(isTransient(new OfflineLike('컴퓨터 Chammo 가 꺼져 있어요'))).toBe(true);
  });
  it('끊기(AbortError)·서버 답 오류(Error)·열쇠 없음은 다시 안 한다', () => {
    expect(isTransient(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isTransient(new Error('HTTP 500'))).toBe(false);
    expect(isTransient('x')).toBe(false);
  });
  it('GET·HEAD 만 다시 해도 된다 — POST 는 맥에서 이미 됐을 수 있다', () => {
    expect(idempotent(undefined)).toBe(true);
    expect(idempotent({})).toBe(true);
    expect(idempotent({ method: 'get' })).toBe(true);
    expect(idempotent({ method: 'HEAD' })).toBe(true);
    expect(idempotent({ method: 'POST' })).toBe(false);
  });
  // 11-04 03:12 사용자 폰 '못 보냈어요 · 맥이 이 말을 못 받았어요' — 맥은 /api/send 를 cid 로 한 번만 친다(mobile_sends). 그 말은 다시 보내도 두 번 안 간다
  it('보내기(/api/send)는 cid 가 있을 때만 다시 — 맥이 같은 cid 를 한 번만 친다', () => {
    const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
    expect(retryable('/api/sessions', undefined)).toBe(true);
    expect(retryable('/api/send', post({ id: 'aaaa0001', text: 'hi', cid: 'c1' }))).toBe(true);
    expect(retryable('/api/send', post({ id: 'aaaa0001', text: 'hi' }))).toBe(false);
    expect(retryable('/api/send', post({ id: 'aaaa0001', text: 'hi', cid: '' }))).toBe(false);
    expect(retryable('/api/send', { method: 'POST', body: 'not json' })).toBe(false);
    expect(retryable('/api/interrupt', post({ id: 'aaaa0001', cid: 'c1' }))).toBe(false);
  });
});

describe('netRetry', () => {
  it('허브가 잠깐 끊겨 한 번 실패해도 다음 번에 받으면 오류 없이 답', async () => {
    let n = 0;
    const waits: number[] = [];
    const v = await netRetry(async () => { n++; if (n < 3) throw new TypeError('Load failed'); return 'ok'; }, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    expect(v).toBe('ok');
    expect(n).toBe(3);
    expect(waits).toEqual(RETRY_DELAYS_MS.slice(0, 2));
  });
  it('기다림은 점점 길게(백오프), 합쳐도 맥이 다시 붙는 시간(4~16초) 안팎', () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) expect(RETRY_DELAYS_MS[i]!).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]!);
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(4000);
    expect(total).toBeLessThanOrEqual(10_000);
  });
  it('끝까지 안 되면 마지막 오류를 그대로 — 위에서 못 닿음을 판단한다', async () => {
    let n = 0;
    await expect(netRetry(async () => { n++; throw new TypeError(`Load failed ${n}`); }, { sleep: noSleep })).rejects.toThrow(`Load failed ${RETRY_DELAYS_MS.length + 1}`);
    expect(n).toBe(RETRY_DELAYS_MS.length + 1);
  });
  it('서버 답 오류·끊기는 바로 던진다(다시 안 함)', async () => {
    let n = 0;
    await expect(netRetry(async () => { n++; throw new Error('HTTP 500'); }, { sleep: noSleep })).rejects.toThrow('HTTP 500');
    expect(n).toBe(1);
    n = 0;
    await expect(netRetry(async () => { n++; throw new DOMException('aborted', 'AbortError'); }, { sleep: noSleep })).rejects.toThrow('aborted');
    expect(n).toBe(1);
  });
  it('기다리는 동안 부른 쪽이 끊으면(받기 고리 kick·시간 한도) 더 안 하고 끊긴 이유로', async () => {
    const c = new AbortController();
    let n = 0;
    const p = netRetry(async () => { n++; throw new TypeError('Load failed'); }, { signal: c.signal, sleep: () => { c.abort(new DOMException('kick', 'AbortError')); return Promise.resolve(); } });
    await expect(p).rejects.toThrow('kick');
    expect(n).toBe(1);
  });
  it('기본 sleep 은 진짜 타이머 — 끊으면 기다림도 바로 끝난다', async () => {
    const c = new AbortController();
    const t0 = Date.now();
    const p = netRetry(async () => { throw new TypeError('Load failed'); }, { signal: c.signal });
    setTimeout(() => c.abort(new DOMException('stop', 'AbortError')), 20);
    await expect(p).rejects.toThrow('stop');
    expect(Date.now() - t0).toBeLessThan(RETRY_DELAYS_MS[0]!);
  });
});
