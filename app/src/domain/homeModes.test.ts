import { describe, expect, it } from 'vitest';
import { modeLayout, openInTurn, pickDiff, pickGroups } from './homeModes';
import { lkPick, parseLkPick } from './lockerTree';

// 홈·모드 v1 정할 것 2·3(사용자 10/11 "추천대로") — 홈 가운데 = 모드 칸(아래 세션 줄만 뺀 전부). 1 넓게 · 2 반반 · 3+ 하나 크게 + 옆 쌓기(셋까지, 넘치면 +N)
describe('modeLayout — 모드 칸 배치', () => {
  it('0개 = 빈 칸(맛보기), 1개 = 넓게, 2개 = 반반', () => {
    expect(modeLayout([])).toEqual({ kind: 'none' });
    expect(modeLayout(['cal'])).toEqual({ kind: 'one', big: 'cal' });
    expect(modeLayout(['cal', 'board'])).toEqual({ kind: 'two', items: ['cal', 'board'] });
  });
  it('3개부터 하나 크게 + 옆에 셋까지, 넘치면 알약', () => {
    expect(modeLayout(['a', 'b', 'c'])).toEqual({ kind: 'big', big: 'a', side: ['b', 'c'], more: [] });
    expect(modeLayout(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({ kind: 'big', big: 'a', side: ['b', 'c', 'd'], more: ['e', 'f'] });
  });
  it('크게 고른 것이 큰 자리 — 없으면(꺼졌으면) 맨 앞', () => {
    expect(modeLayout(['a', 'b', 'c'], 'c')).toEqual({ kind: 'big', big: 'c', side: ['a', 'b'], more: [] });
    expect(modeLayout(['a', 'b', 'c'], 'x')).toEqual({ kind: 'big', big: 'a', side: ['b', 'c'], more: [] });
    expect(modeLayout(['a', 'b'], 'b')).toEqual({ kind: 'two', items: ['b', 'a'] });
  });
});

describe('홈 자리(pick)', () => {
  it('l:<참모>#h = 홈', () => {
    expect(lkPick('o1', { kind: 'home' })).toBe('l:o1#h');
    expect(parseLkPick('l:o1#h')).toEqual({ orch: 'o1', place: { kind: 'home' } });
  });
});

// '셋 다 켜 보기'(10/12) — 한꺼번에 쏘면 Rust 기억이 겹쳐 하나만 켜졌다. 하나씩 차례로, 실패는 삼키지 않고 돌려준다
describe('openInTurn — 모드 여럿 차례로 켜기', () => {
  it('앞의 것이 끝나야 다음 것을 켠다(동시에 하나만)', async () => {
    let busy = 0, peak = 0;
    const order: string[] = [];
    const open = async (n: string) => { busy++; peak = Math.max(peak, busy); await new Promise((r) => setTimeout(r, 5)); order.push(n); busy--; };
    expect(await openInTurn(['a', 'b', 'c'], open)).toEqual([]);
    expect(peak).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
  it('하나가 실패해도 나머지는 켜고, 실패한 것은 이름·까닭으로 돌려준다', async () => {
    const opened: string[] = [];
    const open = async (n: string) => { if (n === 'b') throw 'no such mode: b'; opened.push(n); };
    expect(await openInTurn(['a', 'b', 'c'], open)).toEqual([{ name: 'b', error: 'no such mode: b' }]);
    expect(opened).toEqual(['a', 'c']);
  });
});

// 모드 고르기(10/12 사용자) — 내가 만든 것도 고르고, 여러 개 골라 켜고, 체크 빼면 이 홈에서 끈다
describe('pickGroups — 고르기 목록', () => {
  const t = (n: string) => ({ 'home-calendar': '달력', 'home-board': '현황판', 'home-todo': '할 일', 'team-status': '참모 상태' })[n] ?? n;
  const row = (name: string, source: string, on = false, where = 'window', dash: string | null = null) => ({ name, title: name.toUpperCase(), source, on, where, dash });
  it('내가 만든 것(folder·added·plugin)이 위, 예시 셋이 아래 — 맛보기 셋 밖의 예시는 빠진다', () => {
    const g = pickGroups([row('home-todo', 'example'), row('zeta-mode', 'added'), row('counter', 'example'), row('alpha', 'folder'), row('plug', 'plugin'), row('home-calendar', 'example'), row('home-board', 'example')], ['오렌지'], t);
    expect(g.own.map((x) => x.name)).toEqual(['alpha', 'plug', 'zeta-mode']);
    expect(g.examples.map((x) => [x.name, x.title, x.example])).toEqual([['home-calendar', '달력', true], ['home-board', '현황판', true], ['home-todo', '할 일', true], ['team-status', '참모 상태', true]]);
  });
  it('이 홈에 켜진 것 = here, 다른 자리에 켜진 것 = elsewhere(고르면 옮겨 온다)', () => {
    const g = pickGroups([
      row('a', 'added', true, 'dash', '오렌지'), row('b', 'added', true, 'dash', '레몬'), row('c', 'added', true, 'window'), row('d', 'added', false, 'dash', '오렌지'),
    ], ['오렌지', 'o-1'], t);
    const by = Object.fromEntries(g.own.map((x) => [x.name, [x.here, x.elsewhere]]));
    expect(by.a).toEqual([true, null]);
    expect(by.b).toEqual([false, { where: 'dash', dash: '레몬' }]);
    expect(by.c).toEqual([false, { where: 'window', dash: null }]);
    expect(by.d).toEqual([false, null]);
  });
  it('숨긴 모드는 고르기 목록에서 빠진다 — 숨긴 맛보기는 이름만으로도 안 낸다', () => {
    const hid = (r: ReturnType<typeof row>) => ({ ...r, hidden: true });
    const g = pickGroups([row('home-calendar', 'example'), hid(row('home-board', 'example')), row('home-todo', 'example'), hid(row('plug', 'plugin')), row('memo', 'folder')], ['오렌지'], t);
    expect(g.own.map((x) => x.name)).toEqual(['memo']);
    expect(g.examples.map((x) => x.name)).toEqual(['home-calendar', 'home-todo', 'team-status']); // 목록에 없는 맛보기(team-status)는 이름으로 — 숨긴 것만 뺀다
  });
  it('목록을 아직 못 읽었으면 예시 셋만 이름으로', () => {
    const g = pickGroups([], ['오렌지'], t);
    expect(g.own).toEqual([]);
    expect(g.examples.map((x) => [x.name, x.here])).toEqual([['home-calendar', false], ['home-board', false], ['home-todo', false], ['team-status', false]]);
  });
});

describe('pickDiff — 켤 것·끌 것', () => {
  it('새로 고른 것은 고른 순서로 켜고, 체크 뺀 것은 끈다', () => {
    expect(pickDiff(['a', 'b'], ['c', 'a', 'd'])).toEqual({ open: ['c', 'd'], close: ['b'] });
    expect(pickDiff([], ['x'])).toEqual({ open: ['x'], close: [] });
    expect(pickDiff(['x'], ['x'])).toEqual({ open: [], close: [] });
  });
});
