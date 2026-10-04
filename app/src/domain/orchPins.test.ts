import { describe, expect, it } from 'vitest';
import { parsePins, pinFirst } from './orchPins';

describe('참모 고정 — 고정한 것 먼저(고정한 순서대로), 나머지는 원래 순서(2026-10-03 사용자)', () => {
  const o = (id: string, sid?: string) => ({ id, sessionId: sid });
  it('고정 순서대로 위, 나머지는 그대로', () => {
    const list = [o('a', 'A'), o('b', 'B'), o('c', 'C'), o('d')];
    expect(pinFirst(list, ['C', 'A'], (x) => x.sessionId).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('고정이 없거나 없는 대화 id 면 그대로(같은 배열)', () => {
    const list = [o('a', 'A'), o('b', 'B')];
    expect(pinFirst(list, [], (x) => x.sessionId)).toBe(list);
    expect(pinFirst(list, ['Z'], (x) => x.sessionId).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('parsePins — 문자열 배열만', () => {
    expect(parsePins('["A","B"]')).toEqual(['A', 'B']);
    expect(parsePins('{"x":1}')).toEqual([]);
    expect(parsePins('[1,"A"]')).toEqual(['A']);
    expect(parsePins('깨짐')).toEqual([]);
  });
});
