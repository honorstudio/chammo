import { describe, expect, it, vi } from 'vitest';
import { paneLinks } from './paneLinks';

// 세션 id → 지금 살아 있는 터미널 보기 손잡이. 끊긴 동안(다시 붙는 중·참모를 다시 켜는 중) 친 말은 버리지 않고
// 새 창이 붙을 때까지 기다렸다가 그 창에 친다 — 줄(typeQueue) 순서 그대로라 두 번 가지도 섞이지도 않는다
describe('paneLinks — 끊긴 터미널 보기가 다시 붙을 때까지 치기를 기다린다', () => {
  it('붙어 있으면 바로 그 손잡이', async () => {
    const l = paneLinks<string>();
    l.set('a', 'api1');
    await expect(l.wait('a', 1000)).resolves.toBe('api1');
  });

  it('끊겼다(null) 다시 붙으면 새 손잡이로 — 기다리던 순서대로', async () => {
    const l = paneLinks<string>();
    l.set('a', 'old');
    l.set('a', null);
    const got: string[] = [];
    const p1 = l.wait('a', 10_000).then((x) => got.push(`1:${x}`));
    const p2 = l.wait('a', 10_000).then((x) => got.push(`2:${x}`));
    l.set('a', 'new');
    await Promise.all([p1, p2]);
    expect(got).toEqual(['1:new', '2:new']);
  });

  it('끝내 안 붙으면 실패 — 그 말은 채팅에 전달 안 됨으로 남는다', async () => {
    vi.useFakeTimers();
    try {
      const l = paneLinks<string>();
      const p = l.wait('a', 5000);
      vi.advanceTimersByTime(5001);
      await expect(p).rejects.toThrow();
      l.set('a', 'late'); // 늦게 붙어도 이미 실패한 말은 안 친다
    } finally {
      vi.useRealTimers();
    }
  });

  it('다른 세션은 서로 안 건드린다', async () => {
    const l = paneLinks<string>();
    l.set('b', 'B');
    await expect(l.wait('b', 10)).resolves.toBe('B');
    expect(l.get('a')).toBeUndefined();
  });
});

// 2026-10-26 부팅 직후 — 붙는 데 80초를 넘겨(데몬이 참모를 두 번 다시 켬) 기다리던 말이 '전달 안 됨'으로 버려졌다.
// 칸이 아직 붙는 중이면(hold) 기다림을 늘리고, 끊김이 굳으면(drop) 바로 놓아 사람이 다시 보내도 두 번 안 가게
describe('paneLinks — 붙는 중이면 더 기다리고, 굳으면 바로 놓는다', () => {
  it('hold 가 참이면 시간을 넘겨도 계속 기다렸다 붙으면 친다', async () => {
    vi.useFakeTimers();
    try {
      const l = paneLinks<string>();
      let holding = true;
      const p = l.wait('a', 5000, () => holding);
      await vi.advanceTimersByTimeAsync(20_000);
      l.set('a', 'late');
      await expect(p).resolves.toBe('late');
      holding = false;
    } finally {
      vi.useRealTimers();
    }
  });
  it('hold 가 거짓이 되면 다음 시한에 실패', async () => {
    vi.useFakeTimers();
    try {
      const l = paneLinks<string>();
      let holding = true;
      const p = l.wait('a', 5000, () => holding);
      const seen = p.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(6000);
      holding = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(await seen).toBe('pane detached');
    } finally {
      vi.useRealTimers();
    }
  });
  it('drop — 기다리던 말을 바로 놓는다(그 뒤 붙어도 안 친다)', async () => {
    const l = paneLinks<string>();
    const p = l.wait('a', 60_000, () => true);
    l.drop('a');
    await expect(p).rejects.toThrow('pane detached');
    l.set('a', 'new');
    await expect(l.wait('a', 10)).resolves.toBe('new');
  });
});
