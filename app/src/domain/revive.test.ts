import { describe, expect, it } from 'vitest';
import { autoRestore, liveState, parseSnap, stepSnapshot, type LiveSnap } from './revive';
import { statusTone } from './status';
import type { Session } from './session';

const bg = (name: string, sessionId: string): Session => ({
  id: sessionId.slice(0, 8), name, cwd: '/d/' + name, kind: 'background', state: 'idle', project: name, workspace: null, startedAt: 0, sessionId,
});
const snap = (daemon: number, sessions: LiveSnap['sessions'], lost: LiveSnap['lost'] = []): LiveSnap => ({ daemon, sessions, lost });
const s = (name: string, sessionId: string, goneAt?: number) => ({ name, sessionId, cwd: '/d/' + name, ...(goneAt ? { goneAt } : {}) });

const OLD = 1_000_000;
const NEW = 2_000_000;

describe('stepSnapshot — 관리 프로그램 재시작으로 꺼진 세션 찾기', () => {
  it('처음엔 살아 있는 백그라운드 세션만 적는다', () => {
    const term: Session = { ...bg('term', 'tttt0000-1'), kind: 'interactive' };
    expect(stepSnapshot(null, OLD, [bg('todo-api', 'kkkk0000-1'), term], 0)).toEqual(snap(OLD, [{ ...s('todo-api', 'kkkk0000-1'), id: 'kkkk0000', busy: false }])); // 짧은 번호도 — 되살릴 때 같은 번호로(respawn)
  });

  it('관리 프로그램 시작 시각이 바뀌면 직전에 살아 있던 세션이 꺼진 세션이 된다', () => {
    const prev = snap(OLD, [s('참모-2', 'b2'), s('acme-shop', 't1')]);
    const next = stepSnapshot(prev, NEW, [], NEW + 5000);
    expect(next?.lost.map((x) => x.name)).toEqual(['참모-2', 'acme-shop']);
    expect(next?.daemon).toBe(NEW);
  });

  it('재시작 직전 멈추는 도중에 사라진 세션도 잡는다 (목록에서 먼저 빠지고 데몬은 1분 뒤 다시 뜸)', () => {
    let st = stepSnapshot(null, OLD, [bg('acme-shop', 't1')], NEW - 60_000);
    st = stepSnapshot(st, OLD, [], NEW - 55_000); // 멈추는 중 — 목록에서 빠짐
    st = stepSnapshot(st, NEW, [], NEW + 3000);
    expect(st?.lost.map((x) => x.name)).toEqual(['acme-shop']);
  });

  it('재시작보다 한참 전에 사람이 끈 세션은 안 넣는다', () => {
    let st = stepSnapshot(null, OLD, [bg('todo-api', 'k1')], NEW - 60 * 60_000);
    st = stepSnapshot(st, OLD, [], NEW - 60 * 60_000 + 3000); // 한 시간 전에 끔
    st = stepSnapshot(st, NEW, [], NEW + 3000);
    expect(st?.lost).toEqual([]);
  });

  it('같은 이름이 새로 살아 있으면 뺀다 — 앱이 참모를 새로 띄우면 옛 참모는 이어서 켜지 않는다', () => {
    const prev = snap(OLD, [s('참모', 'old'), s('참모-2', 'b2')]);
    const next = stepSnapshot(prev, NEW, [bg('참모', 'fresh')], NEW + 1000);
    expect(next?.lost.map((x) => x.name)).toEqual(['참모-2']);
  });

  it('이어서 켜서 다시 살아나면 꺼진 목록에서 빠진다', () => {
    const prev = snap(NEW, [], [s('참모-2', 'b2'), s('acme-shop', 't1')]);
    const next = stepSnapshot(prev, NEW, [bg('참모-2', 'b2')], NEW + 9000);
    expect(next?.lost.map((x) => x.name)).toEqual(['acme-shop']);
  });

  it('앱이 참모를 늦게 띄워도(재시작 판정 뒤) 같은 이름이 살아나면 뺀다', () => {
    const prev = snap(NEW, [], [s('참모', 'old'), s('참모-2', 'b2')]);
    const next = stepSnapshot(prev, NEW, [bg('참모', 'fresh')], NEW + 9000);
    expect(next?.lost.map((x) => x.name)).toEqual(['참모-2']);
  });

  it('관리 프로그램이 꺼져 있을 땐(시작 시각 없음) 기록을 건드리지 않는다', () => {
    const prev = snap(OLD, [s('todo-api', 'k1')]);
    expect(stepSnapshot(prev, null, [], NEW)).toBe(prev);
  });

  it('또 재시작돼도 아직 안 켠 꺼진 세션은 남긴다', () => {
    const prev = snap(OLD, [s('todo-api', 'k1')], [s('acme-shop', 't1')]);
    const next = stepSnapshot(prev, NEW, [], NEW + 1000);
    expect(next?.lost.map((x) => x.name).sort()).toEqual(['acme-shop', 'todo-api']);
  });

  it('사라진 세션 흔적은 10분 지나면 지운다', () => {
    const prev = snap(OLD, [s('todo-api', 'k1', OLD + 1000)]);
    expect(stepSnapshot(prev, OLD, [], OLD + 1000 + 11 * 60_000)?.sessions).toEqual([]);
  });
});

