import { describe, expect, it } from 'vitest';
import { fitRows, homeProjects, readFold, toggleFold, writeFold } from './homeProjects';
import type { Session } from './session';
import type { ActivityStatus } from './status';
import type { TaskEvent } from './tasks';

const H = 3600_000;
// 로컬 15시 — 하루 경계(새벽 5시)는 로컬 시각 기준
const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const at = (h: number) => new Date(NOW - h * H).toISOString();
const ses = (id: string, project: string, o: Partial<Session> = {}): Session => ({ id, name: id, cwd: `/dev/${project}`, kind: 'background', state: 'idle', project, workspace: null, startedAt: NOW - 10 * H, ...o });
const send = (task: string, target: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent => ({ ts: at(h), type: 'send', task, target, title: `일 ${task}`, from: 'o1', ...o });
const ev = (type: TaskEvent['type'], task: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent => ({ ts: at(h), type, task, ...o });

const run = (o: { groups: { name: string; sessions: Session[] }[]; events?: TaskEvent[]; status?: Record<string, ActivityStatus>; sessions?: Session[] }) =>
  homeProjects({ groups: o.groups, sessions: o.sessions ?? o.groups.flatMap((g) => g.sessions), events: o.events ?? [], orchIds: ['o1', 'o2'], statusOf: (s) => o.status?.[s.id] ?? 'idle', now: NOW });

describe('homeProjects — 홈에 올리는 프로젝트(활성 기준)', () => {
  it('살아 있는 세션이 있으면 올린다(맡긴 일이 없어도)', () => {
    const r = run({ groups: [{ name: 'shop', sessions: [ses('s1', 'shop')] }] });
    expect(r.live.map((p) => p.name)).toEqual(['shop']);
    expect(r.live[0]!.state).toBe('rest');
  });
  it('세션이 꺼졌어도 24시간 안에 맡긴 일이 있으면 올린다', () => {
    const r = run({ groups: [], events: [send('t1', 'recipe', 3, { project: 'recipe' })] });
    expect(r.live.map((p) => p.name)).toEqual(['recipe']);
  });
  it('24시간 넘게 기척 없는 일만 있으면 안 올린다', () => {
    const r = run({ groups: [], events: [send('t1', 'recipe', 30, { project: 'recipe' })] });
    expect(r.live).toEqual([]);
    expect(r.done).toEqual([]);
  });
  it('오래된 일이어도 안 풀린 기다림(심사·날짜)이 있으면 올린다', () => {
    const until = new Date(NOW + 48 * H).toISOString();
    const r = run({ groups: [], events: [send('t1', 'app', 40, { project: 'app' }), ev('wait', 't1', 39, { note: '심사 대기', until })] });
    expect(r.live[0]).toMatchObject({ name: 'app', state: 'wait', until: NOW + 48 * H });
  });
  it('오래된 일이어도 답을 기다리는 물음은 올린다', () => {
    const r = run({ groups: [], events: [send('t1', 'pay', 30, { project: 'pay' }), ev('ask', 't1', 29)] });
    expect(r.live[0]).toMatchObject({ name: 'pay', state: 'ask' });
  });
  it('세션 대상이 프로젝트 밖(참모·도우미 — 묶음에 없는 세션)이면 뺀다', () => {
    const helper = ses('sns', 'hq');
    const r = run({ groups: [], sessions: [helper], events: [send('t1', 'sns', 1)] });
    expect(r.live).toEqual([]);
  });
  it('같은 프로젝트의 세션 둘(워크트리)은 한 줄, 세션은 다 붙는다', () => {
    const r = run({ groups: [{ name: 'orch', sessions: [ses('a', 'orch', { workspace: 'fix-a' }), ses('b', 'orch', { workspace: 'fix-b' })] }] });
    expect(r.live).toHaveLength(1);
    expect(r.live[0]!.sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('맡은 참모 = 그 프로젝트에 일을 보낸 이 맥 참모(겹치지 않게)', () => {
    const r = run({ groups: [], events: [send('t1', 'x', 2, { project: 'x' }), send('t2', 'x', 1, { project: 'x', from: 'o2' }), send('t3', 'x', 1.5, { project: 'x' }), send('t4', 'x', 1, { project: 'x', from: 'zz' })] });
    expect(r.live[0]!.orchs).toEqual(['o2', 'o1']);
  });
});

describe('homeProjects — 프로젝트 상태 = 가장 급한 하나', () => {
  it('막힘(로그인·선택지 창) > 답 기다림 > 오래 조용 > 일하는 중 > 기다림 > 쉼', () => {
    const groups = [
      { name: 'p-run', sessions: [ses('r', 'p-run')] },
      { name: 'p-stop', sessions: [ses('s', 'p-stop')] },
      { name: 'p-ask', sessions: [ses('k', 'p-ask')] },
      { name: 'p-rest', sessions: [ses('z', 'p-rest')] },
      { name: 'p-quiet', sessions: [ses('q', 'p-quiet')] },
      { name: 'p-wait', sessions: [ses('w', 'p-wait')] },
    ];
    const events = [
      send('t1', 'k', 1), ev('ask', 't1', 0.5),
      send('t2', 's', 1),
      send('t3', 'q', 5),
      send('t4', 'w', 2), ev('wait', 't4', 1, { note: '심사' }),
    ];
    const r = run({ groups, events, status: { r: 'working', s: 'blocked' } });
    expect(r.live.map((p) => [p.name, p.state])).toEqual([['p-stop', 'stop'], ['p-ask', 'ask'], ['p-quiet', 'quiet'], ['p-run', 'run'], ['p-wait', 'wait'], ['p-rest', 'rest']]);
  });
  it('세션이 일하는 중이어도 물음이 걸린 일이 있으면 답 기다림', () => {
    const r = run({ groups: [{ name: 'p', sessions: [ses('a', 'p')] }], events: [send('t1', 'a', 1), ev('ask', 't1', 0.5)], status: { a: 'working' } });
    expect(r.live[0]!.state).toBe('ask');
  });
  it('지금 하는 일 한 줄 = 가장 급한 안 끝난 일의 제목', () => {
    const r = run({ groups: [{ name: 'p', sessions: [ses('a', 'p')] }], events: [send('t1', 'a', 2, { title: '로그인 화면' }), send('t2', 'a', 1, { title: '결제 문구' }), ev('ask', 't2', 0.5)], status: { a: 'working' } });
    expect(r.live[0]!.line).toBe('결제 문구');
  });
  it('일이 없으면 세션의 지금 줄(lineOf), 그것도 없으면 빈 줄', () => {
    const s = ses('a', 'p');
    const r = homeProjects({ groups: [{ name: 'p', sessions: [s] }], sessions: [s], events: [], orchIds: [], statusOf: () => 'working', lineOf: () => 'Edit App.tsx', now: NOW });
    expect(r.live[0]).toMatchObject({ state: 'run', line: 'Edit App.tsx' });
  });
  it('오늘 맡긴 일이 다 끝나고 세션이 쉬면 오늘 끝남으로 따로', () => {
    const r = run({ groups: [{ name: 'p', sessions: [ses('a', 'p')] }], events: [send('t1', 'a', 3, { title: '푸시 문구' }), ev('done', 't1', 2, { note: 'PR #41' })] });
    expect(r.live).toEqual([]);
    expect(r.done[0]).toMatchObject({ name: 'p', state: 'done', line: '푸시 문구', at: NOW - 2 * H });
  });
  it('끝난 일만 있어도 세션이 일하는 중이면 살아 있는 줄', () => {
    const r = run({ groups: [{ name: 'p', sessions: [ses('a', 'p')] }], events: [send('t1', 'a', 3), ev('done', 't1', 2)], status: { a: 'working' } });
    expect(r.live[0]!.state).toBe('run');
  });
  it('어제 끝난 일은 오늘 끝남에 안 든다', () => {
    const r = run({ groups: [], events: [send('t1', 'x', 23, { project: 'x' }), ev('done', 't1', 22)] });
    expect(r.done).toEqual([]);
  });
  it('같은 상태끼리는 최근 기척 먼저', () => {
    const r = run({ groups: [{ name: 'a', sessions: [ses('a', 'a')] }, { name: 'b', sessions: [ses('b', 'b')] }], events: [send('t1', 'a', 2), send('t2', 'b', 1)], status: { a: 'working', b: 'working' } });
    expect(r.live.map((p) => p.name)).toEqual(['b', 'a']);
  });
  it('줄의 맡긴 일 목록 — 급한 순, 끝난 건 뒤', () => {
    const r = run({ groups: [{ name: 'p', sessions: [ses('a', 'p', { state: 'working' })] }], events: [send('t1', 'a', 3), ev('done', 't1', 2.5), send('t2', 'a', 2), send('t3', 'a', 1), ev('ask', 't3', 0.5)], status: { a: 'working' } });
    expect(r.live[0]!.tasks.map((t) => [t.task, t.state])).toEqual([['t3', 'ask'], ['t2', 'run'], ['t1', 'done']]);
  });
});

describe('homeProjects — 접힘 기억', () => {
  it('빈 값·깨진 값이면 다 접힌 기본(목록은 펼침)', () => {
    expect(readFold(null)).toEqual({ list: true, open: [], more: false });
    expect(readFold('{깨짐')).toEqual({ list: true, open: [], more: false });
    expect(readFold('{"list":"x","open":[1,"a"]}')).toEqual({ list: true, open: ['a'], more: false });
  });
  it('줄 펼치기·다시 접기', () => {
    const a = toggleFold(readFold(null), { row: 'shop' });
    expect(a.open).toEqual(['shop']);
    expect(toggleFold(a, { row: 'shop' }).open).toEqual([]);
  });
  it('목록 전체 접기·펼치기, +N 더 펼치기', () => {
    const f = readFold(null);
    expect(toggleFold(f, { list: true }).list).toBe(false);
    expect(toggleFold(f, { more: true }).more).toBe(true);
  });
  it('써 두고 다시 읽으면 같은 값(기억)', () => {
    const f = toggleFold(toggleFold(toggleFold(readFold(null), { row: 'a' }), { row: 'b' }), { list: true });
    expect(readFold(writeFold(f))).toEqual(f);
  });
  it('펼친 줄은 최근 30개까지만 기억', () => {
    let f = readFold(null);
    for (let i = 0; i < 40; i++) f = toggleFold(f, { row: `p${i}` });
    expect(f.open).toHaveLength(30);
    expect(f.open[29]).toBe('p39');
  });
});

describe('fitRows — 창 높이에 맞춰 몇 줄 보일까', () => {
  it('다 들어가면 다 보이고 더 없음', () => {
    expect(fitRows({ avail: 300, rowH: 44, n: 5 })).toEqual({ shown: 5, more: 0 });
  });
  it('넘치면 마지막 자리를 "+N개 더"에 내준다', () => {
    // 300/44 = 6줄 자리 → 5줄 + '+5개 더'
    expect(fitRows({ avail: 300, rowH: 44, n: 10 })).toEqual({ shown: 5, more: 5 });
  });
  it('"+N개 더" 단추 자리는 그 단추 높이만큼(moreH)', () => {
    // 176 - 40 = 136 → 3줄 + '+7개 더'
    expect(fitRows({ avail: 176, rowH: 45, moreH: 40, n: 10 })).toEqual({ shown: 3, more: 7 });
  });
  it('딱 맞으면 더 없음', () => {
    expect(fitRows({ avail: 264, rowH: 44, n: 6 })).toEqual({ shown: 6, more: 0 });
  });
  it('자리가 거의 없어도 한 줄은 보인다', () => {
    expect(fitRows({ avail: 20, rowH: 44, n: 4 })).toEqual({ shown: 1, more: 3 });
  });
  it('아직 못 쟀으면(0) 다 보인다', () => {
    expect(fitRows({ avail: 0, rowH: 44, n: 4 })).toEqual({ shown: 4, more: 0 });
  });
  it('줄이 없으면 0', () => {
    expect(fitRows({ avail: 300, rowH: 44, n: 0 })).toEqual({ shown: 0, more: 0 });
  });
});
