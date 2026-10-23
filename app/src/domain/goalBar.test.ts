import { describe, expect, it } from 'vitest';
import { cellState, goalBar, prResult, type CellFacts } from './goalBar';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

const H = 3600_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
const at = (h: number) => new Date(NOW - h * H).toISOString();
const sess = (name: string, o: Partial<Session> = {}): Session => ({
  id: name.slice(0, 8), name, cwd: `/d/${o.project ?? 'honor'}`, kind: 'background', state: 'idle', project: 'honor', workspace: null, startedAt: 0, ...o,
});
const facts = (o: Partial<CellFacts> = {}): CellFacts => ({ finished: false, replied: false, asks: 0, answers: 0, lastAt: NOW - 10 * 60_000, notes: [], ...o });

describe('cellState — 칸 상태 8가지(위에서 먼저 맞는 것)', () => {
  const live = sess('web');
  it('1 done 이 찍히면 끝 — 세션이 일하는 중이어도', () => {
    expect(cellState(facts({ finished: true }), sess('web', { state: 'working' }), NOW)).toBe('done');
  });
  it('2 ask 에 답이 아직 없으면 답 기다림 — 답이 오면 풀린다', () => {
    expect(cellState(facts({ asks: 1 }), live, NOW)).toBe('ask');
    expect(cellState(facts({ asks: 1, answers: 1 }), live, NOW)).not.toBe('ask');
  });
  it('3 회신이 왔고 세션이 꺼졌거나 할 일을 끝낸 상태면 앱이 닫음', () => {
    expect(cellState(facts({ replied: true }), undefined, NOW)).toBe('auto');
    expect(cellState(facts({ replied: true }), sess('web', { finished: true }), NOW)).toBe('auto');
  });
  it('4 회신에 적힌 PR 이 머지됐으면 앱이 닫음', () => {
    const f = facts({ replied: true, notes: ['PR #812 올렸어'] });
    expect(cellState(f, live, NOW, new Set(['812']))).toBe('auto');
    expect(cellState(f, live, NOW, new Set(['811']))).toBe('rest');
  });
  it('5 세션이 일하는 중이면 일하는 중 — 오래됐어도', () => {
    expect(cellState(facts({ lastAt: NOW - 9 * H }), sess('web', { state: 'working' }), NOW)).toBe('run');
  });
  it('6 3시간 넘게 기척이 없으면 오래 조용', () => {
    expect(cellState(facts({ lastAt: NOW - 3 * H - 1 }), live, NOW)).toBe('quiet');
    expect(cellState(facts({ lastAt: NOW - 3 * H + 60_000 }), live, NOW)).toBe('rest');
  });
  it('7 세션이 답 없이 꺼지면 멈춤', () => {
    expect(cellState(facts(), undefined, NOW)).toBe('stop');
  });
  it('8 나머지는 쉬는 중', () => {
    expect(cellState(facts({ replied: true }), live, NOW)).toBe('rest');
  });
});

describe('prResult — 끝난 조각에 붙는 결과 한 줄', () => {
  it('PR 번호·주소를 뽑는다', () => {
    expect(prResult('main 머지, PR #12·#13, 운영 https://acme-shop.example 200')).toBe('#12 · #13 · https://acme-shop.example');
  });
  it('없으면 메모 첫 줄을 짧게', () => {
    expect(prResult('시험 초록, 캡처 .shots/locker-tabs/\n둘째 줄')).toBe('시험 초록, 캡처 .shots/locker-tabs/');
    expect(prResult(undefined)).toBe('');
  });
});

