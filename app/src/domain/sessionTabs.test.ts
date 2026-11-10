import { describe, expect, it } from 'vitest';
import { deadTab, goneLightTabs, rememberTabSessions, type TabSess } from './sessionTabs';
import type { StoppedSession } from './stopped';

// 2026-11-10 — 스페이스 세션 탭은 세션이 꺼지면 이름이 '꺼진 세션'으로 바뀌고, 고르면 '왼쪽 메뉴에서 골라 줘'만 떴다
// (탭 이름·가운데 화면이 살아 있는 세션 목록에서만 세션을 찾았다)
const live = (id: string, name: string, sessionId = `sid-${id}`) => ({ id, name, cwd: `/dev/p/${id}`, sessionId });
const stopped = (id: string, sessionId = `sid-${id}`, name = id): StoppedSession =>
  ({ id, sessionId, name, cwd: `/dev/p/${id}`, project: 'p', workspace: null, reason: 'stopped', startedAt: 1 });

describe('rememberTabSessions — 살아 있을 때 본 이름을 기억한다', () => {
  it('보이는 이름(cardName)·폴더·대화 id·도우미 여부를 적는다', () => {
    const mem = new Map<string, TabSess>();
    rememberTabSessions(mem, [live('a1', 'docs-helper'), live('b2', 'shop')], (s) => s.name.toUpperCase(), (s) => s.id === 'a1');
    expect(mem.get('a1')).toEqual({ name: 'DOCS-HELPER', cwd: '/dev/p/a1', sessionId: 'sid-a1', light: true });
    expect(mem.get('b2')?.light).toBe(false);
  });
  it('꺼져서 목록에서 빠져도 기억은 남는다', () => {
    const mem = new Map<string, TabSess>();
    rememberTabSessions(mem, [live('a1', 'x')], (s) => s.name, () => false);
    rememberTabSessions(mem, [] as ReturnType<typeof live>[], (s) => s.name, () => false);
    expect(mem.get('a1')?.name).toBe('x');
  });
});

describe('deadTab — 꺼진 세션 탭의 이름과 이어서 켤 대상', () => {
  it('기억한 이름을 그대로 쓴다(꺼져도 이름이 보인다)', () => {
    const mem = new Map<string, TabSess>([['a1', { name: 'shop', cwd: '/dev/p/a1', sessionId: 'sid-a1', light: false }]]);
    expect(deadTab('a1', mem, [stopped('a1')])).toMatchObject({ name: 'shop', resume: { id: 'a1' } });
  });
  it('기억이 없으면 꺼진 세션 목록의 이름으로', () => {
    expect(deadTab('a1', new Map(), [stopped('a1', 'sid-a1', 'review-bot')]).name).toBe('review-bot');
  });
  it('짧은 id 가 달라도(대화 id 같음) 이어서 켤 대상을 찾는다', () => {
    const mem = new Map<string, TabSess>([['a1', { name: 'shop', cwd: '/dev/p/a1', sessionId: 'sid-a1', light: false }]]);
    expect(deadTab('a1', mem, [stopped('zz', 'sid-a1')]).resume?.id).toBe('zz');
  });
  it('목록에서 지워진(claude rm) 세션은 이어서 켤 대상이 없다 — 이름은 기억대로', () => {
    const mem = new Map<string, TabSess>([['a1', { name: 'shop', cwd: '/dev/p/a1', sessionId: 'sid-a1', light: false }]]);
    expect(deadTab('a1', mem, [])).toEqual({ name: 'shop', resume: undefined });
  });
  it('아무 데도 없으면 이름 null — 화면이 대신 말을 고른다', () => {
    expect(deadTab('a1', new Map(), []).name).toBeNull();
  });
});

describe('goneLightTabs — 꺼진 도우미·예약 세션 탭은 저절로 닫는다', () => {
  const mem = new Map<string, TabSess>([
    ['h1', { name: 'docs-helper', cwd: '/hq', sessionId: 'sid-h1', light: true }],
    ['p1', { name: 'shop', cwd: '/dev/p/p1', sessionId: 'sid-p1', light: false }],
  ]);
  it('살아 있는 목록에 없는 도우미 세션 탭만 고른다(프로젝트 세션 탭은 남긴다)', () => {
    expect(goneLightTabs(['s:h1', 's:p1', '/a/b.md', 'c:/x.html'], new Set(), mem)).toEqual(['s:h1']);
  });
  it('아직 살아 있으면 안 닫는다', () => {
    expect(goneLightTabs(['s:h1'], new Set(['h1']), mem)).toEqual([]);
  });
  it('살아 있는 걸 본 적 없는 세션(기억 없음)은 손대지 않는다 — 목록을 아직 못 받았을 때 헛닫힘 방지', () => {
    expect(goneLightTabs(['s:zz'], new Set(), mem)).toEqual([]);
  });
});