// 2026-10-22 아이맥 soak 005: claude stop 한 예약 세션이 live.json sessions 에 state idle 로 남아(goneAt 흔적) 읽는 쪽
// (scripts/task·orch-roster·locker·모드·자리표)이 산 세션으로 셌다 — 흔적은 sessions 밖 gone 에 둔다
describe('stepSnapshot — 사라진 세션 흔적은 sessions 가 아니라 gone', () => {
  it('목록에서 빠진 세션은 sessions 에서 바로 빠지고 gone 에 남는다', () => {
    let st = stepSnapshot(null, OLD, [bg('routine-soak-ping', 'r1'), bg('참모', 'b1')], OLD + 1000);
    st = stepSnapshot(st, OLD, [bg('참모', 'b1')], OLD + 5000);
    expect(st?.sessions.map((x) => x.name)).toEqual(['참모']);
    expect(st?.gone?.map((x) => [x.name, x.goneAt])).toEqual([['routine-soak-ping', OLD + 5000]]);
  });

  it('흔적이 없으면 gone 칸을 안 쓴다(글이 그대로면 앱이 안 쓴다)', () => {
    const st = stepSnapshot(null, OLD, [bg('참모', 'b1')], OLD);
    expect(st && 'gone' in st).toBe(false);
  });

  it('흔적은 10분 지나면 gone 에서도 지운다', () => {
    let st = stepSnapshot(null, OLD, [bg('a', 'a1')], OLD);
    st = stepSnapshot(st, OLD, [], OLD + 1000);
    st = stepSnapshot(st, OLD, [], OLD + 1000 + 11 * 60_000);
    expect(st?.gone).toBeUndefined();
    expect(st?.sessions).toEqual([]);
  });

  it('다시 살아나면 gone 에서 빠지고 sessions 로', () => {
    let st = stepSnapshot(null, OLD, [bg('a', 'a1')], OLD);
    st = stepSnapshot(st, OLD, [], OLD + 1000);
    st = stepSnapshot(st, OLD, [bg('a', 'a1')], OLD + 2000);
    expect(st?.sessions.map((x) => x.sessionId)).toEqual(['a1']);
    expect(st?.gone).toBeUndefined();
  });

  it('옛 live.json(sessions 안 goneAt)도 다음 차례에 gone 으로 옮긴다', () => {
    const prev = snap(OLD, [s('routine-soak-r5', 'r5', OLD + 1000), s('참모', 'b1')]);
    const st = stepSnapshot(prev, OLD, [bg('참모', 'b1')], OLD + 2000);
    expect(st?.sessions.map((x) => x.name)).toEqual(['참모']);
    expect(st?.gone?.map((x) => [x.name, x.goneAt])).toEqual([['routine-soak-r5', OLD + 1000]]);
  });

  it('gone 에 있던 세션도 재시작 직전에 사라졌으면 꺼진 세션으로 잡는다', () => {
    let st = stepSnapshot(null, OLD, [bg('acme-shop', 't1')], NEW - 60_000);
    st = stepSnapshot(st, OLD, [], NEW - 55_000);
    expect(st?.gone?.map((x) => x.name)).toEqual(['acme-shop']);
    st = stepSnapshot(st, NEW, [], NEW + 3000);
    expect(st?.lost.map((x) => x.name)).toEqual(['acme-shop']);
    expect(st?.lost[0]).not.toHaveProperty('goneAt');
    expect(st?.gone).toBeUndefined();
  });
});

describe('parseSnap — live.json 읽기', () => {
  it('없거나 깨졌으면 null', () => {
    expect(parseSnap('')).toBeNull();
    expect(parseSnap('{"daemon":')).toBeNull();
    expect(parseSnap('{"sessions":[]}')).toBeNull();
  });
  it('모양이 맞으면 그대로', () => {
    const st = snap(NEW, [s('todo-api', 'k1')], [s('acme-shop', 't1')]);
    expect(parseSnap(JSON.stringify(st))).toEqual(st);
  });
  it('gone 도 읽는다 — 배열이 아니면 버린다', () => {
    const st = { ...snap(NEW, [s('todo-api', 'k1')]), gone: [s('b', 'b1', NEW)] };
    expect(parseSnap(JSON.stringify(st))).toEqual(st);
    expect(parseSnap(JSON.stringify({ ...snap(NEW, []), gone: 'x' }))).toEqual(snap(NEW, []));
  });
});

