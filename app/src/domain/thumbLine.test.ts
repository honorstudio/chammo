// 폰 썸네일 줄(11-06 사용자 "썸네일이 안 보인다") — 대화를 열면 파일마다 요청이 한꺼번에 나가 중계 일꾼(8개)을 넘긴 것이 503 busy 로 끝났다.
// 실측: 대화를 열 때마다 썸네일이 꼭 7장씩만 찍혔다(21:15:08·21:15:19·21:15:57·21:16:20)
import { describe, expect, it } from 'vitest';
import { thumbLine } from './thumbLine';

/** 끝을 손으로 정하는 일 */
function hand<T>() {
  let ok!: (v: T) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => { ok = a; no = b; });
  return { p, ok, no };
}
const tick = () => new Promise((r) => setTimeout(r));
const noWait = { sleep: () => Promise.resolve() };

describe('thumbLine', () => {
  it('한 번에 limit 개만 — 나머지는 앞 일이 끝나야 나간다', async () => {
    const line = thumbLine(2, noWait);
    const jobs = [hand<number>(), hand<number>(), hand<number>(), hand<number>()];
    let started = 0;
    const all = jobs.map((j) => line(() => { started++; return j.p; }));
    await tick();
    expect(started).toBe(2);
    jobs[0]!.ok(0);
    await tick();
    expect(started).toBe(3);
    jobs.forEach((j, i) => j.ok(i));
    await expect(Promise.all(all)).resolves.toHaveLength(4);
    expect(started).toBe(4);
  });

  it('나중에 부른 것 먼저 — 방금 화면에 들어온 칸이 오래 기다리지 않게', async () => {
    const line = thumbLine(1, noWait);
    const first = hand<string>();
    const order: string[] = [];
    void line(() => { order.push('a'); return first.p; });
    void line(() => { order.push('b'); return Promise.resolve('b'); });
    const c = line(() => { order.push('c'); return Promise.resolve('c'); });
    await tick();
    first.ok('a');
    await c;
    await tick();
    expect(order).toEqual(['a', 'c', 'b']);
  });

  it('맥이 busy(503)면 기다렸다 다시 — 이번엔 그려진다', async () => {
    const line = thumbLine(2, noWait);
    let n = 0;
    await expect(line(() => { n++; return n < 3 ? Promise.reject(new Error('busy')) : Promise.resolve('그림'); })).resolves.toBe('그림');
    expect(n).toBe(3);
  });

  it('busy 를 기다리는 동안은 자리를 안 쥔다 — 다음 일이 나간다', async () => {
    const gate = hand<void>();
    const line = thumbLine(1, { sleep: () => gate.p });
    let n = 0;
    const a = line(() => { n++; return n === 1 ? Promise.reject(new Error('busy')) : Promise.resolve('a'); });
    await tick();
    await expect(line(() => Promise.resolve('b'))).resolves.toBe('b');
    gate.ok();
    await expect(a).resolves.toBe('a');
  });

  it('다른 실패(그릴 수 없는 파일 415 등)는 다시 안 한다', async () => {
    const line = thumbLine(2, noWait);
    let n = 0;
    await expect(line(() => { n++; return Promise.reject(new Error('그림이 아니야')); })).rejects.toThrow('그림이 아니야');
    expect(n).toBe(1);
  });

  it('busy 가 끝내 안 풀리면 실패로 끝나고 자리는 돌려준다', async () => {
    const line = thumbLine(1, { sleep: () => Promise.resolve(), delays: [1, 1] });
    let n = 0;
    await expect(line(() => { n++; return Promise.reject(new Error('busy')); })).rejects.toThrow('busy');
    expect(n).toBe(3);
    await expect(line(() => Promise.resolve('다음'))).resolves.toBe('다음');
  });

  it('일이 바로 던져도 줄이 안 멈춘다', async () => {
    const line = thumbLine(1, noWait);
    await expect(line(() => { throw new Error('바로'); })).rejects.toThrow('바로');
    await expect(line(() => Promise.resolve('다음'))).resolves.toBe('다음');
  });
});
