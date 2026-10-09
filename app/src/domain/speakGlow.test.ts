import { describe, expect, it } from 'vitest';
import { foldSay, levelAt, speakingFrom, type Glow, type SayNow } from './speakGlow';

const now = (o: Partial<SayNow>): SayNow => ({ id: 100, from: 'f00d0007', phase: 'playing', startedMs: 1_000, hopMs: 25, env: null, ...o });

describe('foldSay — 늦게 온 옛 상태가 빛을 다시 켜지 않게(2026-10-03 사용자 "끊으면 즉시")', () => {
  it('처음 받은 상태는 그대로, 곡선은 받은 번호에서 이어 쓴다', () => {
    const a = foldSay(null, now({ env: [10, 20] }));
    expect(a.env).toEqual([10, 20]);
    const b = foldSay(a, now({ env: null })); // 같은 번호면 Rust 는 곡선을 다시 안 보낸다
    expect(b.env).toEqual([10, 20]);
  });
  it('앞 번호 상태가 늦게 와도 무시', () => {
    const a = foldSay(null, now({ id: 200 }));
    expect(foldSay(a, now({ id: 199, phase: 'playing' }))).toBe(a);
  });
  it('멈춤·끝 뒤에 같은 번호의 재생 중이 늦게 와도 멈춤 그대로', () => {
    const a = foldSay(foldSay(null, now({})), now({ phase: 'stopped' }));
    expect(foldSay(a, now({ phase: 'playing' })).phase).toBe('stopped');
    const d = foldSay(foldSay(null, now({})), now({ phase: 'done' }));
    expect(foldSay(d, now({ phase: 'playing' })).phase).toBe('done');
  });
  it('새 번호면 새 말 — 곡선도 새로', () => {
    const a = foldSay(null, now({ env: [5] }));
    const b = foldSay(a, now({ id: 101, from: 'f00d0008', env: null }));
    expect([b.from, b.env]).toEqual(['f00d0008', null]);
  });
});

describe('speakingFrom — 빛낼 참모는 재생 중일 때만', () => {
  it('기다림(만드는 중)·끝·멈춤이면 아무도 아님', () => {
    expect(speakingFrom(foldSay(null, now({})), 1_000)).toBe('f00d0007');
    for (const phase of ['waiting', 'done', 'stopped'] as const) expect(speakingFrom(foldSay(null, now({ phase })), 1_000)).toBeNull();
    expect(speakingFrom(null, 1_000)).toBeNull();
  });
  // 2026-10-10 사용자 QA "소리와 박자가 안 맞는다" — Rust 가 주는 시작 시각은 소리가 귀에 닿는 때(블루투스면 0.4초쯤 뒤)라
  // 그 전엔 테두리도 안 켠다. 전엔 afplay 를 띄운 때부터 켜져 빛이 소리보다 0.42~0.56초 먼저 났다
  it('소리가 닿기 전(시작 시각 전)엔 아직 아무도 아님', () => {
    const g = foldSay(null, now({ startedMs: 1_400 }));
    expect(speakingFrom(g, 1_399)).toBeNull();
    expect(speakingFrom(g, 1_400)).toBe('f00d0007');
  });
});

describe('levelAt — 지금 시각의 빛 세기(0~1)', () => {
  const g: Glow = { ...now({ env: [0, 255, 128] }), env: [0, 255, 128] };
  it('지금 시각 - 시작 시각으로 25ms 칸을 찾는다. 조용한 칸도 약하게는 남는다(누가 말하는지 보이게)', () => {
    expect(levelAt(g, 1_010)).toBeCloseTo(0.15);
    expect(levelAt(g, 1_030)).toBeCloseTo(1);
    expect(levelAt(g, 1_060)).toBeCloseTo(0.15 + 0.85 * (128 / 255));
  });
  it('시작 전·곡선 끝 뒤는 0 — 소리가 자연히 끝나면 빛도 0', () => {
    expect(levelAt(g, 999)).toBe(0);
    expect(levelAt(g, 1_075)).toBe(0);
  });
  it('멈춤·끝·기다림이면 0', () => {
    for (const phase of ['stopped', 'done', 'waiting'] as const) expect(levelAt({ ...g, phase }, 1_030)).toBe(0);
  });
  it('곡선이 없으면(say·직접 명령) 일정한 숨쉬기 빛', () => {
    const b: Glow = { ...g, env: null };
    const xs = [1_000, 1_400, 1_800, 2_200].map((t) => levelAt(b, t));
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0.25);
    for (const x of xs) expect(x).toBeLessThanOrEqual(0.85);
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBeGreaterThan(1);
  });
  it('동작 줄이기 설정이면 크기 따라 안 움직이고 일정한 빛', () => {
    expect(levelAt(g, 1_010, true)).toBe(0.7);
    expect(levelAt(g, 1_030, true)).toBe(0.7);
    expect(levelAt({ ...g, phase: 'stopped' }, 1_030, true)).toBe(0);
  });
});
