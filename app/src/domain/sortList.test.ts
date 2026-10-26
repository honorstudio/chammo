import { describe, expect, it } from 'vitest';
import { firstDesc, readSortOf, sortList } from './sortList';

describe('목록 정렬(두 보관함 공용)', () => {
  const xs = [{ n: 'b.txt', t: 1, s: 5 }, { n: 'a.txt', t: 3, s: 1 }, { n: 'c.txt', t: 2, s: 9 }];
  const ids = (key: 'name' | 'at' | 'size', desc: boolean) => sortList(xs, { key, desc }, (x) => ({ name: x.n, at: x.t, size: x.s })).map((x) => x.n[0]).join('');
  it('이름·날짜·크기 × 오름/내림', () => {
    expect([ids('name', false), ids('name', true), ids('at', true), ids('size', false)]).toEqual(['abc', 'cba', 'acb', 'abc']);
  });
  it('기준별 처음 방향 — 날짜·크기는 큰 것 먼저', () => {
    expect([firstDesc('at'), firstDesc('size'), firstDesc('name'), firstDesc('by')]).toEqual([true, true, false, false]);
  });
  it('참모 보관함은 올린 사람 기준이 없다 — 기억에 by 가 있으면 기본으로', () => {
    expect(readSortOf(() => '{"key":"by","desc":false}', ['name', 'at', 'size'] as const)).toEqual({ key: 'at', desc: true });
  });
});