// 2026-10-01 아이맥 재부팅 실측 — 앱은 다시 떴는데 비서·하위 세션이 다 꺼진 채로 "다시 켜기" 버튼만 떠 있었다.
// 무인 기계라 누를 사람이 없다 → 설정(autoRevive)을 켜면 앱이 스스로 이어서 켠다.
describe('autoRestore — 무인 기계에서 재시작 뒤 스스로 되살리기', () => {
  const base = { enabled: true, ready: true, lost: [] as LiveSnap['lost'], tried: new Set<string>() };

  it('꺼 두면 아무것도 안 한다 — 사람이 쓰는 맥에선 지금처럼 버튼만', () => {
    expect(autoRestore({ ...base, enabled: false, lost: [s('아이맥', 'a1')] })).toEqual({ kind: 'none' });
  });

  it('세션 목록을 아직 못 읽었으면 기다린다', () => {
    expect(autoRestore({ ...base, ready: false, lost: [s('아이맥', 'a1')] })).toEqual({ kind: 'none' });
  });

  it('꺼진 세션이 있으면 이어서 켠다', () => {
    expect(autoRestore({ ...base, lost: [s('아이맥', 'a1'), s('project-x', 'o1')] })).toEqual({ kind: 'revive', sessions: [s('아이맥', 'a1'), s('project-x', 'o1')] });
  });

  it('한 번 시도한 세션은 다시 시도하지 않는다 — 실패해도 매 폴링마다 두드리지 않게', () => {
    expect(autoRestore({ ...base, lost: [s('아이맥', 'a1'), s('project-x', 'o1')], tried: new Set(['a1']) })).toEqual({ kind: 'revive', sessions: [s('project-x', 'o1')] });
    expect(autoRestore({ ...base, lost: [s('아이맥', 'a1')], tried: new Set(['a1']) })).toEqual({ kind: 'none' });
  });

  // 2026-10-03 사용자: 앱이 스스로 참모를 새로 만들지 않는다 — 참모가 없으면 오케스트레이터 홈에서 사람이 고른다
  it('되살릴 게 없으면 참모가 0개여도 아무것도 안 한다(새로 띄우지 않는다)', () => {
    expect(autoRestore({ ...base })).toEqual({ kind: 'none' });
  });
});

// 2026-10-12 기본 모드 '참모 상태' — 모드는 대화 기록을 못 읽으니(공개판 사용자 기록) 앱이 사이드바와 같은 판정을 live.json 세션마다 state 로 같이 쓴다
describe('stepSnapshot — 세션 상태(state)', () => {
  it('사이드바 판정(ActivityStatus)을 다섯 갈래로 — 일함·기다림·물음·쉼·모름', () => {
    expect(liveState('working')).toBe('work');
    expect(liveState('bgwait')).toBe('wait');
    for (const st of ['asks', 'blocked', 'login'] as const) expect(liveState(st)).toBe('ask');
    for (const st of ['done', 'idle', 'stale'] as const) expect(liveState(st)).toBe('idle');
    expect(liveState('unknown')).toBe('unknown');
    expect(liveState(undefined)).toBe('unknown');
  });
  it('물음·일함은 사이드바 색(statusTone)과 같은 편', () => {
    const all = ['working', 'asks', 'blocked', 'login', 'bgwait', 'done', 'idle', 'stale', 'unknown'] as const;
    for (const st of all) {
      if (statusTone(st) === 'run') expect(liveState(st)).toBe('work');
      if (statusTone(st) === 'ask') expect(liveState(st)).toBe('ask');
    }
  });
  it('세션마다 state 를 붙이고, 판정을 못 받은 세션은 unknown', () => {
    const next = stepSnapshot(null, OLD, [bg('참모-2', 'b2'), bg('acme-shop', 't1')], 0, { b2: 'asks' });
    expect(next?.sessions.map((x) => [x.name, x.state])).toEqual([['참모-2', 'ask'], ['acme-shop', 'unknown']]);
  });
  it('판정이 그대로면 기록도 그대로(앱은 글이 같으면 안 쓴다), 바뀌면 달라진다', () => {
    const a = stepSnapshot(null, OLD, [bg('참모-2', 'b2')], 0, { b2: 'working' });
    const b = stepSnapshot(a, OLD, [bg('참모-2', 'b2')], 3000, { b2: 'working' });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = stepSnapshot(b, OLD, [bg('참모-2', 'b2')], 6000, { b2: 'done' });
    expect(c?.sessions[0]?.state).toBe('idle');
  });
});

describe('stepSnapshot — 앱 별명(label)도 같이 적는다(공개 이슈 #3)', () => {
  it('별명이 앱(localStorage)에만 있는 참모는 label 로 — 기본 모드 참모 상태가 사이드바와 같은 이름을 그린다', () => {
    const next = stepSnapshot(null, OLD, [bg('참모-2', 'b2aaaaaa-1'), bg('todo-api', 'kkkk0000-1')], 0, undefined, { b2aaaaaa: '감독', zzzz: '없는 세션' });
    expect(next?.sessions.map((x) => [x.name, x.label])).toEqual([['참모-2', '감독'], ['todo-api', undefined]]);
    expect(Object.keys(next!.sessions[1]!)).not.toContain('label'); // 별명 없는 세션은 칸을 안 쓴다(글이 그대로면 안 쓴다)
  });
});
