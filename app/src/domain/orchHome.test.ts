import { describe, expect, it } from 'vitest';
import type { Session } from './session';
import type { StoppedSession } from './stopped';
import type { Activity } from './activity';
import { homeAction, homeRows, resumedOrch, showHome, whenLabel } from './orchHome';

const live = (id: string, name: string): Session => ({ id, name, cwd: '/hq', kind: 'background', state: 'idle', project: 'hq', workspace: null, startedAt: 0, sessionId: `s-${id}` });
const off = (id: string, name: string, startedAt = 0): StoppedSession => ({ id, sessionId: `s-${id}`, name, cwd: '/hq', project: 'hq', workspace: null, reason: 'stopped', startedAt });
const T = (iso: string) => Date.parse(iso);

// 2026-10-03 사용자: 참모가 없을 때 앱이 스스로 켜지 말고, 오케스트레이터 홈에서 어떤 참모를 켤지 고르게
describe('showHome — 오케스트레이터 홈이 뜨는 조건', () => {
  it('참모가 하나도 안 떠 있으면 홈', () => {
    expect(showHome({ live: 0, picked: false })).toBe(true);
  });
  it('참모가 떠 있으면 평소 화면(채팅·대시보드)', () => {
    expect(showHome({ live: 2, picked: false })).toBe(false);
  });
  it('떠 있어도 사이드바 오케스트레이터 머리를 눌렀으면 홈', () => {
    expect(showHome({ live: 2, picked: true })).toBe(true);
  });
});

describe('homeRows — 홈 줄: 켜진 참모 위, 꺼진 참모는 마지막으로 일한 때 최근 순', () => {
  const activity: Record<string, Activity> = {
    's-b': { prompt: { ts: '2026-10-02T10:00:00Z', text: 'todo-api PR 머지해' }, reply: { ts: '2026-10-02T10:05:00Z', text: '머지했어' } },
    's-c': { prompt: { ts: '2026-10-02T12:00:00Z', text: '나스 백업 확인해' } },
  };
  const ctx = { 's-b': { used: 42, ts: 0 }, 's-a': { used: 7, ts: 0 } };

  it('켜진 참모는 순서대로 위에, 꺼진 참모는 마지막으로 일한 때가 최근인 것부터', () => {
    const r = homeRows({ live: [live('a', '참모')], off: [off('b', '참모-2'), off('c', '참모-3')], activity, ctx });
    expect(r.live.map((x) => x.live?.id)).toEqual(['a']);
    expect(r.off.map((x) => x.off?.id)).toEqual(['c', 'b']);
  });

  it('꺼진 줄: 마지막으로 일한 때 = 기록의 마지막 시각, 하던 일 = 마지막 지시, 컨텍스트 %', () => {
    const r = homeRows({ live: [], off: [off('b', '참모-2')], activity, ctx });
    expect(r.off[0]).toMatchObject({ lastAt: T('2026-10-02T10:05:00Z'), doing: 'todo-api PR 머지해', ctx: 42 });
  });

  // roadmap 오케스트레이터 홈 ③ — 다른 세션이 SendMessage 로 건 말은 meta 줄이라 안 잡혀 마지막 답이 나왔다
  it('사람 지시보다 늦게 온 다른 세션 메시지(SendMessage)면 그게 하던 일 — 감싼 글 말고 본문', () => {
    const a: Record<string, Activity> = { 's-b': { prompt: { ts: '2026-10-02T10:00:00Z', text: '옛 지시' }, peer: { ts: '2026-10-02T10:03:00Z', text: 'PR 올리고 회신해' }, reply: { ts: '2026-10-02T10:04:00Z', text: '알았어' } } };
    expect(homeRows({ live: [], off: [off('b', '참모-2')], activity: a, ctx: {} }).off[0]!.doing).toBe('PR 올리고 회신해');
    a['s-b']!.prompt = { ts: '2026-10-02T10:05:00Z', text: '새 지시' };
    expect(homeRows({ live: [], off: [off('b', '참모-2')], activity: a, ctx: {} }).off[0]!.doing).toBe('새 지시');
  });

  it('지시가 없으면 마지막 답, 기록이 아예 없으면 하던 일은 비우고 시각은 세션 시작 때', () => {
    const r = homeRows({ live: [], off: [off('d', '참모-4', 1000), off('e', '참모-5', 500)], activity: { 's-d': { reply: { ts: '', text: '준비됐어' } } }, ctx: {} });
    expect(r.off.find((x) => x.off?.id === 'd')).toMatchObject({ doing: '준비됐어', lastAt: 1000 });
    expect(r.off.find((x) => x.off?.id === 'e')).toMatchObject({ doing: '', lastAt: 500 });
  });
});

