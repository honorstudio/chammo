import { describe, expect, it } from 'vitest';
import { dismissLost, parseSnap, stepSnapshot, type LiveSnap } from './revive';
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
    expect(stepSnapshot(null, OLD, [bg('todo-api', 'kkkk0000-1'), term], 0)).toEqual(snap(OLD, [s('todo-api', 'kkkk0000-1')]));
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

describe('dismissLost — "안 켬"', () => {
  it('꺼진 목록만 비운다', () => {
    const st = snap(NEW, [s('todo-api', 'k1')], [s('acme-shop', 't1')]);
    expect(dismissLost(st)).toEqual(snap(NEW, [s('todo-api', 'k1')], []));
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
});
