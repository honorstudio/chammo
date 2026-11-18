import { describe, expect, it } from 'vitest';
import { Sound } from './kidsVoice';

const fakeCtx = () => ({ decodeAudioData: async (b: ArrayBuffer) => ({ length: b.byteLength }) }) as unknown as AudioContext;

describe('미리 만든 말 받기(11-18 진짜 아이패드)', () => {
  it('맥이 아직 만드는 중이면(404) 그 말만 빼고, 조금 뒤 못 받은 것만 다시 받는다', async () => {
    const s = new Sound();
    s.ctx = fakeCtx();
    let ready = false;
    const asked: number[] = [];
    const get = async (i: number) => { asked.push(i); if (!ready) throw new Error('not ready'); return new ArrayBuffer(i); };
    const done = s.loadPre(get, 3, { tries: 5, gapMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.hasPre(1)).toBe(false);
    ready = true;
    await done;
    expect([1, 2, 3].every((i) => s.hasPre(i))).toBe(true);
    const n = asked.length;
    await s.loadPre(get, 3, { tries: 5, gapMs: 1 });
    expect(asked.length).toBe(n + 3);
  });

  it('끝내 못 받아도 정한 횟수에서 멈춘다', async () => {
    const s = new Sound();
    s.ctx = fakeCtx();
    let calls = 0;
    await s.loadPre(async () => { calls++; throw new Error('not ready'); }, 2, { tries: 3, gapMs: 1 });
    expect(calls).toBe(2 * 4);
    expect(s.hasPre(1)).toBe(false);
  });
});

describe('추임새(11-18 사용자 — 이어 갈 것 같은 쉼에 짧게)', () => {
  it('다섯 개를 돌려 쓰되 같은 말이 연달아 나오지 않는다', async () => {
    const { nextFiller, FILLERS } = await import('./kidsVoice');
    let last: number | null = null;
    for (let i = 0; i < 200; i++) {
      const n = nextFiller(last);
      expect(FILLERS).toContain(n);
      expect(n).not.toBe(last);
      last = n;
    }
    expect(nextFiller(21, () => 0.999)).not.toBe(21);
  });
  it('추임새는 쥐고 있다가 아이가 다시 말하면 멈춘다', () => {
    const s = new Sound();
    const stopped: string[] = [];
    s.ctx = { createBufferSource: () => ({ connect() {}, start() {}, stop() { stopped.push('x'); }, onended: null, buffer: null }), destination: {}, state: 'running', resume() {} } as unknown as AudioContext;
    (s as unknown as { pre: unknown[] }).pre = Array.from({ length: 25 }, () => ({}));
    expect(s.playFiller(22)).toBe(true);
    s.stopFiller();
    expect(stopped.length).toBe(1);
    s.stopFiller();
    expect(stopped.length).toBe(1, );
  });
});
