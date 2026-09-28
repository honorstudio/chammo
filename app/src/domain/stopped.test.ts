import { describe, expect, it } from 'vitest';
import { orphanSession, parseStopped, recentDelegated, resumable, type StoppedSession } from './stopped';
import type { TaskCard } from './tasks';
import type { Session } from './session';

const DEV = '/U/dev';
const ALL = JSON.stringify([
  { id: 'r1', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', status: 'idle', name: '살아있음', sessionId: 's-r1', startedAt: 5 },
  { id: 'x1', cwd: `${DEV}/ops-hub`, kind: 'background', state: 'stopped', name: '끈 것', sessionId: 's-x1', startedAt: 3 },
  { id: 'x2', cwd: `${DEV}/acme-shop`, kind: 'background', state: 'failed', name: '실패', sessionId: 's-x2', startedAt: 4 },
  { id: 'x3', cwd: `${DEV}/todo-api`, kind: 'background', state: 'done', name: '끝남', sessionId: 's-x3', startedAt: 1 },
  { id: 'x4', cwd: `${DEV}/todo-api`, kind: 'background', state: 'stopped', name: 'id없음' },
]);

describe('parseStopped — agents --json --all 에서 꺼진 세션만', () => {
  it('stopped·failed·done 만, 최근 시작 순, sessionId 없는 건 뺀다(이어갈 수 없다)', () => {
    const s = parseStopped(ALL, DEV);
    expect(s.map((x) => x.id)).toEqual(['x2', 'x1', 'x3']);
  });

  it('프로젝트·작업공간과 끝난 사유를 채운다', () => {
    expect(parseStopped(ALL, DEV)[0]).toMatchObject({ project: 'acme-shop', workspace: null, reason: 'failed', sessionId: 's-x2', name: '실패' });
  });

  it('JSON이 아니면 빈 목록 (보조 정보라 화면을 깨지 않는다)', () => {
    expect(parseStopped('error', DEV)).toEqual([]);
  });
});

const card = (id: string, target: string, status: TaskCard['status'], sentAt: string): TaskCard => ({ id, target, title: id, status, sentAt, updatedAt: sentAt });
const bg = (id: string, name = id): Session => ({ id, name, cwd: '/c', kind: 'background', state: 'working', project: name, workspace: null, startedAt: 0 });

describe('recentDelegated — 참모 화면 아래 한 줄로 띄울 "지금 시킨 일" 세션 최대 4개', () => {
  const sessions = [bg('a'), bg('b'), bg('c'), bg('d'), bg('e'), { ...bg('i'), kind: 'interactive' as const }];

  it('끝나지 않은 카드의 대상 세션을 최근 순으로 4개', () => {
    const cards = [card('1', 'a', 'working', 't1'), card('2', 'b', 'sent', 't2'), card('3', 'c', 'replied', 't3'), card('4', 'd', 'needsInput', 't4'), card('5', 'e', 'working', 't5')];
    expect(recentDelegated(cards, sessions).map((s) => s.id)).toEqual(['e', 'd', 'c', 'b']);
  });

  it('끝난 일·사라진 세션·터미널 세션(attach 불가)은 뺀다', () => {
    const cards = [card('1', 'a', 'done', 't5'), card('2', 'zz', 'gone', 't4'), card('3', 'i', 'working', 't3'), card('4', 'b', 'working', 't2')];
    expect(recentDelegated(cards, sessions).map((s) => s.id)).toEqual(['b']);
  });

  it('같은 세션에 여러 번 시켰으면 한 번만', () => {
    const cards = [card('1', 'a', 'working', 't1'), card('2', 'a', 'sent', 't2')];
    expect(recentDelegated(cards, sessions).map((s) => s.id)).toEqual(['a']);
  });

  it('대상은 이름으로 적어도 찾는다', () => {
    const cards = [card('1', 'ops-hub', 'working', 't1')];
    expect(recentDelegated(cards, [bg('3ae12f81', 'ops-hub')]).map((s) => s.id)).toEqual(['3ae12f81']);
  });
});

describe('resumable — 이미 살아 있는 대화는 "이어서" 목록에서 뺀다', () => {
  it('살아 있는 세션과 sessionId 가 같으면 뺀다 (여러 번 눌러 복사본이 생기던 문제)', () => {
    const stopped = parseStopped(ALL, DEV);
    const live = [{ ...bg('r9'), sessionId: 's-x1' }];
    expect(resumable(stopped, live).map((s) => s.id)).toEqual(['x2', 'x3']);
  });

  it('방금 누른 것(pending)도 뺀다 — 목록 갱신 전 3초 사이 중복 클릭', () => {
    expect(resumable(parseStopped(ALL, DEV), [], new Set(['s-x2'])).map((s) => s.id)).toEqual(['x1', 'x3']);
  });

  it('같은 대화가 꺼진 목록에 여러 번 있으면 가장 최근 것 하나만', () => {
    const dup = JSON.stringify([
      { id: 'o1', cwd: `${DEV}/todo-api`, state: 'stopped', sessionId: 'same', startedAt: 1 },
      { id: 'o2', cwd: `${DEV}/todo-api`, state: 'stopped', sessionId: 'same', startedAt: 9 },
    ]);
    expect(resumable(parseStopped(dup, DEV), []).map((s) => s.id)).toEqual(['o2']);
  });
});

describe('orphanSession — 주인 잃은 일을 이어서 켤 세션', () => {
  const st = (id: string, name: string, startedAt: number): StoppedSession => ({
    id, sessionId: id + '-full', name, cwd: '/d/x', project: 'x', workspace: null, reason: 'stopped', startedAt,
  });
  // parseStopped 가 최근 순으로 준다
  const list = [st('bbbb2222', 'acme-shop-g', 20), st('aaaa1111', 'acme-shop-g', 10), st('cccc3333', 'oms', 5)];

  it('이름이 같으면 가장 최근 것', () => {
    expect(orphanSession('acme-shop-g', list)?.id).toBe('bbbb2222');
  });
  it('짧은 id·긴 sessionId 로 적었어도 찾는다', () => {
    expect(orphanSession('aaaa1111', list)?.id).toBe('aaaa1111');
    expect(orphanSession('cccc3333-full', list)?.id).toBe('cccc3333');
  });
  it('기록이 없으면 undefined — 버튼을 막는다', () => {
    expect(orphanSession('todo-api', list)).toBeUndefined();
  });
});
