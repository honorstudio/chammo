import { describe, expect, it } from 'vitest';
import { SYNC_BACKOFF_MAX, syncGate } from './teamCalSync';

// 0.4.5 리뷰 3 — stale 동안 1초 poll 이 매 tick sync 를 또 시작했고, 실패하면 매초 sync → 배경 몫(BG_CAP) 소진 → 다른 팀 요청 '잠시 쉬래요'
describe('syncGate — 팀마다 따라잡기 하나·실패하면 물러서기', () => {
  const setup = () => {
    let t = 1_000_000;
    const calls: string[] = [];
    const ends: { ok: () => void; fail: () => void }[] = [];
    const gate = syncGate<string>(() => t);
    const run = (team: string) => gate(team, () => { calls.push(team); return new Promise<string>((ok, fail) => ends.push({ ok: () => ok(team), fail: () => fail(new Error('down')) })); });
    return { calls, ends, run, tick: (ms: number) => { t += ms; } };
  };
  it('도는 중이면 새로 안 부르고 같은 약속을 준다(팀이 다르면 따로)', async () => {
    const g = setup();
    const a = g.run('tA');
    expect(g.run('tA')).toBe(a);
    g.run('tB');
    expect(g.calls).toEqual(['tA', 'tB']);
    g.ends[0]!.ok();
    await a;
    g.run('tA');
    expect(g.calls).toEqual(['tA', 'tB', 'tA']);
  });
  it('실패하면 2·4·8…초 동안 안 부르고(null), 최대 2분, 성공하면 처음으로', async () => {
    const g = setup();
    const fail = async () => { const p = g.run('tA')!; g.ends[g.ends.length - 1]!.fail(); await p.catch(() => {}); };
    await fail();
    g.tick(1_000);
    expect(g.run('tA')).toBeNull();
    g.tick(1_000);
    await fail();
    g.tick(3_999);
    expect(g.run('tA')).toBeNull();
    g.tick(1);
    for (let i = 0; i < 10; i++) { await fail(); g.tick(SYNC_BACKOFF_MAX); }
    expect(g.calls.length).toBe(12);
    const ok = g.run('tA')!;
    g.ends[g.ends.length - 1]!.ok();
    await ok;
    await fail();
    g.tick(2_000);
    expect(g.run('tA')).not.toBeNull();
  });
  it('1초마다 60번 불러도 계속 실패하는 1분 동안 sync 는 몇 번뿐', async () => {
    const g = setup();
    for (let s = 0; s < 60; s++) {
      const p = g.run('tA');
      if (p) { g.ends[g.ends.length - 1]!.fail(); await p.catch(() => {}); }
      g.tick(1_000);
    }
    expect(g.calls.length).toBeLessThanOrEqual(6);
  });
});
