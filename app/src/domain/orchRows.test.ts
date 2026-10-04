import { describe, expect, it } from 'vitest';
import type { Session } from './session';
import type { StoppedSession } from './stopped';
import { arrivedOrch, creatingRow, orchRows, type OrchRow } from './orchRows';

const live = (id: string, name: string): Session => ({ id, name, cwd: '/hq', kind: 'background', state: 'idle', project: 'hq', workspace: null, startedAt: 0, sessionId: `s-${id}` });
const off = (id: string, name: string): StoppedSession => ({ id, sessionId: `s-${id}`, name, cwd: '/hq', project: 'hq', workspace: null, reason: 'done', startedAt: 0 });
const keys = (r: OrchRow[]) => r.map((x) => `${(x.live?.name ?? x.off!.name).split(' · ')[0]}:${x.phase}`); // 줄 키는 세션 — 읽기 쉽게 기본 이름으로
const none = new Set<string>();

describe('orchRows — 끄기·켜기 사이에 줄이 사라지거나 자리가 튀지 않게(2026-10-02 사용자)', () => {
  it('처음: 살아 있는 참모 먼저, 꺼진 참모 뒤', () => {
    const r = orchRows({ live: [live('a', '참모'), live('b', '참모-2')], off: [off('c', '참모-3')], stopping: none, starting: none, prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:live', '참모-3:off']);
  });

  it('끄는 중: 줄을 그대로 두고 상태만 끄는 중 → 목록이 따라오면 같은 자리에서 꺼짐', () => {
    const p0 = orchRows({ live: [live('a', '참모'), live('b', '참모-2'), live('c', '참모-3')], off: [], stopping: none, starting: none, prev: [] });
    const p1 = orchRows({ live: [live('a', '참모'), live('b', '참모-2'), live('c', '참모-3')], off: [], stopping: new Set(['b']), starting: none, prev: p0 });
    expect(keys(p1)).toEqual(['참모:live', '참모-2:stopping', '참모-3:live']);
    // 끄고 난 뒤 — 살아 있는 목록에선 빠지고 꺼진 목록에 들어왔다. 자리는 그대로(맨 아래로 안 튄다)
    const p2 = orchRows({ live: [live('a', '참모'), live('c', '참모-3')], off: [off('b', '참모-2')], stopping: none, starting: none, prev: p1 });
    expect(keys(p2)).toEqual(['참모:live', '참모-2:off', '참모-3:live']);
  });

  it('끄는 중인데 두 목록 어디에도 없는 찰나(갱신 사이) — 마지막 모습으로 남긴다', () => {
    const p1 = orchRows({ live: [live('a', '참모'), live('b', '참모-2')], off: [], stopping: new Set(['b']), starting: none, prev: [] });
    const gap = orchRows({ live: [live('a', '참모')], off: [], stopping: new Set(['b']), starting: none, prev: p1 });
    expect(keys(gap)).toEqual(['참모:live', '참모-2:stopping']);
    // 끄기가 끝났는데도 어디에도 없으면(지운 것) 그때 사라진다
    expect(keys(orchRows({ live: [live('a', '참모')], off: [], stopping: none, starting: none, prev: gap }))).toEqual(['참모:live']);
  });

  it('켜는 중: 꺼진 줄을 그대로 두고 상태만 켜는 중 → 살아 있는 목록에 뜨면 같은 자리에서 살아남', () => {
    const p0 = orchRows({ live: [live('a', '참모')], off: [off('b', '참모-2'), off('c', '참모-3')], stopping: none, starting: none, prev: [] });
    const p1 = orchRows({ live: [live('a', '참모')], off: [off('b', '참모-2'), off('c', '참모-3')], stopping: none, starting: new Set(['s-c']), prev: p0 });
    expect(keys(p1)).toEqual(['참모:live', '참모-2:off', '참모-3:starting']);
    // 되살아남 — 살아 있는 목록 끝에 붙어 와도 자리는 그대로
    const p2 = orchRows({ live: [live('a', '참모'), live('c', '참모-3')], off: [off('b', '참모-2')], stopping: none, starting: new Set(['s-c']), prev: p1 });
    expect(keys(p2)).toEqual(['참모:live', '참모-2:off', '참모-3:live']);
  });

  it('켜는 중인데 꺼진 목록에서 빠지고 아직 안 뜬 찰나 — 켜는 중으로 남긴다', () => {
    const p1 = orchRows({ live: [], off: [off('b', '참모-2')], stopping: none, starting: new Set(['s-b']), prev: [] });
    expect(keys(orchRows({ live: [], off: [], stopping: none, starting: new Set(['s-b']), prev: p1 }))).toEqual(['참모-2:starting']);
  });

  it('별명이 붙거나 바뀌어도 같은 줄(기본 이름으로 묶는다)', () => {
    const p1 = orchRows({ live: [live('b', '참모-2')], off: [], stopping: none, starting: none, prev: [] });
    const p2 = orchRows({ live: [live('b', '참모-2 · 참모 업데이트')], off: [], stopping: none, starting: none, prev: p1 });
    expect(keys(p2)).toEqual(['참모-2:live']);
    expect(p2[0]!.live!.name).toBe('참모-2 · 참모 업데이트');
  });

  it('새로 띄운 참모는 끝에, 지운 참모는 빠진다', () => {
    const p1 = orchRows({ live: [live('a', '참모'), live('b', '참모-2')], off: [], stopping: none, starting: none, prev: [] });
    const p2 = orchRows({ live: [live('a', '참모'), live('d', '참모-4')], off: [], stopping: none, starting: none, prev: p1 });
    expect(keys(p2)).toEqual(['참모:live', '참모-4:live']);
  });

  it('같은 이름이 살아 있으면 꺼진 기록은 안 보인다', () => {
    expect(keys(orchRows({ live: [live('a', '참모-2')], off: [off('z', '참모-2')], stopping: none, starting: none, prev: [] }))).toEqual(['참모-2:live']);
  });
});

describe('arrivedOrch — 새로 만든 참모가 목록에 뜨면 그리로 이동(2026-10-02 사용자)', () => {
  it('진짜 이름이 같은 살아 있는 참모가 뜨면 그 id', () => {
    expect(arrivedOrch('참모-3 · 개발', [live('a', '참모'), live('c', '참모-3 · 개발')])).toBe('c');
  });
  it('아직 안 떴으면 없음, 만드는 중이 아니면 없음', () => {
    expect(arrivedOrch('참모-3 · 개발', [live('a', '참모')])).toBeUndefined();
    expect(arrivedOrch(null, [live('a', '참모')])).toBeUndefined();
  });
  it('기본 이름만 같은 옛 참모(별명이 다른)는 아니다', () => {
    expect(arrivedOrch('참모-3 · 개발', [live('x', '참모-3 · 디자인')])).toBeUndefined();
  });
});

describe('creatingRow — 뜨는 동안 그 자리에 켜는 중 줄', () => {
  it('꺼진 참모 모양으로 만들어 orchRows 의 켜는 중으로 들어간다', () => {
    const c = creatingRow('참모-3 · 개발', '/hq');
    const r = orchRows({ live: [live('a', '참모')], off: [c], stopping: none, starting: new Set([c.sessionId]), prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-3:starting']);
  });
});

describe('orchRows — 줄은 세션으로(기본 이름이 같은 참모 둘이 하나로 합쳐지던 사고, 2026-10-02)', () => {
  it('살아 있는 참모-3 둘은 줄 둘', () => {
    const r = orchRows({ live: [live('n', '참모-3 · 서버 정리'), live('l', '참모-3 · 쇼핑몰 문의')], off: [], stopping: none, starting: none, prev: [] });
    expect(r.map((x) => x.live?.name)).toEqual(['참모-3 · 서버 정리', '참모-3 · 쇼핑몰 문의']);
  });
  it('새로 만든 참모는 켜는 중 줄 자리를 이어받는다', () => {
    const c = creatingRow('참모-6 · 개발', '/hq');
    const p1 = orchRows({ live: [live('a', '참모'), live('b', '참모-2')], off: [c], stopping: none, starting: new Set([c.sessionId]), prev: [] });
    const moved = orchRows({ live: [live('a', '참모'), live('b', '참모-2')], off: [c], stopping: none, starting: new Set([c.sessionId]), prev: [p1[2]!, p1[0]!, p1[1]!] });
    expect(moved.map((x) => x.phase)).toEqual(['starting', 'live', 'live']);
    const p2 = orchRows({ live: [live('a', '참모'), live('b', '참모-2'), live('z', '참모-6 · 개발')], off: [], stopping: none, starting: none, prev: moved });
    expect(p2.map((x) => x.live?.name)).toEqual(['참모-6 · 개발', '참모', '참모-2']);
  });
});

describe('orchRows 고정 — 고정한 참모(대화 id)는 지난 자리보다 먼저, 고정한 순서대로(2026-10-03 사용자)', () => {
  it('고정이 지난 순서를 이긴다, 나머지는 지난 순서 그대로', () => {
    const a = live('a', '참모-1'), b = live('b', '참모-2'), c = off('c', '참모-3');
    const prev = orchRows({ live: [a, b], off: [c], stopping: none, starting: none, prev: [] });
    expect(keys(prev)).toEqual(['참모-1:live', '참모-2:live', '참모-3:off']);
    const pinned = orchRows({ live: [a, b], off: [c], stopping: none, starting: none, prev, pins: ['s-c', 's-b'] });
    expect(keys(pinned)).toEqual(['참모-3:off', '참모-2:live', '참모-1:live']);
    expect(keys(orchRows({ live: [a, b], off: [c], stopping: none, starting: none, prev: pinned, pins: [] }))).toEqual(['참모-3:off', '참모-2:live', '참모-1:live']);
  });
});
