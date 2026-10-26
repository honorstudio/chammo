import { describe, expect, it } from 'vitest';
import { goalBar } from './goalBar';
import { GOAL_OVERDUE_MS, GOAL_STALL_AGAIN_MS, GOAL_STALL_MS, goalStall, pickGoalStall, stallKey, stallText } from './goalStall';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

// 2026-10-26 사용자 "골이 오래 그 상태면 참모가 확인하고 정리하게 해 둔 건가?" — 오래 멈춘 목표를 맡긴 참모 입력칸에 [앱] 한 줄(autoTidy 와 같은 길)
const H = 3600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const orch: Session = { id: 'o1', name: '참모-2 · 개발', cwd: '/hq', kind: 'background', state: 'idle', project: '', workspace: null, startedAt: NOW - 90 * H, sessionId: 'so1' };
const sess = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, cwd: `/dev/${id}`, kind: 'background', state: 'idle', project: id, workspace: null, startedAt: NOW - 90 * H, sessionId: `s-${id}`, ...over });
const send = (task: string, at: number, over: Partial<TaskEvent> = {}): TaskEvent => ({ ts: iso(at), type: 'send', task, target: 'shop-app', from: 'o1', title: '시험판 올리기', goal: '데모 앱 출시', goalTotal: 1, ...over });
const ev = (type: TaskEvent['type'], task: string, at: number, over: Partial<TaskEvent> = {}): TaskEvent => ({ ts: iso(at), type, task, ...over });
const goal = (events: TaskEvent[], now = NOW, sessions = [orch, sess('shop-app')]) => goalBar({ events, sessions, orch, now, seen: new Set() }).goals.find((g) => g.name)!;
const stall = (events: TaskEvent[], now = NOW, sessions?: Session[]) => goalStall(goal(events, now, sessions), now);

describe('goalStall — 오래 멈춘 목표인가', () => {
  it('마지막 움직임에서 24시간이면 조용 — 경계는 24시간 딱', () => {
    expect(stall([send('t1', NOW - GOAL_STALL_MS)])?.kind).toBe('quiet');
    expect(stall([send('t1', NOW - GOAL_STALL_MS + 60_000)])).toBeUndefined();
  });
  it('날짜 없는 기다림도 24시간 그대로면 — 기다림', () => {
    const s = stall([send('t1', NOW - 30 * H), ev('wait', 't1', NOW - GOAL_STALL_MS, { note: '심사', on: 'outside' })]);
    expect(s?.kind).toBe('wait');
    expect(s?.tasks).toEqual(['t1']);
    expect(stall([send('t1', NOW - 30 * H), ev('wait', 't1', NOW - 23 * H, { note: '심사', on: 'outside' })])).toBeUndefined();
  });
  it('wait --until 이 아직이면 며칠 조용해도 안 알린다, 지나고 1시간이면 날짜 지남', () => {
    const until = NOW - GOAL_OVERDUE_MS;
    const events = [send('t1', NOW - 80 * H), ev('wait', 't1', NOW - 79 * H, { note: '심사', on: 'outside', until: iso(until) })];
    expect(stall(events, until - 60_000)).toBeUndefined();
    expect(stall(events, NOW - 60_000)).toBeUndefined(); // 지나고 59분
    expect(stall(events)?.kind).toBe('overdue');
  });
  it('날짜가 지난 뒤 기척(메모)이 있으면 날짜 지남이 아니다 — 그때부터 24시간을 센다', () => {
    const until = NOW - 10 * H;
    const events = [send('t1', NOW - 80 * H), ev('wait', 't1', NOW - 79 * H, { note: '심사', until: iso(until) }), ev('note', 't1', NOW - 9 * H, { note: '아직 심사 중' })];
    expect(stall(events)).toBeUndefined();
  });
  it('일하는 중 칸이 하나라도 있으면 · 사람 답 기다림만 남았으면 · 끝났으면 안 알린다', () => {
    expect(stall([send('t1', NOW - 30 * H)], NOW, [orch, sess('shop-app', { state: 'working' })])).toBeUndefined();
    expect(stall([send('t1', NOW - 30 * H), ev('ask', 't1', NOW - 29 * H)])).toBeUndefined();
    expect(stall([send('t1', NOW - 30 * H), ev('done', 't1', NOW - H)])).toBeUndefined(); // 끝난 목표(진행 칸에 아직 남은 것)
  });
  it('목표 이름표 없는 일(기타·프로젝트 줄)은 목표가 아니다', () => {
    const g = goal([send('t1', NOW - 30 * H)]);
    expect(goalStall(g, NOW)).toBeDefined();
    expect(goalStall({ ...g, name: '', label: 'shop-app' }, NOW)).toBeUndefined();
  });
});

describe('pickGoalStall — 같은 목표엔 하루 한 번, 참모가 쉴 때', () => {
  const events = [send('t1', NOW - 30 * H)];
  const sessions = [orch, sess('shop-app')];
  it('알릴 참모와 목표 — 열쇠는 참모 기본 이름 + 목표 이름(되살아나 id 가 바뀌어도 같다)', () => {
    const p = pickGoalStall([orch], { events, sessions, now: NOW, last: new Map() });
    expect(p?.orch.id).toBe('o1');
    expect(p?.key).toBe(stallKey(orch, '데모 앱 출시'));
    expect(p?.key).toBe('참모-2|데모 앱 출시');
  });
  it('마지막으로 알린 지 하루가 안 됐으면 건너뛰고, 하루면 다시', () => {
    const key = stallKey(orch, '데모 앱 출시');
    expect(pickGoalStall([orch], { events, sessions, now: NOW, last: new Map([[key, NOW - GOAL_STALL_AGAIN_MS + 60_000]]) })).toBeUndefined();
    expect(pickGoalStall([orch], { events, sessions, now: NOW, last: new Map([[key, NOW - GOAL_STALL_AGAIN_MS]]) })).toBeDefined();
  });
  it('참모가 일하는 중이면 이번엔 건너뛴다(조건은 남아 다음에 다시)', () => {
    expect(pickGoalStall([{ ...orch, state: 'working' }], { events, sessions, now: NOW, last: new Map() })).toBeUndefined();
  });
});

describe('stallText — 참모 입력칸 한 줄', () => {
  it('[앱] 오래 멈춘 목표: 이름 — 조각 n/m · 마지막 언제 · 무엇 · 일 id + 할 일', () => {
    const until = NOW - 2 * H;
    const g = goal([send('t1', NOW - 80 * H), ev('wait', 't1', NOW - 79 * H, { note: '심사', until: iso(until) })]);
    const t = stallText(goalStall(g, NOW)!, NOW);
    expect(t).toMatch(/^\[앱\] 오래 멈춘 목표: 데모 앱 출시 — 조각 0\/1 · 마지막 2시간 전 · 기다린 날짜 지남 · 일 t1\. /);
    expect(t).toMatch(/done·goal-done/);
    expect(t).toMatch(/wait --until/);
    expect(t).not.toMatch(/\n/);
  });
});
