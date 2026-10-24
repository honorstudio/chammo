import { describe, expect, it } from 'vitest';
import { homeDash } from './homeDash';
import type { GoalBar, Cell } from './goalBar';
import type { TaskEvent } from './tasks';

const H = 3600_000;
// 로컬 15시 — 하루 경계(새벽 5시)는 로컬 시각 기준
const NOW = new Date(2026, 9, 24, 15, 0).getTime();
const at = (h: number) => new Date(NOW - h * H).toISOString();
const cell = (task: string, state: Cell['state'], o: Partial<Cell> = {}): Cell => ({ task, title: `일 ${task}`, target: 'shop', state, at: NOW - H, ...o });
const bar = (...cells: Cell[]): GoalBar => ({ goals: [{ key: 'g', name: '목표', cells, done: 0, total: cells.length, finished: false, waiting: false, lastAt: NOW }], done: 0, total: cells.length, byProject: false });
const ORCHS = [{ id: 'o1', name: '참모' }, { id: 'o2', name: '참모-2' }];

describe('homeDash — 홈 대시보드 숫자·참모 타일', () => {
  const bars = { o1: bar(cell('a', 'run'), cell('b', 'ask'), cell('c', 'quiet', { at: NOW - 5 * H })), o2: bar(cell('d', 'run'), cell('e', 'run'), cell('f', 'done')) };
  const d = homeDash({ orchs: ORCHS, bars, events: [], asks: 3, running: 4, now: NOW });

  it('참모마다 일하는 칸·답 기다림 칸·오래 조용 칸 수', () => {
    expect(d.tiles).toEqual([{ id: 'o1', run: 1, ask: 1, quiet: 1 }, { id: 'o2', run: 2, ask: 0, quiet: 0 }]);
  });
  it('오래 조용 = 진행 칸의 quiet 칸(누가 맡겼나·어느 세션)', () => {
    expect(d.quiet).toEqual([{ orch: 'o1', task: 'c', title: '일 c', target: 'shop', at: NOW - 5 * H }]);
  });
  it('숫자 넷 — 결정 대기·일하는 세션은 받은 값, 오래 조용·오늘 끝남은 센 값', () => {
    expect(d.counts).toEqual({ asks: 3, running: 4, quiet: 1, doneToday: 0 });
  });
  it('참모가 없으면 빈 칸', () => {
    expect(homeDash({ orchs: [], bars: {}, events: [], asks: 0, running: 0, now: NOW })).toEqual({ counts: { asks: 0, running: 0, quiet: 0, doneToday: 0 }, tiles: [], quiet: [], done: [] });
  });
  it('같은 일이 두 참모 칸에 보여도(넘긴 일) 오래 조용은 한 번', () => {
    const q = cell('x', 'quiet');
    expect(homeDash({ orchs: ORCHS, bars: { o1: bar(q), o2: bar(q) }, events: [], asks: 0, running: 0, now: NOW }).quiet).toHaveLength(1);
  });
});

describe('homeDash — 오늘 끝난 것', () => {
  const ev: TaskEvent[] = [
    { ts: at(6), type: 'send', task: 't1', target: 'shop', title: '결제 단추', from: 'o1' },
    { ts: at(5), type: 'done', task: 't1', note: 'PR #41' },
    { ts: at(4), type: 'send', task: 't2', target: 'recipe', title: '로그인', from: 'o2' },
    { ts: at(1), type: 'done', task: 't2' },
    // 어제 끝난 일 — 새벽 5시 전
    { ts: at(30), type: 'send', task: 't0', target: 'old', title: '어제 일', from: 'o1' },
    { ts: at(20), type: 'done', task: 't0' },
    // 안 끝난 일
    { ts: at(2), type: 'send', task: 't3', target: 'shop', title: '아직', from: 'o1' },
  ];
  const d = homeDash({ orchs: ORCHS, bars: {}, events: ev, asks: 0, running: 0, now: NOW });
  it('오늘(새벽 5시부터) done 만, 최근 먼저, 맡긴 참모·제목·세션은 send 에서', () => {
    expect(d.done).toEqual([
      { task: 't2', title: '로그인', target: 'recipe', orch: 'o2', at: NOW - H },
      { task: 't1', title: '결제 단추', target: 'shop', orch: 'o1', at: NOW - 5 * H },
    ]);
    expect(d.counts.doneToday).toBe(2);
  });
  it('done 이 두 번 찍혀도 한 줄(마지막 때)', () => {
    const twice = homeDash({ orchs: ORCHS, bars: {}, events: [...ev, { ts: at(0.5), type: 'done', task: 't1' }], asks: 0, running: 0, now: NOW });
    expect(twice.done.map((x) => x.task)).toEqual(['t1', 't2']);
  });
  it('모르는 참모가 맡긴 일은 orch 없이', () => {
    const x = homeDash({ orchs: ORCHS, bars: {}, events: [{ ts: at(2), type: 'send', task: 'z', target: 'p', title: '남의 일', from: 'zz' }, { ts: at(1), type: 'done', task: 'z' }], asks: 0, running: 0, now: NOW });
    expect(x.done[0]!.orch).toBeUndefined();
  });
});
