import { describe, expect, it } from 'vitest';
import { applyQueueOps, emptyQueue, inQueue, LOST_AFTER, markOutcome, PENDING_MS, pendingState, pendMark, waitingOf, type PendingMsg, type QueueState } from './chatQueue';
import { errorTurns, parseChat } from './chat';
import { applyStatus, LOST_AFTER as PHONE_LOST_AFTER, type OutMsg } from './mobileOutbox';

// 11-17 사용자: "아예 안되면 다시보내야하는경우는 … 바깥쪽 … 점표시된쪽에 표시되는게 맞을듯 … 그 시점을 언제로 정해야할지 모르겠는데
// 이게 에러로 보통 클로드에서 문제가 생기는경우가 많긴한데" — '못 갔다'로 볼 때를 넷으로 정한다(참모 지시 1117-1526-404e)
const T0 = Date.parse('2026-11-17T06:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const op = (operation: string, ms: number, content?: string) =>
  JSON.stringify({ type: 'queue-operation', operation, timestamp: iso(ms), sessionId: 's', ...(content === undefined ? {} : { content }) });
const W = 300; // enterWait
const mark = (p: PendingMsg & { since?: number }, c: { queue?: QueueState; termText?: string; now: number; link?: 'live' | 'gone' | 'attaching' }) => {
  const queue = c.queue ?? emptyQueue;
  const st = pendingState(p, { queue, termText: c.termText ?? '', now: c.now, enterWait: W, link: c.link ?? 'live' });
  return { st, mark: pendMark(st, p, { queue, now: c.now, enterWait: W }) };
};

describe('① 세션이 죽었거나 꺼졌는데 대기열에도 기록에도 없다 → 바로 실패', () => {
  const p = { text: '이건 안 갈 말', at: T0 };
  it('끊김이 굳은(gone) 세션 — 30초를 안 기다리고 바로', () => {
    expect(mark(p, { now: T0 + 2000, link: 'gone' })).toEqual({ st: 'lost', mark: 'failed' });
  });
  it('죽기 전에 대기열에 줄 섰으면 실패가 아니다(그 말은 대기열에 있다)', () => {
    const queue = applyQueueOps(emptyQueue, op('enqueue', T0 + 300, '이건 안 갈 말'));
    expect(mark(p, { now: T0 + 2000, link: 'gone', queue }).mark).toBe('unread');
  });
  it('다시 붙는 중(attaching)은 실패가 아니다 — 붙으면 앱이 친다', () => {
    expect(mark(p, { now: T0 + 5 * 60_000, link: 'attaching' }).mark).toBe('unread');
  });
});

describe('② 세션은 살아 있는데 입력칸에 넣기가 재시도 뒤에도 실패(landed=false + 입력칸에 그대로) → 실패', () => {
  const p = { text: '걸린 말', at: T0 };
  it('Rust 가 Enter·다시 치기까지 해 보고 stuck 을 돌려주면 30초를 안 기다리고 바로 다시 보내기', () => {
    const [q] = markOutcome([p], T0, 'stuck');
    expect(mark(q!, { now: T0 + W + 1500, termText: '걸린 말' }).mark).toBe('failed');
  });
  it('입력칸 사본이 엉켜 화면에 안 보여도(lost 로 읽혀도) stuck 이면 실패', () => {
    const [q] = markOutcome([p], T0, 'stuck');
    expect(mark(q!, { now: T0 + W + 1500 }).mark).toBe('failed');
  });
  it('stuck 이어도 그 뒤 대기열에 줄 섰으면(사람이 터미널에서 Enter) 실패가 아니다', () => {
    const [q] = markOutcome([p], T0, 'stuck');
    const queue = applyQueueOps(emptyQueue, op('enqueue', T0 + 5000, '걸린 말'));
    expect(mark(q!, { now: T0 + 6000, queue }).mark).toBe('unread');
  });
  it('기록에 들어간 게 확인된 말(landed)은 채팅 기록 읽기가 늦어도 30초에 실패로 안 바뀐다 — 다시 보내면 두 번 간다', () => {
    const [q] = markOutcome([p], T0, 'landed');
    expect(mark(q!, { now: T0 + 2 * 60_000 }).mark).toBe('unread');
  });
  it('landed 여도 3분 넘게 어디에도 없으면(대기열에서 취소됨) 실패, 입력칸에 되돌아왔으면(↑) 입력칸 규칙대로', () => {
    const [q] = markOutcome([p], T0, 'landed');
    expect(mark(q!, { now: T0 + 4 * 60_000 }).mark).toBe('failed');
    expect(mark(q!, { now: T0 + W + LOST_AFTER + 1000, termText: '걸린 말' }).mark).toBe('failed');
  });
  it('훅이 도는 중(inflight)은 3분까지 실패가 아니다 — 11-10~12 landed=false 31번이 전부 늦게 들어갔다', () => {
    const [q] = markOutcome([p], T0, 'inflight');
    expect(mark(q!, { now: T0 + 2 * 60_000 }).mark).toBe('unread');
  });
  it('결과를 모를 때(윈도우·기록 못 찾음)는 예전대로 30초', () => {
    expect(mark(p, { now: T0 + W + LOST_AFTER - 1000 }).mark).toBe('unread');
    expect(mark(p, { now: T0 + W + LOST_AFTER + 1000 }).mark).toBe('failed');
  });
});

describe('③ 세션이 살아 있고 대기열에 줄 섰으면 시간이 아무리 지나도 실패가 아니다', () => {
  const p = { text: '긴 일 뒤에 줄 선 말', at: T0, since: T0 - 10_000 };
  const queue = applyQueueOps(emptyQueue, op('enqueue', T0 + 300, '긴 일 뒤에 줄 선 말'));
  it('10분이 지나도 줄 서 있음 — 작은 점', () => {
    expect(mark(p, { now: T0 + 10 * 60_000 + 1, queue })).toEqual({ st: 'queued', mark: 'unread' });
  });
  it('한 시간 넘게 줄 서 있어도 말풍선이 사라지지 않는다(PENDING_MS 는 줄 서지 않은 말만)', () => {
    expect(waitingOf([p], [], T0 + PENDING_MS + 60_000, queue)).toEqual([p]);
    expect(waitingOf([p], [], T0 + PENDING_MS + 60_000, emptyQueue)).toEqual([]);
  });
  it('inQueue — 보낸 말이 대기열에 있나', () => {
    expect(inQueue(queue, p)).toBe(true);
    expect(inQueue(emptyQueue, p)).toBe(false);
  });
});

describe('④ Claude 쪽 오류로 그 말 턴이 끝남 → 갔지만 답을 못 받음', () => {
  let n = 0;
  const user = (text: string, ms: number) => JSON.stringify({ type: 'user', uuid: `u${n++}`, timestamp: iso(ms), origin: { kind: 'human' }, message: { role: 'user', content: text } });
  const said = (text: string, ms: number) => JSON.stringify({ type: 'assistant', uuid: `a${n++}`, timestamp: iso(ms), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
  const tool = (ms: number) => JSON.stringify({ type: 'assistant', uuid: `a${n++}`, timestamp: iso(ms), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command: 'ls' } }] } });
  // Claude Code 가 남기는 오류 줄 — isApiErrorMessage + 모델 <synthetic>(2.1.3xx 실측 모양)
  const apiErr = (text: string, ms: number, error?: string) => JSON.stringify({ type: 'assistant', uuid: `e${n++}`, timestamp: iso(ms), isApiErrorMessage: true, ...(error ? { error } : {}), message: { role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text }] } });
  const turns = (...lines: string[]) => { const items = parseChat(lines.join('\n')); return { items, err: errorTurns(items) }; };
  const idOf = (items: ReturnType<typeof parseChat>, text: string) => items.find((i) => i.kind === 'user' && i.text === text)!.id;

  it('과부하(529) 오류가 그 말 바로 뒤 — 다시 보내기', () => {
    const { items, err } = turns(user('첫 말', T0), said('답', T0 + 1000), user('이 말', T0 + 5000), apiErr('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', T0 + 9000));
    expect([...err]).toEqual([[idOf(items, '이 말'), 'retry']]);
  });
  it('한도(rate limit)·서버 오류도 다시 보내기', () => {
    for (const e of ['API Error: 429 rate_limit_error', "You've hit your session limit · resets 3pm", 'API Error: 500 {"type":"error","error":{"type":"api_error"}}']) {
      const { items, err } = turns(user('이 말', T0), apiErr(e, T0 + 1000));
      expect(err.get(idOf(items, '이 말'))).toBe('retry');
    }
  });
  it('로그인 풀림·약관이면 다시 보내기가 아니라 로그인 카드 흐름(login)', () => {
    for (const e of ['Login expired · Please run /login', 'Not logged in · Please run /login', "API Error: 400 We've updated our Consumer Terms and Privacy Policy. You'll need to accept them in claude.ai with the email in /status to continue."]) {
      const { items, err } = turns(user('이 말', T0), apiErr(e, T0 + 1000));
      expect(err.get(idOf(items, '이 말'))).toBe('login');
    }
  });
  it('답이 온 말은 아니다 — 오류 뒤 같은 말을 다시 보내 답을 받으면 앞 말도 표시가 빠진다', () => {
    expect(turns(user('이 말', T0), said('답', T0 + 1000)).err.size).toBe(0);
    expect(turns(user('이 말', T0), apiErr('API Error: 529 overloaded', T0 + 1000), user('이 말', T0 + 5000), said('답', T0 + 6000)).err.size).toBe(0);
  });
  it('도구를 돌린 뒤 난 오류는 아니다 — 같은 말을 다시 보내면 한 일을 처음부터 또 한다(이어서는 사람이 정한다)', () => {
    expect(turns(user('이 말', T0), tool(T0 + 1000), apiErr('API Error: 529 overloaded', T0 + 9000)).err.size).toBe(0);
  });
  it('오류 줄이 아닌 같은 글(답이 "API Error" 를 설명)은 아니다', () => {
    expect(turns(user('이 말', T0), said('API Error: 529 는 과부하라는 뜻이야', T0 + 1000)).err.size).toBe(0);
  });
  it('오류 바로 앞 말 하나만 — 그 앞 말(앞 턴에 흡수된 말·멈춘 말)은 안 잡는다', () => {
    const { items, err } = turns(user('하나', T0), user('둘', T0 + 500), apiErr('API Error: 529 overloaded', T0 + 1000));
    expect([...err.keys()]).toEqual([idOf(items, '둘')]);
  });
  it('Claude 가 다시 해 보며 오류 줄을 여러 번 남겨도 그 말', () => {
    const { items, err } = turns(user('이 말', T0), apiErr('API Error: 529 overloaded', T0 + 1000), apiErr('API Error: 529 overloaded', T0 + 2000));
    expect([...err.keys()]).toEqual([idOf(items, '이 말')]);
  });
});

describe('폰 보낼 함 — 줄 선 말은 10분이 지나도 전해지지 않음이 아니다', () => {
  const m: OutMsg = { id: 'm1', session: 's1', text: '긴 일 뒤에 줄 선 말', at: T0, status: 'sent' };
  const now = T0 + PHONE_LOST_AFTER + 60_000;
  it('맥은 쳤다(done)·일하는 중·대기열에 있음 → 기다린다', () => {
    expect(applyStatus([m], 'm1', 'done', undefined, now, true, undefined, true)[0]!.status).toBe('sent');
  });
  it('대기열에 없으면 예전대로 10분 뒤 전해지지 않음', () => {
    expect(applyStatus([m], 'm1', 'done', undefined, now, true, undefined, false)[0]!.status).toBe('failed');
  });
  it('맥이 못 쳤다(failed)면 대기열과 상관없이 실패 — 대기열의 같은 글은 앞서 간 말이다', () => {
    expect(applyStatus([m], 'm1', 'failed', '대화창에 들어가지 못했어요', T0 + 20_000, true, undefined, false)[0]!.status).toBe('failed');
  });
});
