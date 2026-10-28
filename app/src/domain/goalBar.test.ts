import { describe, expect, it } from 'vitest';
import { cellState, ETC_FOLD_MS, GOAL_IDLE_MS, goalBar, goalRows, prResult, QUIET_MS, type CellFacts } from './goalBar';
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
    const events = [send('1', 's-1', 3, { goal: 'm', goalTotal: 3 }), done('1', 1)];
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

// 2026-10-23 사용자 폰: 예정 칸을 못 채운 목표·답만 온 결정 칸·오래된 기타가 진행 칸에서 안 닫혔다
describe('goalBar — 안 닫히던 것 닫기', () => {
  const sessions = ['s-1', 's-2', 's-3'].map((n) => sess(n));
  const view = (events: TaskEvent[], now = NOW, ss = sessions) => goalBar({ events, sessions: ss, orch: ORCH, now, seen: new Set() });
  const gev = (type: 'goal-done' | 'goal-total', goal: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent =>
    ({ ts: at(h), type, task: `goal-${h}`, goal, from: 'o2', ...o });

  it('보낸 일이 다 끝나고 2시간 새 일이 없으면 남은 예정 칸은 버린 것 — 목표가 끝난다', () => {
    const events = [send('1', 's-1', 5, { goal: '목표 D', goalTotal: 4 }), done('1', 3, 'PR #18')];
    expect(view(events).goals[0]).toMatchObject({ finished: true, done: 1, total: 1, result: '#18' });
    expect(view(events).goals[0]!.cells.map((c) => c.state)).toEqual(['done']);
  });

  it('끝난 지 2시간이 안 됐으면 아직 예정 칸을 기다린다', () => {
    const events = [send('1', 's-1', 3, { goal: '목표 D', goalTotal: 4 }), done('1', 1)];
    expect(view(events).goals[0]).toMatchObject({ finished: false, done: 1, total: 4 });
    expect(GOAL_IDLE_MS).toBe(2 * H);
  });

  it('goal-done 이면 바로 닫는다 — 안 끝난 칸도 닫힌 칸으로', () => {
    const events = [send('1', 's-1', 3, { goal: 'm', goalTotal: 5 }), done('1', 2), send('2', 's-2', 1, { goal: 'm' }), gev('goal-done', 'm', 0.5)];
    const g = view(events).goals[0]!;
    expect(g).toMatchObject({ finished: true, done: 2, total: 2 });
    expect(g.cells.map((c) => c.state)).toEqual(['done', 'auto']);
  });

  it('goal-done 뒤 같은 목표로 새 일이 오면 다시 열린다 — 앞 칸은 닫힌 그대로', () => {
    const events = [send('1', 's-1', 3, { goal: 'm' }), gev('goal-done', 'm', 2), send('2', 's-2', 1, { goal: 'm' })];
    const g = view(events).goals[0]!;
    expect(g).toMatchObject({ finished: false, done: 1, total: 2 });
    expect(g.cells.map((c) => c.state)).toEqual(['auto', 'rest']);
  });

  it('다른 참모의 goal-done 은 내 목표를 안 닫는다', () => {
    const events = [send('1', 's-1', 3, { goal: 'm' }), gev('goal-done', 'm', 1, { from: 'o5', fromName: '참모-5' })];
    expect(view(events).goals[0]!.finished).toBe(false);
  });

  it('goal-total 이 예정 수를 바꾼다 — 그 뒤 send 의 더 큰 N 은 다시 올린다', () => {
    const base = [send('1', 's-1', 3, { goal: 'm', goalTotal: 7 })];
    expect(view([...base, gev('goal-total', 'm', 2, { goalTotal: 3 })]).goals[0]!.total).toBe(3);
    expect(view([...base, gev('goal-total', 'm', 2, { goalTotal: 3 }), send('2', 's-2', 1, { goal: 'm', goalTotal: 5 })]).goals[0]!.total).toBe(5);
    expect(view([...base, send('2', 's-2', 2, { goal: 'm' }), gev('goal-total', 'm', 1, { goalTotal: 1 })]).goals[0]!.total).toBe(2);
  });

  it(':N 을 몇 번째로 잘못 써도(:1·:2·:3) 가장 큰 값', () => {
    const events = [1, 2, 3].map((n) => send(`${n}`, `s-${n}`, 5 - n, { goal: 'pg', goalTotal: n }));
    expect(view(events).goals[0]!.total).toBe(3);
  });

  it('결정에 답이 왔고 세션이 꺼졌으면 앱이 닫음 · 일하는 중이면 일하는 중 — 빨간 칸이 아니다', () => {
    const ev = (n: string): TaskEvent[] => [send(n, `s-${n}`, 2, { goal: 'pg' }),
      { ts: at(2), type: 'ask', task: n, note: '결제 확인' }, { ts: at(1.9), type: 'answer', task: n, note: 'ㄱㄱ' }];
    const b = view([...ev('1'), ...ev('2'), ...ev('3')], NOW, [sess('s-2', { state: 'working' }), sess('s-3')]);
    expect(b.goals[0]!.cells.map((c) => c.state)).toEqual(['auto', 'run', 'rest']);
  });

  it('이름표 없는 일은 하루 넘게 기척이 없으면 진행 칸에서 접힌다', () => {
    const events = [send('old', 's-1', 25), { ts: at(24.5), type: 'ask', task: 'old', note: '?' } as TaskEvent, send('new', 's-2', 23)];
    expect(view(events).goals[0]!.cells.map((c) => c.task)).toEqual(['new']);
    expect(view(events, NOW + 2 * H).goals).toEqual([]);
    expect(ETC_FOLD_MS).toBe(24 * H);
  });
});

// 폰 화면 견본 — 목표 넷이 섞인 이틀치(지어낸 값, 세션은 다 꺼짐, 한 곳만 일하는 중)
describe('goalBar — 폰 화면 견본', () => {
  const ev = (type: TaskEvent['type'], task: string, h: number, note = ''): TaskEvent => ({ ts: at(h), type, task, note });
  const events: TaskEvent[] = [
    send('c1', 'pixel-blog', 17.4, { goal: '목표 A', goalTotal: 5, project: 'pixel-blog' }), done('c1', 17, 'PR #7 머지'),
    send('m1', 'pixel-blog', 17, { goal: '목표 B', goalTotal: 7, project: 'pixel-blog' }), done('m1', 16.5, '기획서 docs/plans/x.md'),
    send('m2', 'pixel-blog', 16.5, { goal: '목표 B', goalTotal: 7, project: 'pixel-blog' }),
    send('p1', 'shop', 0.93, { goal: '목표 C', goalTotal: 1, project: 'shop' }), ev('ask', 'p1', 0.93), ev('answer', 'p1', 0.88), done('p1', 0.7, 'PR #31 머지'),
    send('p2', 'shop', 0.55, { goal: '목표 C', goalTotal: 2, project: 'shop' }), done('p2', 0.15, 'PR #32 머지'),
    send('p3', 'shop', 0.4, { goal: '목표 C', goalTotal: 3, project: 'shop' }), ev('ask', 'p3', 0.4), ev('answer', 'p3', 0.2),
    send('p4', 'shop', 0.39, { goal: '목표 C', goalTotal: 4, project: 'shop' }), ev('ask', 'p4', 0.39), ev('answer', 'p4', 0.2),
    send('r1', 'todo-api', 9.9, { goal: '목표 D', goalTotal: 4, project: 'todo-api' }), done('r1', 7, 'PR #9 머지'),
    send('a1', 'app-a', 46.5, { project: 'app-a' }), ev('reply', 'a1', 43),
    send('s1', 'bot', 101, { project: 'shop-b' }), ev('ask', 's1', 101), ev('answer', 's1', 101), ev('reply', 's1', 100.5), ev('ask', 's1', 100.4), ev('reply', 's1', 100),
    send('s2', 'bot', 101, { project: 'shop-b' }),
  ];
  it('예정 칸만 남은 목표·답만 온 결정 칸은 끝으로, 진짜 조용한 칸만 빨강, 오래된 기타는 접힘', () => {
    const b = goalBar({ events, sessions: [sess('app-a', { state: 'working' })], orch: ORCH, now: NOW, seen: new Set() });
    const rows = Object.fromEntries(b.goals.map((g) => [g.name || `기타 ${g.project}`, [`${g.done}/${g.total}`, g.cells.map((c) => c.state).join(','), g.finished]]));
    expect(rows).toEqual({
      '목표 A': ['1/1', 'done', true],
      '목표 B': ['1/7', 'done,quiet,todo,todo,todo,todo,todo', false],
      '목표 C': ['4/4', 'done,done,auto,auto', true],
      '목표 D': ['1/1', 'done', true],
    });
  });
});

// 참모끼리 넘긴 일 — 기획이 큰 일을 백엔드에게 넘기면 기획 칸엔 큰 일 한 칸, 백엔드 칸엔 쪼갠 일들
describe('goalBar — 참모끼리 넘긴 일', () => {
  const SEC = { id: 'o1', name: '참모 · 기획' };
  const DEV = { id: 'o5', name: '참모-5 · 백엔드' };
  const roster = [sess('참모 · 기획', { id: 'o1' }), sess('참모-5 · 백엔드', { id: 'o5' })];
  const hand = (task: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent =>
    ({ ts: at(h), type: 'handover', task, target: '참모-5 · 백엔드', toName: '참모-5', title: '로그인 화면 새로', from: 'o1', fromName: '참모', ...o });
  const dsend = (task: string, target: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent =>
    ({ ts: at(h), type: 'send', task, target, title: task, from: 'o5', fromName: '참모-5', handover: 'h-1', goal: '로그인 개편', ...o });
  const view = (orch: typeof SEC, events: TaskEvent[], sessions: Session[] = [], now = NOW) =>
    goalBar({ events, sessions: [...roster, ...sessions], orch, now, seen: new Set() });

  it('받는 참모가 별명이 없어도 번호 이름은 안 보인다 — 번호 뺀 기본 이름(2026-10-28)', () => {
    const g = goalBar({ events: [hand('h-1', 0.5, { target: '참모-7', toName: '참모-7' })], sessions: [...roster, sess('참모-7', { id: 'o7' })], orch: SEC, now: NOW, seen: new Set() }).goals;
    expect(g[0]!.cells[0]!.hand!.to).toBe('참모');
  });

  it('넘긴 쪽엔 큰 일 한 줄 — 목표가 없으면 큰 일 이름으로, 받은 쪽이 시작 전이면 쉬는 중', () => {
    const g = view(SEC, [hand('h-1', 0.5)]).goals;
    expect(g.map((x) => [x.name, x.done, x.total])).toEqual([['로그인 화면 새로', 0, 1]]);
    expect(g[0]!.cells[0]).toMatchObject({ state: 'rest', hand: { to: '백엔드', done: 0, total: 0, jobs: [] } });
  });

  it('--goal 을 주면 그 목표 줄의 한 칸 — 같은 목표의 내 일과 같이', () => {
    const g = view(SEC, [hand('h-1', 2, { goal: '회원 기능' }), send('m1', 'web', 1, { from: 'o1', goal: '회원 기능' })], [sess('web')]).goals;
    expect(g.map((x) => [x.name, x.cells.length])).toEqual([['회원 기능', 2]]);
  });

  it('받은 쪽 일들의 진행(끝/전체, 예정 칸 포함)을 따라 채워지고, 하나라도 일하는 중이면 일하는 중', () => {
    const events = [hand('h-1', 3),
      dsend('r1', 'ci', 2.9, { goalTotal: 4 }), done('r1', 2), dsend('r2', 'ci', 2), done('r2', 1.2), dsend('r3', 'shop', 1.1)];
    const c = view(SEC, events, [sess('ci'), sess('shop', { state: 'working' })]).goals[0]!.cells[0]!;
    expect(c).toMatchObject({ state: 'run', fill: 0.5, hand: { to: '백엔드', done: 2, total: 4, todo: 1 } });
    expect(c.hand!.jobs.map((j) => [j.task, j.state])).toEqual([['r1', 'done'], ['r2', 'done'], ['r3', 'run']]);
  });

  it('받은 쪽엔 실제 일들이 목표 줄로, 줄엔 누가 넘겼는지', () => {
    const events = [hand('h-1', 3), dsend('r1', 'ci', 2.9, { goalTotal: 2 }), dsend('r2', 'ci', 2)];
    const g = view(DEV, events, [sess('ci')]).goals;
    expect(g.map((x) => [x.name, x.cells.length, x.handedBy])).toEqual([['로그인 개편', 2, '기획']]);
    expect(view(SEC, events, [sess('ci')]).goals.flatMap((x) => x.cells.map((c) => c.task))).toEqual(['h-1']);
  });

  it('받은 쪽 결정이 걸리면 넘긴 쪽 칸도 답 기다림', () => {
    const events = [hand('h-1', 3), dsend('r1', 'ci', 2), { ts: at(1), type: 'ask', task: 'r1', note: '?' } as TaskEvent];
    expect(view(SEC, events, [sess('ci')]).goals[0]!.cells[0]!.state).toBe('ask');
  });

  it('받은 쪽 handover-done 이나 넘긴 쪽 done 이면 바로 끝 — 결과 한 줄', () => {
    const g = view(SEC, [hand('h-1', 3), dsend('r1', 'ci', 2), done('h-1', 0.5, '로그인 화면 끝, PR #18')], [sess('ci')]).goals[0]!;
    expect(g).toMatchObject({ finished: true, done: 1, total: 1, result: '#18' });
    expect(g.cells[0]!.state).toBe('done');
  });

  it('받은 쪽 일이 다 끝나고 2시간 조용하면 앱이 닫음 — 그 전엔 꽉 찬 채 기다림', () => {
    const events = [hand('h-1', 5), dsend('r1', 'ci', 4.5), done('r1', 3, 'PR #21 머지')];
    const wait = view(SEC, events, [sess('ci')], NOW - 1.5 * H).goals[0]!;
    expect(wait.cells[0]).toMatchObject({ state: 'rest', fill: 1 });
    const g = view(SEC, events, [sess('ci')]).goals[0]!;
    expect(g.cells[0]!.state).toBe('auto');
    expect(g).toMatchObject({ finished: true, result: '#21' });
    expect(GOAL_IDLE_MS).toBe(2 * H);
  });

  it('받은 쪽이 아직 아무것도 안 보냈어도 받은 참모가 일하는 중이면 일하는 중, 3시간 넘게 기척 없으면 오래 조용', () => {
    const busy = [sess('참모 · 기획', { id: 'o1' }), sess('참모-5 · 백엔드', { id: 'o5', state: 'working' })];
    expect(goalBar({ events: [hand('h-1', 1)], sessions: busy, orch: SEC, now: NOW, seen: new Set() }).goals[0]!.cells[0]!.state).toBe('run');
    expect(view(SEC, [hand('h-1', QUIET_MS / H + 0.1)]).goals[0]!.cells[0]!.state).toBe('quiet');
  });

  it('남이 넘긴 일은 내 칸에 안 생긴다', () => {
    expect(view(SEC, [hand('h-1', 1, { from: 'o9', fromName: '참모-3' })]).goals).toEqual([]);
  });

  it('넘긴 쪽이 goal-done 으로 목표를 닫으면 넘김 칸도 닫힌다', () => {
    const events = [hand('h-1', 3, { goal: '회원 기능' }), { ts: at(1), type: 'goal-done', task: 'goal-1', goal: '회원 기능', from: 'o1' } as TaskEvent];
    expect(view(SEC, events).goals[0]).toMatchObject({ finished: true });
  });

  it('서로 넘겨도(A→B→A) 끝없이 돌지 않는다', () => {
    const back: TaskEvent = { ts: at(1), type: 'handover', task: 'h-2', target: '참모 · 기획', toName: '참모', title: '되돌림', from: 'o5', fromName: '참모-5' };
    const events = [hand('h-1', 3), dsend('r1', 'ci', 2), back, { ...send('s1', 'web', 0.5, { from: 'o1', fromName: '참모' }), handover: 'h-2' }];
    expect(view(SEC, events, [sess('ci'), sess('web')]).goals.length).toBeGreaterThan(0);
    expect(view(DEV, events, [sess('ci'), sess('web')]).goals.length).toBeGreaterThan(0);
  });
});

// 2026-10-23 사용자: 심사·예약 날짜·사람 답처럼 밖을 기다리는 일이 '17시간 조용' 빨강으로 보였다 — `task wait` 로 '기다림'
describe('goalBar — 기다림(task wait)', () => {
  const sessions = ['s-1', 's-2'].map((n) => sess(n));
  const view = (events: TaskEvent[], now = NOW, ss = sessions) => goalBar({ events, sessions: ss, orch: ORCH, now, seen: new Set() });
  const wait = (task: string, h: number, o: Partial<TaskEvent> = {}): TaskEvent => ({ ts: at(h), type: 'wait', task, note: '애플 심사', on: 'outside', ...o });
  const cell = (events: TaskEvent[], now = NOW) => view(events, now).goals[0]!.cells[0]!;

  it('wait 를 걸면 오래 조용이어도 기다림 칸 — 경고가 아니다', () => {
    const events = [send('a', 's-1', 20, { goal: '출시 준비' }), wait('a', 18)];
    expect(cell(events)).toMatchObject({ state: 'wait', wait: { why: '애플 심사', on: 'outside' } });
    expect(cell([send('a', 's-1', 20, { goal: '출시 준비' })]).state).toBe('quiet');
  });

  it('세션이 일하는 중이어도 기다림이 먼저, 다만 사용자 답을 기다리는 ask 는 그대로 ask', () => {
    const events = [send('a', 's-1', 5), wait('a', 4)];
    expect(cell(events)).toMatchObject({ state: 'wait' });
    expect(view(events, NOW, [sess('s-1', { state: 'working' })]).goals[0]!.cells[0]!.state).toBe('wait');
    const ask: TaskEvent = { ts: at(3), type: 'ask', task: 'a', note: '비번 줘' };
    expect(cell([...events, ask])).toMatchObject({ state: 'ask', wait: { why: '애플 심사' } });
  });

  it('reply·done·retry·answer 가 오면 풀린다 — 그냥 note 는 안 푼다', () => {
    const base = [send('a', 's-1', 6), wait('a', 5)];
    expect(cell([...base, { ts: at(4), type: 'note', task: 'a', note: '아직 심사 중' }]).state).toBe('wait');
    expect(cell([...base, { ts: at(4), type: 'reply', task: 'a', note: '합격' }]).state).not.toBe('wait');
    expect(cell([...base, { ts: at(4), type: 'note', task: 'a', retry: 1, note: '되돌림 1' }]).state).not.toBe('wait');
    expect(cell([...base, { ts: at(4), type: 'ask', task: 'a', note: '정해' }, { ts: at(3.5), type: 'answer', task: 'a', note: '이걸로' }]).state).not.toBe('wait');
    expect(cell([...base, done('a', 4)]).state).toBe('done');
  });

  it('같은 세션에 새 send 가 가면 앞 기다림은 풀린다 — 다른 세션이면 그대로', () => {
    const base = [send('a', 's-1', 6), wait('a', 5)];
    const b = view([...base, send('b', 's-1', 1)]).goals.flatMap((g) => g.cells).map((c) => [c.task, c.state]);
    expect(b.find(([t]) => t === 'a')![1]).not.toBe('wait');
    const c = view([...base, send('b', 's-2', 1)]).goals.flatMap((g) => g.cells).map((x) => [x.task, x.state]);
    expect(c.find(([t]) => t === 'a')![1]).toBe('wait');
  });

  it('날짜(until)가 아직 안 온 기다림은 같은 세션 새 send 에도 남는다 — 예약이 둘일 수 있다', () => {
    const until = new Date(NOW + 5 * H).toISOString();
    const events = [send('a', 's-1', 6), wait('a', 5, { until }), send('b', 's-1', 4), wait('b', 3, { until })];
    expect(view(events).goals[0]!.cells.map((c) => c.state)).toEqual(['wait', 'wait']);
  });

  it('--until 이 지나면 풀려 일반 규칙으로 — 그때부터 3시간 넘게 기척이 없어야 오래 조용', () => {
    const until = new Date(NOW - 2 * H).toISOString();
    const events = [send('a', 's-1', 30), wait('a', 29, { until })];
    expect(cell(events, NOW - 3 * H)).toMatchObject({ state: 'wait', wait: { until: Date.parse(until) } });
    expect(cell(events).state).toBe('rest'); // 지난 지 2시간 — 아직 조용하다고 안 함
    expect(cell(events, NOW + 2 * H).state).toBe('quiet'); // 지난 지 4시간
    expect(cell(events, NOW + 2 * H).wait).toBeUndefined();
  });

  it('목표의 남은 칸이 다 기다림이면 목표 줄에 waiting — 끝난 칸·안 보낸 칸은 안 센다', () => {
    const events = [send('a', 's-1', 9, { goal: '출시 준비', goalTotal: 3 }), done('a', 8), send('b', 's-2', 7, { goal: '출시 준비' }), wait('b', 6)];
    expect(view(events).goals[0]).toMatchObject({ waiting: true, done: 1, total: 3 });
    const mixed = [...events, send('c', 's-1', 1, { goal: '출시 준비' })];
    expect(view(mixed).goals[0]!.waiting).toBe(false);
    expect(view([send('a', 's-1', 1, { goal: 'x' })]).goals[0]!.waiting).toBe(false);
  });

  it('이름표 없는 기타 칸도 기다림이면 24시간 지나도 안 접힌다', () => {
    const events = [send('a', 's-1', 40), wait('a', 30)];
    expect(view(events).goals[0]!.cells[0]!.state).toBe('wait');
    expect(view([send('a', 's-1', 40)]).goals).toEqual([]);
    expect(ETC_FOLD_MS).toBe(24 * H);
  });

  it('다른 일의 wait 는 안 번진다', () => {
    const b = view([send('a', 's-1', 5), send('b', 's-2', 5), wait('a', 4)]).goals[0]!.cells;
    expect(b.map((c) => c.state)).toEqual(['wait', 'quiet']);
  });
});

// 처음 쓰는 사람의 참모는 --goal 을 잘 안 써서 진행 칸이 다 '기타' 한 줄이었다(2026-10-24 윈도우 공개판) — 목표 없는 일은 프로젝트마다 그 이름으로
describe('목표 없는 일 — 프로젝트(없으면 세션 대상)별 줄, 프로젝트 이름이 줄 이름', () => {
  it('프로젝트마다 한 줄 — 한 프로젝트만 맡아도 기타가 아니라 그 이름', () => {
    const one = goalBar({ events: [send('a', 'web', 2, { project: 'shop' }), send('b', 'web', 1, { project: 'shop' })], sessions: [sess('web')], orch: ORCH, now: NOW, seen: new Set() });
    expect(one.goals.map((g) => [g.name, g.label, g.cells.length])).toEqual([['', 'shop', 2]]);
    const two = goalBar({ events: [send('a', 'web', 2, { project: 'shop' }), send('b', 'api', 1, { project: 'blog' }), send('c', 'web', 1, { goal: '출시', project: 'shop' })], sessions: [sess('web'), sess('api')], orch: ORCH, now: NOW, seen: new Set() });
    expect(two.goals.map((g) => [g.project, g.name, g.label ?? ''])).toEqual([['blog', '', 'blog'], ['shop', '출시', ''], ['shop', '', 'shop']]);
  });
  it('기록에 프로젝트가 없으면 세션의 프로젝트, 그것도 없으면 세션 대상 이름', () => {
    const b = goalBar({ events: [send('a', 'web', 2), send('b', 'ghost', 1)], sessions: [sess('web', { project: 'shop' })], orch: ORCH, now: NOW, seen: new Set() });
    expect(b.goals.map((g) => g.label).sort()).toEqual(['ghost', 'shop']);
  });
  it('줄 이름 — 목표는 목표 이름, 목표 없는 줄은 프로젝트 이름, 같은 이름의 프로젝트 머리줄 밑이면 그 밖의 일', () => {
    const b = goalBar({ events: [send('a', 'web', 2, { project: 'shop' }), send('b', 'api', 1, { project: 'blog' }), send('c', 'web', 1, { goal: '출시', project: 'shop' })], sessions: [sess('web'), sess('api')], orch: ORCH, now: NOW, seen: new Set() });
    expect(goalRows(b).map((r) => [r.head ?? '', r.name])).toEqual([['', 'blog'], ['shop', '출시'], ['', '그 밖의 일']]);
    const one = goalBar({ events: [send('a', 'web', 2, { project: 'shop' })], sessions: [sess('web')], orch: ORCH, now: NOW, seen: new Set() });
    expect(goalRows(one).map((r) => [r.head ?? '', r.name])).toEqual([['', 'shop']]);
  });
});
