import { describe, expect, it, vi } from 'vitest';
import { paneLinks } from './paneLinks';
import grid from '../ui/SessionGrid.tsx?raw';

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

// 2026-11-05 개발 담당 18:13 '보내는 중 → 전달 안 됨', 다시 보내도 같음(앱을 껐다 켜야 풀림): links 는 모듈 전역(세션 id)인데 SessionGrid 는 여러 벌이다.
// 같은 세션 칸이 다른 격자에도 떴다 내려가면 그 정리가 남은 칸 손잡이까지 지워, 남은 칸은 live 인데 onLink 를 다시 안 불러 영영 빈다 → 80초 기다리다 실패
describe('paneLinks — 같은 세션 칸이 격자 여러 벌에 있을 때', () => {
  const A = {}; const B = {};
  it('다른 격자 칸이 내려가도 남은 칸으로 친다', async () => {
    const l = paneLinks<string>();
    l.set('s', 'a-api', A);
    l.set('s', 'b-api', B);
    expect(l.get('s')).toBe('b-api'); // 나중에 붙은 칸
    l.set('s', null, B);
    expect(l.get('s')).toBe('a-api');
    await expect(l.wait('s', 10)).resolves.toBe('a-api');
  });
  it('먼저 붙은 칸이 내려가면 나중 칸이 그대로', () => {
    const l = paneLinks<string>();
    l.set('s', 'a-api', A);
    l.set('s', 'b-api', B);
    l.set('s', null, A);
    expect(l.get('s')).toBe('b-api');
  });
  it('보기 전환 순서 — 새 칸이 live 된 뒤 옛 칸 정리여도 새 칸이 남는다', () => {
    const l = paneLinks<string>();
    l.set('s', 'old', A);
    l.set('s', 'new', B);
    l.set('s', null, A);
    expect(l.get('s')).toBe('new');
  });
  it('옛 칸 정리 뒤 새 칸이 붙으면 기다리던 말이 새 칸으로', async () => {
    const l = paneLinks<string>();
    l.set('s', 'old', A);
    l.set('s', null, A);
    const p = l.wait('s', 10_000);
    l.set('s', 'new', B);
    await expect(p).resolves.toBe('new');
  });
  it('같은 칸이 다시 붙으면 새 손잡이로 바꾼다(줄이 쌓이지 않는다)', () => {
    const l = paneLinks<string>();
    l.set('s', 'v1', A);
    l.set('s', 'v2', A);
    l.set('s', null, A);
    expect(l.get('s')).toBeUndefined();
  });
  it('등록 안 한 칸의 정리는 아무것도 안 지운다', () => {
    const l = paneLinks<string>();
    l.set('s', 'a-api', A);
    l.set('s', null, B);
    expect(l.get('s')).toBe('a-api');
  });
  it('SessionGrid 는 칸 주인을 넘기고, 내려간 뒤 남은 칸이 있으면 live 로 둔다', () => {
    expect(grid).toMatch(/links\.set\(id, st === 'live' \? panes\.current\.get\(id\) \?\? null : null, panes\)/);
    expect(grid).toMatch(/links\.set\(id, null, panes\); if \(links\.get\(id\)\) linkNow\.set\(id, 'live'\); else linkNow\.delete\(id\);/);
    expect(grid).toMatch(/linkNow\.set\(id, links\.get\(id\) \? 'live' : st\)/);
  });
});
