import { describe, expect, it } from 'vitest';
import type { Session } from './session';
import type { StoppedSession } from './stopped';
import { creatingRow } from './orchRows';
import { phaseWord, railMoved, railRows, wakeNotice, type RailRow } from './railRows';

const live = (id: string, name: string): Session => ({ id, name, cwd: '/hq', kind: 'background', state: 'idle', project: 'hq', workspace: null, startedAt: 0, sessionId: `s-${id}` });
const off = (id: string, name: string): StoppedSession => ({ id, sessionId: `s-${id}`, name, cwd: '/hq', project: 'hq', workspace: null, reason: 'done', startedAt: 0 });
const keys = (r: RailRow[]) => r.map((x) => `${x.name.split(' · ')[0]}:${x.phase}`);
const none = new Set<string>();

// 2026-10-12 사용자 "참모가 꺼지고 켜질 때 그냥 뿅 나왔다 뿅 사라진다" — 띠는 바뀌는 동안 그 참모를 자리 그대로 보여 준다
describe('railRows — 띠 위쪽 줄(살아 있는·끄는 중·켜는 중)', () => {
  it('평소: 살아 있는 참모 순서 그대로', () => {
    const r = railRows({ live: [live('a', '참모'), live('b', '참모-2')], stopping: none, starting: [], prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:live']);
  });

  it('끄는 중: 자리 그대로 상태만 끄는 중', () => {
    const r = railRows({ live: [live('a', '참모'), live('b', '참모-2'), live('c', '참모-3')], stopping: new Set(['b']), starting: [], prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:stopping', '참모-3:live']);
  });

  it('깨우는 중: 쉬는 참모가 위 줄로 올라와 켜는 중 — 살아나면 같은 줄(같은 키)이 그대로 살아 있는 참모', () => {
    const p1 = railRows({ live: [live('a', '참모')], stopping: none, starting: [off('b', '참모-2')], prev: [] });
    expect(keys(p1)).toEqual(['참모:live', '참모-2:starting']);
    expect(p1[1]!.waking).toBe(true);
    const p2 = railRows({ live: [live('a', '참모'), live('b', '참모-2')], stopping: none, starting: [], prev: p1 });
    expect(keys(p2)).toEqual(['참모:live', '참모-2:live']);
    expect(p2[1]!.key).toBe(p1[1]!.key);
  });

  it('새로 만드는 참모: 맨 끝에 켜는 중(깨우기 아님)', () => {
    const r = railRows({ live: [live('a', '참모')], stopping: none, starting: [creatingRow('참모-2 · 시험', '/hq')], prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:starting']);
    expect(r[1]!.waking).toBe(false);
  });

  it('살아 있는데 아직 켜는 중 목록에도 남은 찰나 — 한 줄만', () => {
    const r = railRows({ live: [live('a', '참모'), live('b', '참모-2')], stopping: none, starting: [off('b', '참모-2')], prev: [] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:live']);
  });

  it('갱신 사이 찰나(두 목록 어디에도 없지만 아직 켜는 중) — 마지막 모습으로 남긴다', () => {
    const p1 = railRows({ live: [live('a', '참모')], stopping: none, starting: [off('b', '참모-2')], prev: [] });
    const gap = railRows({ live: [live('a', '참모')], stopping: none, starting: [], startingIds: new Set(['s-b']), prev: p1 });
    expect(keys(gap)).toEqual(['참모:live', '참모-2:starting']);
    const done = railRows({ live: [live('a', '참모')], stopping: none, starting: [], prev: gap });
    expect(keys(done)).toEqual(['참모:live']);
  });

  it('끄는 중인데 살아 있는 목록에서 먼저 빠진 찰나 — 끄는 중으로 남긴다', () => {
    const p1 = railRows({ live: [live('a', '참모'), live('b', '참모-2')], stopping: new Set(['b']), starting: [], prev: [] });
    const gap = railRows({ live: [live('a', '참모')], stopping: new Set(['b']), starting: [], prev: p1 });
    expect(keys(gap)).toEqual(['참모:live', '참모-2:stopping']);
  });

  it('켜는 중 줄도 저장한 순서·고정을 따른다(살아나도 자리가 안 튄다)', () => {
    const r = railRows({ live: [live('a', '참모'), live('c', '참모-3')], stopping: none, starting: [off('b', '참모-2')], prev: [], order: ['s-a', 's-b', 's-c'] });
    expect(keys(r)).toEqual(['참모:live', '참모-2:starting', '참모-3:live']);
  });
});

describe('railMoved — 자리 옮김 움직임은 줄이 바뀐 때만(폭 바꾸기·끌기 때는 안 움직인다)', () => {
  it('같은 줄·같은 상태면 false, 상태나 줄이 바뀌면 true', () => {
    expect(railMoved(['a:live', 'r:b'], ['a:live', 'r:b'])).toBe(false);
    expect(railMoved(['a:live', 'b:live'], ['a:live', 'b:stopping'])).toBe(true);
    expect(railMoved(['a:live', 'b:stopping'], ['a:live', 'r:b'])).toBe(true);
  });
});

describe('phaseWord — 호버 카드·넓은 띠의 한 줄', () => {
  it('깨우는 중·켜는 중·끄는 중', () => {
    expect(phaseWord('starting', true)).toBe('깨우는 중…');
    expect(phaseWord('starting', false)).toBe('켜는 중…');
    expect(phaseWord('stopping', false)).toBe('끄는 중…');
    expect(phaseWord('live', false)).toBeUndefined();
  });
});

// 깨우는 동안 채팅은 앞 참모에 남아 있다(뜨면 그리로 넘어간다) — 그사이 친 말이 엉뚱한 참모로 가지 않게 입력칸 위에 한 줄
describe('wakeNotice — 채팅 입력칸 위 한 줄', () => {
  it('깨우는 중·새로 켜는 중', () => {
    expect(wakeNotice('참모-2', true)).toBe('참모-2 깨우는 중… 뜨면 이 채팅이 그리로 넘어가');
    expect(wakeNotice('참모-3 · 시험', false)).toBe('참모-3 · 시험 켜는 중… 뜨면 이 채팅이 그리로 넘어가');
  });
});
