import { describe, expect, it } from 'vitest';
import { dashFiles, dashRequests, ownBrowserLine, paneState } from './dashboard';
import type { ChatItem } from './chat';
import type { TaskEvent } from './tasks';

const u = (id: string, ts: string, text: string): ChatItem => ({ kind: 'user', id, ts, text });
const a = (id: string, ts: string, text: string): ChatItem => ({ kind: 'assistant', id, ts, text });
const send = (task: string, ts: string, target: string, title: string, from = 'b1'): TaskEvent => ({ type: 'send', task, ts, target, title, from });

describe('dashRequests — 대시보드 "시킨 일"(사용자 → 참모 요청과 그 아래 맡긴 세션)', () => {
  const items: ChatItem[] = [
    u('u1', '2026-09-30T01:00:00Z', '로그인 화면 정리하고 PR 올려'),
    a('a1', '2026-09-30T01:01:00Z', 'oms 에 맡겼어'),
    u('u2', '2026-09-30T02:00:00Z', '배너 문구 이어서 해줘'),
    a('a2', '2026-09-30T02:05:00Z', '제목은 두 줄로 할까?'),
    u('u3', '2026-09-30T03:00:00Z', '크론 기록 정리 넣자'),
  ];
  const events: TaskEvent[] = [
    send('t1', '2026-09-30T01:00:30Z', 'oms', '로그인 화면 PR'),
    send('t2', '2026-09-30T02:01:00Z', 'shop-app', '배너 문구 이어서'),
    { type: 'done', task: 't2', ts: '2026-09-30T02:30:00Z' },
    send('t9', '2026-09-30T02:01:00Z', 'other', '다른 참모 일', 'b2'),
  ];
  it('최근 요청이 위로. 상태: 답이 물으면 확인 필요 · 답이 없거나 맡긴 일이 안 끝났으면 진행 중 · 아니면 끝남', () => {
    const r = dashRequests(items, events, 'b1');
    expect(r.map((x) => [x.text, x.status])).toEqual([
      ['크론 기록 정리 넣자', 'doing'],
      ['배너 문구 이어서 해줘', 'ask'],
      ['로그인 화면 정리하고 PR 올려', 'doing'], // oms 일이 안 끝났다
    ]);
  });
  it('요청 사이에 이 참모가 맡긴 일이 그 요청 아래(다른 참모 일은 빼고)', () => {
    const r = dashRequests(items, events, 'b1');
    expect(r[1]!.subs).toEqual([{ target: 'shop-app', title: '배너 문구 이어서', done: true }]);
    expect(r[2]!.subs).toEqual([{ target: 'oms', title: '로그인 화면 PR', done: false }]);
  });
  it('맡긴 일이 다 끝나고 답도 했으면 끝남', () => {
    const r = dashRequests(items, [...events, { type: 'done', task: 't1', ts: '2026-09-30T01:30:00Z' }], 'b1');
    expect(r.find((x) => x.text.startsWith('로그인 화면'))!.status).toBe('done');
  });

});

describe('dashFiles — 대시보드 "주고받은 파일"(참모·맡긴 세션이 보여 준 것 + 사용자가 붙인 그림)', () => {
  const log = [
    JSON.stringify({ ts: '2026-09-30T01:00:00Z', path: '/d/a.png', from: 'b1' }),
    JSON.stringify({ ts: '2026-09-30T02:00:00Z', path: '/d/b.html', from: 's1' }),
    JSON.stringify({ ts: '2026-09-30T03:00:00Z', path: '/d/c.md', from: 'zz' }),
  ].join('\n');
  it('이 참모와 맡긴 세션 것만, 최근 순, 누가 보여 줬는지', () => {
    expect(dashFiles(log, 'b1', ['s1'], [])).toEqual([
      { path: '/d/b.html', ts: '2026-09-30T02:00:00Z', by: 's1' },
      { path: '/d/a.png', ts: '2026-09-30T01:00:00Z', by: 'b1' },
    ]);
  });
  it('사용자가 채팅에 붙인 그림도(data URL)', () => {
    const imgs = [{ ts: '2026-09-30T04:00:00Z', src: 'data:image/png;base64,A' }];
    expect(dashFiles(log, 'b1', [], imgs)[0]).toEqual({ path: 'data:image/png;base64,A', ts: '2026-09-30T04:00:00Z', by: 'me' });
  });
});

describe('ownBrowserLine — 참모 자기 브라우저는 위 큰 칸이 아니라 아래 세션 칸 줄 맨 앞 칸 하나로(2026-10-03 사용자 "아래쪽에만")', () => {
  const live = { profile: 'orch', pid: 1, sessionPid: 2, url: 'https://mail.example.com/', title: '메일', tabs: [], tool: '화면 읽기', toolAt: 0, busy: true, ts: 0 };
  it('세션 칸과 같은 모양 — 이름·브라우저·꼬리, 일하는 중이면 run', () => {
    const l = ownBrowserLine('참모-5', { live, tail: ['> 지시'] });
    expect(l).toMatchObject({ name: '참모-5', status: 'run', line: '화면 읽기', tail: ['> 지시'], browser: live });
    expect(l.id.startsWith('orch-web:')).toBe(true);
  });
  it('쉬면 wait(쉼)', () => expect(ownBrowserLine('참모', { live: { ...live, busy: false } }).status).toBe('wait'));
});

// 답하고 다음 지시를 기다리는 살아 있는 세션 칸 머리가 '끝남'이었다 — agents 의 state done 은 '턴 끝'이지 꺼짐이 아니다(2026-10-04 QA N4).
// 꺼진 세션은 목록에서 빠져 따로(끔·끝남 줄) 보인다 — 목록에 있으면 살아 있다
describe('paneState — 대시보드 세션 칸 머리 상태', () => {
  it('재현: 턴을 끝낸(state done) 살아 있는 세션은 끝남이 아니라 지금 상태(쉼)', () => {
    expect(paneState({ finished: true }, { status: 'wait' })).toEqual({ status: 'wait', finished: true });
  });
  it('턴을 끝내고 물어본 세션은 기다림', () => {
    expect(paneState({ finished: true }, { status: 'ask' })).toEqual({ status: 'ask', finished: true });
  });
  it('활동을 아직 못 읽었으면 쉼', () => {
    expect(paneState({ finished: true }, undefined)).toEqual({ status: 'wait', finished: true });
    expect(paneState({}, undefined)).toEqual({ status: 'wait', finished: false });
  });
  it('일하는 세션은 일하는 중', () => {
    expect(paneState({}, { status: 'run' })).toEqual({ status: 'run', finished: false });
  });
});
