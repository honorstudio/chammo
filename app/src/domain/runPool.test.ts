import { describe, expect, it } from 'vitest';
import { runPool } from './runPool';

// 도구 화면 플러그인 토큰 비용 — 플러그인마다 claude 를 하나씩 차례로 불러 10개면 10초쯤 걸렸다(roadmap 도구 화면 ⑦)
describe('runPool — n 개까지만 같이', () => {
  it('한꺼번에 n 개를 넘지 않고 다 돈다', async () => {
    let now = 0, most = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      now += 1; most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 5 - (x % 3)));
      now -= 1; done.push(x);
    });
    expect(most).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('멈추면 새로 시작하지 않는다(화면을 떠남)', async () => {
    let stop = false;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4], 1, async (x) => { seen.push(x); if (x === 2) stop = true; }, () => stop);
    expect(seen).toEqual([1, 2]);
  });
  it('하나가 실패해도 나머지는 돈다', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], 2, async (x) => { if (x === 1) throw new Error('x'); seen.push(x); });
    expect(seen.sort()).toEqual([2, 3]);
  });
});