// 2026-10-03 부채(feature/orch-home ①②)
describe('homeRows — 이어 켜기만 한 참모·상태줄 파일 없는 대화', () => {
  const old = { 's-f': { prompt: { ts: '2026-10-02T10:00:00Z', text: '옛 일' } } };
  it('① 이어 켜고 일을 안 시켰으면 마지막으로 켠 때(세션 시작)가 기록보다 늦다 — 그 시각, 그 순서', () => {
    const r = homeRows({ live: [], off: [off('f', '참모-6', T('2026-10-03T09:00:00Z')), off('g', '참모-7', 0)], activity: { ...old, 's-g': { prompt: { ts: '2026-10-02T12:00:00Z', text: '다른 일' } } }, ctx: {} });
    expect(r.off.map((x) => [x.off?.id, x.lastAt])).toEqual([['f', T('2026-10-03T09:00:00Z')], ['g', T('2026-10-02T12:00:00Z')]]);
  });
  const sized = { 's-other': { used: 10, ts: 0, modelId: 'claude-opus-5-5', size: 1_000_000 } };
  it('② 상태줄 파일이 없으면 기록의 마지막 토큰 ÷ 같은 모델 창 크기(다른 대화 상태줄에서)', () => {
    const r = homeRows({ live: [], off: [off('f', '참모-6')], activity: { 's-f': { ...old['s-f'], tokens: 746_368, model: 'claude-opus-5-5' } }, ctx: sized });
    expect(r.off[0]!.ctx).toBe(75);
  });
  it('② 창 크기를 모르는 모델이면 짐작하지 않고 비운다', () => {
    const r = homeRows({ live: [], off: [off('f', '참모-6')], activity: { 's-f': { tokens: 90_000, model: 'claude-new-9' } }, ctx: sized });
    expect(r.off[0]!.ctx).toBeUndefined();
  });
  it('② 상태줄 파일이 있으면 그 값이 먼저', () => {
    const r = homeRows({ live: [], off: [off('f', '참모-6')], activity: { 's-f': { tokens: 746_368, model: 'claude-opus-5-5' } }, ctx: { ...sized, 's-f': { used: 12, ts: 0 } } });
    expect(r.off[0]!.ctx).toBe(12);
  });
});

describe('homeRows — 하던 일에서 사람 말이 아닌 줄은 뺀다', () => {
  it('[Request interrupted …] 같은 끊김 표시는 지시가 아니다 — 마지막 답으로', () => {
    const r = homeRows({ live: [], off: [off('b', '참모-2')], activity: { 's-b': { prompt: { ts: '2026-10-02T10:00:00Z', text: '[Request interrupted by user for tool use]' }, reply: { ts: '2026-10-02T09:59:00Z', text: 'PR 올렸어' } } }, ctx: {} });
    expect(r.off[0]!.doing).toBe('PR 올렸어');
  });
});

describe('homeAction — 줄을 누르면 그 참모만', () => {
  it('켜진 참모는 그리로 간다', () => {
    const r = homeRows({ live: [live('a', '참모')], off: [], activity: {}, ctx: {} });
    expect(homeAction(r.live[0]!)).toEqual({ kind: 'go', id: 'a' });
  });
  it('꺼진 참모는 그 세션 하나만 이어서 켠다(다른 꺼진 참모는 안 건드린다)', () => {
    const r = homeRows({ live: [], off: [off('b', '참모-2'), off('c', '참모-3')], activity: {}, ctx: {} });
    const pickB = r.off.find((x) => x.off?.id === 'b')!;
    expect(homeAction(pickB)).toEqual({ kind: 'resume', session: off('b', '참모-2') });
  });
});

describe('resumedOrch — 이어서 켠 참모가 살아 있는 목록에 뜨면 그 id(그때 그 참모 채팅으로 간다)', () => {
  it('같은 대화(sessionId)가 뜨면 그 세션 id', () => {
    expect(resumedOrch('s-b', [live('a', '참모'), live('b', '참모-2')])).toBe('b');
  });
  it('아직 안 떴거나 기다리는 게 없으면 없음', () => {
    expect(resumedOrch('s-b', [live('a', '참모')])).toBeUndefined();
    expect(resumedOrch(null, [live('b', '참모-2')])).toBeUndefined();
  });
});

describe('whenLabel — 마지막으로 일한 때', () => {
  const now = new Date(2026, 9, 3, 15, 0).getTime();
  it('방금 · 분 · 시간 · 어제 · 며칠 · 날짜', () => {
    expect(whenLabel(now - 20_000, now)).toBe('방금');
    expect(whenLabel(now - 5 * 60_000, now)).toBe('5분 전');
    expect(whenLabel(now - 3 * 3_600_000, now)).toBe('3시간 전');
    expect(whenLabel(new Date(2026, 9, 2, 9, 0).getTime(), now)).toBe('어제');
    expect(whenLabel(new Date(2026, 8, 30, 9, 0).getTime(), now)).toBe('3일 전');
    expect(whenLabel(new Date(2026, 8, 1, 9, 0).getTime(), now)).toBe('9월 1일');
  });
  it('시각을 모르면 빈 글', () => {
    expect(whenLabel(0, now)).toBe('');
  });
});
