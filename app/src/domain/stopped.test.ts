import { describe, expect, it } from 'vitest';
import { orphanSession, parseStopped, recentDelegated, resumable, sameOrchSlot, stoppedOrchs, type StoppedSession } from './stopped';
import type { TaskCard } from './tasks';
import type { Session } from './session';
import fixture from './paths.fixture.json';

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
    expect(recentDelegated(cards, [bg('abc12345', 'ops-hub')]).map((s) => s.id)).toEqual(['abc12345']);
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

describe('stoppedOrchs — 오케스트레이터 패널의 꺼진 참모', () => {
  const st = (id: string, name: string, cwd = '/h/.chammo/hq'): StoppedSession => ({ id, sessionId: `${id}-sid`, name, cwd, project: 'hq', workspace: null, reason: 'stopped', startedAt: 0 });
  const HQ = '/h/.chammo/hq';
  it('번호 붙은 참모·옛 이름(참모-2)도 — 끄면 패널에서 사라졌다(2026-10-01 사용자)', () => {
    expect(stoppedOrchs([st('a', '참모-2'), st('b', '참모-3'), st('c', '참모')], HQ, []).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('도우미(비서 이름이 아닌 것)·다른 폴더는 뺀다', () => {
    expect(stoppedOrchs([st('a', 'sns-post'), st('b', '참모-2', '/h/dev/acme')], HQ, [])).toEqual([]);
  });
  it('같은 이름으로 지금 떠 있으면 뺀다, 같은 이름이 여럿이면 가장 최근(앞) 하나', () => {
    const live = [{ name: '참모-2' }];
    expect(stoppedOrchs([st('a', '참모-2'), st('b', '참모-3'), st('c', '참모-3')], HQ, live).map((x) => x.id)).toEqual(['b']);
  });
  it('윈도우 경로 모양이 달라도 같은 HQ 로 본다', () => {
    expect(stoppedOrchs([st('a', '참모-2', 'C:/Users/me/.chammo/hq')], 'C:\\Users\\me\\.chammo\\hq', []).map((x) => x.id)).toEqual(['a']);
  });
});

describe('sameOrchSlot — 꺼진 참모를 지울 때 같은 이름으로 쌓인 것 전부', () => {
  const st = (id: string, name: string, cwd = '/h/.chammo/hq'): StoppedSession => ({ id, sessionId: `${id}-sid`, name, cwd, project: 'hq', workspace: null, reason: 'stopped', startedAt: 0 });
  it('같은 HQ·같은 이름 전부 — 패널엔 최근 하나만 보여서 지워도 다음 옛것이 올라왔다(참모-3 이 8개, 2026-10-01 사용자)', () => {
    const all = [st('a', '참모-3'), st('b', '참모-2'), st('c', '참모-3'), st('d', '참모-3', '/h/dev/acme'), st('e', '참모-3')];
    expect(sameOrchSlot(all, all[0]!, '/h/.chammo/hq').map((x) => x.id)).toEqual(['a', 'c', 'e']);
  });
  it('HQ 가 아니거나 참모 이름이 아니면 그것 하나만', () => {
    const all = [st('a', 'sns-post'), st('b', 'sns-post')];
    expect(sameOrchSlot(all, all[0]!, '/h/.chammo/hq').map((x) => x.id)).toEqual(['a']);
  });
});

describe('stoppedOrchs — 별명이 실린 이름도 기본 이름(번호)으로 같은 참모 (2026-10-02)', () => {
  const st = (id: string, name: string) => ({ id, sessionId: id, name, cwd: '/hq', ts: '2026-10-02T00:00:00Z' }) as unknown as StoppedSession;
  it('켜져 있는 참모-5 · 별명이 있으면 꺼진 옛 참모-5 는 안 보인다', () => {
    expect(stoppedOrchs([st('a', '참모-5')], '/hq', [{ name: '참모-5 · 개발 담당' }])).toEqual([]);
  });
  it('꺼진 것끼리도 같은 번호는 하나만', () => {
    expect(stoppedOrchs([st('a', '참모-3 · 디자인'), st('b', '참모-3')], '/hq', []).map((x) => x.id)).toEqual(['a']);
  });
});

describe('stoppedOrchs — 기본 이름이 같아도 별명이 다르면 다른 참모(2026-10-02 참모-3 둘 사고)', () => {
  const st = (id: string, name: string, startedAt = 0): StoppedSession => ({ id, sessionId: `s-${id}`, name, cwd: '/hq', project: 'hq', workspace: null, reason: 'stopped', startedAt });
  it('살아 있는 "참모-3 · 서버 정리" 가 있어도 꺼진 "참모-3 · 쇼핑몰 문의" 는 보인다', () => {
    const got = stoppedOrchs([st('f1', '참모-3 · 쇼핑몰 문의')], '/hq', [{ name: '참모-3 · 서버 정리' }]);
    expect(got.map((x) => x.name)).toEqual(['참모-3 · 쇼핑몰 문의']);
  });
  it('별명 없는 옛 기록(참모-2 복사본들)은 같은 번호가 살아 있으면 숨기고, 꺼진 것끼리는 하나로', () => {
    expect(stoppedOrchs([st('a', '참모-2'), st('b', '참모-2')], '/hq', [{ name: '참모-2 · 참모 업데이트' }])).toEqual([]);
    expect(stoppedOrchs([st('a', '참모-2', 9), st('b', '참모-2', 5)], '/hq', []).map((x) => x.id)).toEqual(['a']);
  });
  it('같은 별명으로 살아 있으면 숨긴다(이름 바뀌기 전 기록)', () => {
    expect(stoppedOrchs([st('a', '참모-5 · 개발 담당')], '/hq', [{ name: '참모-5 · 개발 담당' }])).toEqual([]);
  });
  it('꺼진 것 둘이 기본 이름은 같고 별명이 다르면 둘 다', () => {
    expect(stoppedOrchs([st('a', '참모-3 · 서버'), st('b', '참모-3 · 쇼핑몰')], '/hq', []).length).toBe(2);
  });
});

describe('sameOrchSlot — 지울 때 번호가 같아도 별명이 다른 참모는 안 지운다(2026-10-02 참모-3 둘)', () => {
  const st = (id: string, name: string): StoppedSession => ({ id, sessionId: `${id}-sid`, name, cwd: '/hq', project: 'hq', workspace: null, reason: 'stopped', startedAt: 0 });
  it('"참모-3 · 서버" 를 지우면 같은 별명·별명 없는 옛 복사본만, "참모-3 · 쇼핑몰" 는 남긴다', () => {
    const all = [st('n', '참모-3 · 서버'), st('l', '참모-3 · 쇼핑몰'), st('old', '참모-3'), st('n2', '참모-3 · 서버')];
    expect(sameOrchSlot(all, all[0]!, '/hq').map((x) => x.id)).toEqual(['n', 'old', 'n2']);
  });
  it('별명 없는 걸 지우면 별명 없는 같은 번호만', () => {
    const all = [st('a', '참모-3'), st('l', '참모-3 · 쇼핑몰'), st('b', '참모-3')];
    expect(sameOrchSlot(all, all[0]!, '/hq').map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('꺼진 참모 HQ 판단은 samePath 한 벌(fix/win-phone-path 세 벌 정리) — 공용 표 그대로', () => {
  const st = (cwd: string): StoppedSession => ({ id: 'a', sessionId: 'a-sid', name: '참모-2', cwd, project: 'hq', workspace: null, reason: 'stopped', startedAt: 0 });
  it.each(fixture.cases as [string, string, boolean][])('%s ~ %s → %s', (cwd, hq, same) => {
    expect(stoppedOrchs([st(cwd)], hq, []).length === 1).toBe(same);
    expect(sameOrchSlot([st(cwd), { ...st(cwd), id: 'b' }], st(cwd), hq).length === 2).toBe(same);
  });
});
