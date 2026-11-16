import { describe, expect, it } from 'vitest';
import src from './useTeam.ts?raw';
import { keepSame } from '../../domain/keepSame';

// 2026-11-13 perf-night: useTeam 은 App 이 늘 부른다(useTeamMode) — 15초마다·새 말 알림마다 받은 team_feed 를 비교 없이 넣어
// 내용이 그대로여도 App 전체가 다시 그려졌다. 같은 내용이면 옛 참조를 그대로(keepSame)
describe('팀 받은 말 — 그대로면 다시 안 그린다', () => {
  it('setFeed 는 keepSame 을 거친다', () => {
    expect(src).toMatch(/setFeed\(\(o\) => keepSame\(o, f\)\)/);
    expect(src).not.toMatch(/setFeed\(f\)/);
  });
  it('같은 feed 를 다시 받으면 옛 참조', () => {
    const a = { items: [{ room: 'r', seq: 1, text: '안녕' }], reads: { r: { m: 1 } }, view: { rooms: [{ id: 'r', me: 'm' }] } };
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(keepSame(a, b)).toBe(a);
  });
});
