import { describe, expect, it } from 'vitest';
import { directCards, kindView } from './directAsk';

const ask = (id: string, from: string, ts: string, more: object = {}) => JSON.stringify({ ts, type: 'ask', id, from, cwd: '/dev/project-x', q: '결제할까요?', kind: 'pay', yes: '결제 승인', no: '거절', options: [], ...more });
const row = (o: object) => JSON.stringify(o);
const T0 = '2026-10-03T06:00:00Z';
const live = new Set(['a1b2c3d4', 'e5f6a7b8']);
const env = (prompts: Record<string, { ts: string; text: string }> = {}, replies: Record<string, { ts: string; turnEnd?: boolean }> = {}) => ({
  alive: (sid: string) => live.has(sid),
  prompt: (sid: string) => prompts[sid],
  reply: (sid: string) => replies[sid],
});

describe('directCards — 직접 답하기 카드 기록 → 카드와 상태', () => {
  it('답 전엔 기다림', () => {
    const [c] = directCards(ask('c1', 'a1b2c3d4', T0, { amount: 'US$25' }), env());
    expect(c).toMatchObject({ id: 'c1', from: 'a1b2c3d4', state: 'wait', amount: 'US$25', yes: '결제 승인' });
  });
  it('세션이 꺼졌으면 꺼짐(답 못 함)', () => {
    expect(directCards(ask('c1', 'deadbeef', T0), env())[0]!.state).toBe('gone');
  });
  it('답함 → 보냄, 세션 입력에 카드 번호가 든 사람 말이 들어오면 받았음, 세션이 그 뒤 턴을 끝내면 처리됨', () => {
    const log = [ask('c1', 'a1b2c3d4', T0), row({ ts: '2026-10-03T06:01:00Z', type: 'answer', id: 'c1', pick: 'yes', label: '결제 승인', by: 'desktop' })].join('\n');
    expect(directCards(log, env())[0]).toMatchObject({ state: 'sent', answer: { label: '결제 승인', by: 'desktop' } });
    const got = env({ a1b2c3d4: { ts: '2026-10-03T06:01:02Z', text: '결제 승인 — 직접 답(카드 c1) · 사람이 앱 카드에서 눌렀어' } });
    expect(directCards(log, got)[0]!.state).toBe('got');
    const done = env({ a1b2c3d4: { ts: '2026-10-03T06:01:02Z', text: '… 카드 c1 …' } }, { a1b2c3d4: { ts: '2026-10-03T06:03:00Z', turnEnd: true } });
    expect(directCards(log, done)[0]!.state).toBe('done');
  });
  it('세션이 done 을 남기면 처리됨 + 결과 한 줄', () => {
    const log = [ask('c1', 'a1b2c3d4', T0), row({ type: 'answer', id: 'c1', pick: 'yes', ts: T0 }), row({ type: 'done', id: 'c1', note: '결제 완료', ts: T0 })].join('\n');
    expect(directCards(log, env())[0]).toMatchObject({ state: 'done', note: '결제 완료' });
  });
  it('치다 실패하면 실패(다시 누를 수 있음), 세션이 거두면 끝냄, 같은 세션 새 카드면 지난 질문', () => {
    const failed = [ask('c1', 'a1b2c3d4', T0), row({ type: 'answer', id: 'c1', ts: T0 }), row({ type: 'answer-failed', id: 'c1', ts: T0 })].join('\n');
    expect(directCards(failed, env())[0]!.state).toBe('failed');
    expect(directCards([ask('c1', 'a1b2c3d4', T0), row({ type: 'cancel', id: 'c1' })].join('\n'), env())[0]!.state).toBe('closed');
    const two = [ask('c1', 'a1b2c3d4', T0), ask('c2', 'a1b2c3d4', '2026-10-03T06:05:00Z')].join('\n');
    expect(directCards(two, env()).map((c) => [c.id, c.state])).toEqual([['c1', 'old'], ['c2', 'wait']]);
  });
  it('다른 세션 카드는 서로 상관없이 시간 순, 깨진 줄은 건너뜀', () => {
    const log = [ask('c2', 'e5f6a7b8', '2026-10-03T06:02:00Z'), 'nope', ask('c1', 'a1b2c3d4', T0)].join('\n');
    expect(directCards(log, env()).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('kindView — 위험 말과 색', () => {
  it('결제·삭제는 빨강, 발송·운영은 노랑, 로그인은 크게 보기', () => {
    expect(kindView('pay')).toMatchObject({ word: '결제', tone: 'danger' });
    expect(kindView('delete').tone).toBe('danger');
    expect(kindView('send')).toMatchObject({ word: '발송', tone: 'warn' });
    expect(kindView('login').word).toBe('로그인');
    expect(kindView('weird' as never).word).toBe('확인');
  });
});