// 참모-2 가 보낸 일들 — 목표 둘 + 이름표 없는 일
const ORCH = { id: 'o2', name: '참모-2 · 참모 업데이트' };
const send = (task: string, target: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent => ({ ts: at(h), type: 'send', task, target, title: task, from: 'o2', ...o });
const done = (task: string, h: number, note = '끝'): TaskEvent => ({ ts: at(h), type: 'done', task, note });

describe('goalBar — 목표 묶기', () => {
  it('--goal 이 같은 일은 한 조각, 예정 칸 수가 있으면 남은 칸은 아직 안 보냄', () => {
    const events = [
      send('m1', 'relay', 2, { goal: '참모 메신저', goalTotal: 10 }),
      send('h1', 'pay', 5, { goal: '0.3.12 핫픽스' }), done('h1', 4),
      send('h2', 'hangul', 3, { goal: '0.3.12 핫픽스' }),
      send('x1', 'tabs', 1),
    ];
    const b = goalBar({ events, sessions: [sess('relay', { state: 'working' }), sess('hangul'), sess('tabs')], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals.map((g) => [g.name, g.cells.map((c) => c.state).join(','), g.done, g.total])).toEqual([
      ['0.3.12 핫픽스', 'done,rest', 1, 2],
      ['참모 메신저', 'run,todo,todo,todo,todo,todo,todo,todo,todo,todo', 0, 10],
      ['', 'rest', 0, 1],
    ]);
    expect([b.done, b.total]).toEqual([1, 13]);
  });

  it('다른 참모의 일·7일 지난 일은 안 넣는다 — 되살아나 id 가 바뀌어도 기본 이름(fromName)으로 내 일', () => {
    const events = [
      send('a', 'web', 1, { from: 'old-id', fromName: '참모-2' }),
      send('b', 'web', 1, { from: 'o5', fromName: '참모-5' }),
      send('c', 'web', 24 * 8),
    ];
    const b = goalBar({ events, sessions: [sess('web')], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals.flatMap((g) => g.cells.map((c) => c.task))).toEqual(['a']);
  });

  it('사용자가 나중에 붙인 주인(own)도 따른다', () => {
    const events = [send('a', 'web', 1, { from: undefined }), { ts: at(0.5), type: 'own', task: 'a', from: 'o2' } as TaskEvent];
    expect(goalBar({ events, sessions: [sess('web')], orch: ORCH, now: NOW, seen: new Set() }).goals).toHaveLength(1);
  });

  it('프로젝트를 둘 이상 맡은 참모는 프로젝트로 묶는다 — 목표는 쪼개지 않고 첫 일의 프로젝트 밑, 기타는 프로젝트마다', () => {
    const events = [
      send('a', 'blog', 2, { project: 'pixel-blog', goal: '출시' }),
      send('b', 'api', 2, { project: 'todo-api' }),
      send('c', 'api-2', 1, { goal: '출시' }),
    ];
    const b = goalBar({ events, sessions: [sess('blog'), sess('api'), sess('api-2', { project: 'todo-api' }), sess('etc-x', { project: 'x' })], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.byProject).toBe(true);
    expect(b.goals.map((g) => [g.project, g.name, g.cells.length])).toEqual([
      ['pixel-blog', '출시', 2], ['todo-api', '', 1],
    ]);
  });

  it('한 프로젝트만 맡았으면 프로젝트로 안 묶는다', () => {
    const b = goalBar({ events: [send('a', 'web', 1, { project: 'shop' })], sessions: [sess('web')], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.byProject).toBe(false);
  });

  it('세션 할 일 목록 비율은 일하는 중 칸 채움으로만 — 숫자엔 안 들어간다', () => {
    const b = goalBar({ events: [send('a', 'web', 1)], sessions: [sess('web', { state: 'working' })], orch: ORCH, now: NOW, seen: new Set(), fill: () => 0.375 });
    expect(b.goals[0]!.cells[0]).toMatchObject({ state: 'run', fill: 0.375 });
    expect(b.done).toBe(0);
  });
});

describe('goalBar — 끝난 조각이 사라지는 규칙', () => {
  const finished = (name: string, endH: number, n: string): TaskEvent[] => [send(`${n}`, `s-${n}`, endH + 1, { goal: name }), done(n, endH, `PR #${n.replace(/\D/g, '') || '1'}`)];
  const sessions = ['s-1', 's-2', 's-3', 's-4', 's-5', 's-x'].map((n) => sess(n));

  it('끝난 목표는 꽉 찬 조각 + 결과 한 줄로 남는다', () => {
    const b = goalBar({ events: finished('핫픽스', 1, '701'), sessions, orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals[0]).toMatchObject({ name: '핫픽스', finished: true, result: '#701', done: 1, total: 1 });
    expect(b.goals[0]!.unit).toBeTruthy();
  });

  it('예정 칸 수를 못 채웠으면 끝이 아니다', () => {
    const events = [send('1', 's-1', 3, { goal: 'm', goalTotal: 3 }), done('1', 2)];
    expect(goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() }).goals[0]!.finished).toBe(false);
  });

  it('한 번 봤으면 사라진다', () => {
    const events = finished('핫픽스', 1, '701');
    const first = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() });
    const b = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set([first.goals[0]!.unit!]) });
    expect(b.goals).toEqual([]);
  });

  it('같은 목표에 새 일이 오면 다시 열리고, 그게 끝나면 새로 한 번 보인다', () => {
    const events = finished('핫픽스', 5, '701');
    const u1 = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() }).goals[0]!.unit!;
    const more = [...events, send('702', 's-2', 3, { goal: '핫픽스' })];
    const open = goalBar({ events: more, sessions, orch: ORCH, now: NOW, seen: new Set([u1]) });
    expect(open.goals[0]).toMatchObject({ finished: false, done: 1, total: 2 });
    const again = goalBar({ events: [...more, done('702', 1, 'PR #702')], sessions, orch: ORCH, now: NOW, seen: new Set([u1]) });
    expect(again.goals[0]).toMatchObject({ finished: true, result: '#702' });
  });

  it('안 봐도 쌓이지 않게 — 끝난 조각은 최근 3개까지만', () => {
    const events = [...finished('a', 5, '1'), ...finished('b', 4, '2'), ...finished('c', 3, '3'), ...finished('d', 2, '4'), send('x', 's-x', 1, { goal: '도는 중' })];
    const b = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals.map((g) => g.name)).toEqual(['b', 'c', 'd', '도는 중']);
  });

  it('끝난 지 하루 지난 조각도 빠진다', () => {
    const events = [...finished('어제', 25, '1'), ...finished('오늘', 2, '2')];
    expect(goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() }).goals.map((g) => g.name)).toEqual(['오늘']);
  });

  it('이름표 없는 일은 끝난 칸 하나하나가 같은 규칙 — 열린 칸은 남고 본 칸만 빠진다', () => {
    const events = [send('a', 's-1', 3), done('a', 2, 'PR #9'), send('b', 's-2', 1)];
    const first = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() });
    const etc = first.goals[0]!;
    expect(etc.cells.map((c) => [c.task, c.state])).toEqual([['a', 'done'], ['b', 'rest']]);
    expect(etc.cells[0]!.unit).toBeTruthy();
    const b = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set([etc.cells[0]!.unit!]) });
    expect(b.goals[0]!.cells.map((c) => c.task)).toEqual(['b']);
  });

  it('이름표 없는 일이 다 끝나 다 봤으면 기타 조각도 없다', () => {
    const events = [send('a', 's-1', 3), done('a', 2)];
    const u = goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set() }).goals[0]!.cells[0]!.unit!;
    expect(goalBar({ events, sessions, orch: ORCH, now: NOW, seen: new Set([u]) }).goals).toEqual([]);
  });

  it('앱이 닫은 칸(회신+세션 꺼짐)도 끝으로 센다 — 목표가 끝나고 사라질 수 있다', () => {
    const events: TaskEvent[] = [send('a', 'gone', 3, { goal: 'g' }), { ts: at(2), type: 'reply', task: 'a', note: 'PR #55 올렸어' }];
    const b = goalBar({ events, sessions: [], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals[0]).toMatchObject({ finished: true, result: '#55' });
    expect(b.goals[0]!.cells[0]!.state).toBe('auto');
  });
});
