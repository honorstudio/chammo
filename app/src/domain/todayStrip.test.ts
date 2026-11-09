import { describe, expect, it } from 'vitest';
import { codeToday, parseDayCommits } from './replay';
import type { TaskEvent } from './tasks';
import { isCodeDay, nowSlot, todayCard, todayWork } from './todayStrip';

const at = (h: number, m = 0, d = 5) => new Date(2026, 10, d, h, m).toISOString();
const win = { start: new Date(2026, 10, 5, 5).getTime(), end: new Date(2026, 10, 6, 5).getTime() };
const send = (task: string, fromName?: string): TaskEvent => ({ ts: at(4, 0), type: 'send', task, target: 's', fromName });
const done = (task: string, ts: string): TaskEvent => ({ ts, type: 'done', task, note: '끝' });

describe('todayWork — 새벽 5시부터 끝낸 일', () => {
  it('끝낸 일을 시간 칸(5시=0)에 넣고 시킨 참모를 센다', () => {
    const w = todayWork([send('a', '참모-2'), send('b', '참모-2'), send('c', '참모-4'), done('a', at(5, 10)), done('b', at(18)), done('c', at(1, 30, 6))], win);
    expect(w.done).toBe(3);
    expect(w.hours[0]).toBe(1);
    expect(w.hours[13]).toBe(1);
    expect(w.hours[20]).toBe(1);
    expect(w.hours).toHaveLength(24);
    expect(w.people).toBe(2);
  });
  it('어제 끝낸 일과 내일 칸은 안 센다', () => {
    const w = todayWork([done('a', at(4, 59)), done('b', at(5, 0, 6))], win);
    expect(w.done).toBe(0);
    expect(w.hours.every((n) => n === 0)).toBe(true);
  });
  it('같은 일을 다시 닫으면 한 개로, 마지막에 닫은 칸에 센다', () => {
    const w = todayWork([done('a', at(6)), done('a', at(9))], win);
    expect(w.done).toBe(1);
    expect(w.hours[1]).toBe(0);
    expect(w.hours[4]).toBe(1);
  });
  it('넘긴 큰 일(handover)은 쪼갠 일과 겹치니 안 센다', () => {
    const big: TaskEvent = { ts: at(6), type: 'handover', task: 'h-1', target: '디자인', fromName: '참모' };
    const w = todayWork([big, send('a', '참모-2'), done('a', at(7)), done('h-1', at(8))], win);
    expect(w.done).toBe(1);
  });
  it('시킨 기록이 없는 일은 일로 세고 참모로는 안 센다', () => {
    const w = todayWork([done('a', at(7))], win);
    expect(w.done).toBe(1);
    expect(w.people).toBe(0);
  });
  it('시각이 깨진 줄은 건너뛴다', () => {
    expect(todayWork([done('a', 'not-a-date')], win).done).toBe(0);
  });
});

describe('nowSlot', () => {
  it('지금 시간 칸(5시=0), 새벽 1시는 20', () => {
    expect(nowSlot(win, new Date(2026, 10, 5, 5, 30).getTime())).toBe(0);
    expect(nowSlot(win, new Date(2026, 10, 6, 1, 40).getTime())).toBe(20);
  });
});

describe('codeToday — 코드 칸 숫자', () => {
  const raw = ['@@R\trepo-a', '@@C\taaa\t1\tp1\t첫', '10\t2\tsrc/a.ts', '@@C\tbbb\t2\tp1 p2\t머지', '1\t1\tsrc/b.ts', '@@R\trepo-b', '@@C\tccc\t3\tp1\t둘', '5\t0\tsrc/c.ts'].join('\n');
  it('커밋·줄은 머지를 빼고, 머지는 따로 센다', () => {
    expect(codeToday(parseDayCommits(raw))).toEqual({ commits: 2, merges: 1, added: 15, deleted: 2, repos: 2 });
  });
  it('머지만 있는 저장소도 저장소로 센다', () => {
    expect(codeToday(parseDayCommits('@@R\tr\n@@C\tm\t1\tp1 p2\t머지')).repos).toBe(1);
  });
  it('없으면 다 0', () => {
    expect(codeToday([])).toEqual({ commits: 0, merges: 0, added: 0, deleted: 0, repos: 0 });
  });
});

describe('개발자 칸 조건 — git 을 끄면 App 이 커밋을 안 세어 0 이다', () => {
  const zero = { commits: 0, merges: 0, added: 0, deleted: 0, repos: 0 };
  it('커밋이나 머지가 있어야 개발자 칸', () => {
    expect(isCodeDay(zero)).toBe(false);
    expect(isCodeDay({ ...zero, commits: 1 })).toBe(true);
    expect(isCodeDay({ ...zero, merges: 1 })).toBe(true);
  });
});

describe('todayCard — 칸에 무엇을 보이나', () => {
  const w = { done: 29, hours: new Array(24).fill(0), people: 5 };
  const code = { commits: 156, merges: 19, added: 17065, deleted: 2222, repos: 3 };
  const noCode = { commits: 0, merges: 0, added: 0, deleted: 0, repos: 0 };
  it('개발하는 사람 = 끝낸 일·머지·커밋 + 코드 줄, 보관함은 안 본다', () => {
    const c = todayCard(w, code, null);
    expect(c.empty).toBe(false);
    expect(c.stats.map((s) => s.v)).toEqual([29, 19, 156]);
    expect(c.code).toEqual(code);
    expect(c.needsFiles).toBe(false);
  });
  it('개발 안 하는 사람 = 끝낸 일·참모·보관함 파일, 코드 줄 없음', () => {
    const c = todayCard(w, noCode, 4);
    expect(c.stats.map((s) => s.v)).toEqual([29, 5, 4]);
    expect(c.code).toBeNull();
    expect(c.needsFiles).toBe(true);
  });
  it('보관함을 아직 못 읽었으면 0 으로 그린다', () => {
    expect(todayCard(w, noCode, null).stats[2]!.v).toBe(0);
  });
  it('아무것도 없으면 빈 상태', () => {
    expect(todayCard({ ...w, done: 0, people: 0 }, noCode, 0).empty).toBe(true);
    expect(todayCard({ ...w, done: 0, people: 0 }, noCode, null).empty).toBe(true);
  });
  it('끝낸 일이 없어도 커밋이나 파일이 있으면 빈 상태가 아니다', () => {
    expect(todayCard({ ...w, done: 0 }, code, null).empty).toBe(false);
    expect(todayCard({ ...w, done: 0 }, noCode, 2).empty).toBe(false);
  });
});
