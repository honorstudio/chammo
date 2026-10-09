import { describe, expect, it } from 'vitest';
import { applyQueueOps, autoEnterTarget, emptyQueue, ESC_GAP, escPlan, inputLeftover, keepAfterRemove, pendingState, typeQueue, type QueueState } from './chatQueue';
import grid from '../ui/SessionGrid.tsx?raw';
import pane from '../ui/TerminalPane.tsx?raw';
import tauriTs from '../data/tauri.ts?raw';

// 실제 기록 모양(2026-10-06 시험 세션 실측, Claude Code 2.1.291)
const op = (operation: string, ts: string, content?: string, extra: object = {}) =>
  JSON.stringify({ type: 'queue-operation', operation, timestamp: ts, sessionId: 's', ...(content === undefined ? {} : { content }), ...extra });
const T = (s: number) => `2026-10-06T05:00:${String(s).padStart(2, '0')}.000Z`;
const at = (s: number) => Date.parse(T(s));

describe('applyQueueOps — 기록의 줄 서기(queue-operation)로 Claude 대기열을 따라간다', () => {
  it('enqueue 는 뒤에, dequeue 는 맨 앞을 뺀다(dequeue 엔 글이 없다)', () => {
    const q = applyQueueOps(emptyQueue, [op('enqueue', T(1), 'A'), op('enqueue', T(2), 'B'), op('dequeue', T(3))].join('\n'));
    expect(q.waiting.map((x) => x.text)).toEqual(['B']);
  });

  it('remove(일하는 도중 흡수)는 그 글을 뺀다 — 이미 간 것', () => {
    const q = applyQueueOps(emptyQueue, [op('enqueue', T(1), 'A'), op('remove', T(2), 'A', { reason: 'absorbed_mid_turn' })].join('\n'));
    expect(q.waiting).toEqual([]);
    expect(q.popped).toEqual([]);
  });

  it('popAll(↑로 입력칸에 되돌림)은 줄 선 것을 popped 로 옮긴다 — 안 간 것', () => {
    const q = applyQueueOps(emptyQueue, [op('enqueue', T(1), 'A'), op('enqueue', T(2), 'B'), op('popAll', T(3), 'A'), op('popAll', T(3), 'B')].join('\n'));
    expect(q.waiting).toEqual([]);
    expect(q.popped.map((x) => x.text)).toEqual(['A', 'B']);
  });

  it('줄 서기 줄이 없으면 같은 것을 돌려준다(다시 그리지 않게)', () => {
    const q: QueueState = { waiting: [{ text: 'A', ts: 1 }], popped: [] };
    expect(applyQueueOps(q, JSON.stringify({ type: 'user', message: { content: 'x' } }))).toBe(q);
    expect(applyQueueOps(q, '')).toBe(q);
  });

  it('깨진 줄·빈 큐의 dequeue 는 넘어간다', () => {
    const q = applyQueueOps(emptyQueue, ['{"type":"queue-operation"', op('dequeue', T(1))].join('\n'));
    expect(q.waiting).toEqual([]);
  });
});

describe('pendingState — 보낸 말이 지금 어디 있나', () => {
  const base = { queue: emptyQueue, termText: '', now: at(30), enterWait: 400 };

  it('Claude 대기열에 있으면 대기 중', () => {
    const queue = { waiting: [{ text: '첫 토막둘째 토막', ts: at(2) }], popped: [] };
    expect(pendingState({ text: '첫 토막둘째 토막', at: at(1) }, { ...base, queue })).toBe('queued');
  });

  it('보내기 전 예전에 줄 섰던 같은 글은 대기 중으로 안 친다', () => {
    const queue = { waiting: [{ text: '응', ts: at(0) - 60_000 }], popped: [] };
    expect(pendingState({ text: '응', at: at(1) }, { ...base, queue })).toBe('lost');
  });

  it('터미널 입력칸에 남아 있으면 입력칸에 걸림 — 입력칸은 좁아 줄이 접혀 온다', () => {
    expect(pendingState({ text: '도메인은 어떻게 됐어?', at: at(1) }, { ...base, termText: '도메인은 어떻게\n됐어?' })).toBe('input');
  });

  it('↑로 되돌린 여러 줄 입력칸 안에 들어 있어도 입력칸에 걸림', () => {
    expect(pendingState({ text: '빼기B', at: at(1) }, { ...base, termText: '빼기A\n빼기B' })).toBe('input');
  });

  it('막 쳐서 Enter 를 기다리는 동안은 보내는 중', () => {
    expect(pendingState({ text: '안녕', at: at(30) - 500 }, { ...base, termText: '안녕' })).toBe('sending');
  });

  it('기록·대기열·입력칸 어디에도 없으면 잠깐은 보내는 중, 그 뒤엔 안 갔음', () => {
    expect(pendingState({ text: '안녕', at: at(25) }, base)).toBe('sending');
    expect(pendingState({ text: '안녕', at: at(1) }, base)).toBe('lost');
  });
});

describe('autoEnterTarget — Enter 가 사라져 입력칸에 그대로 남은 말에만 Enter 를 다시', () => {
  const ctx = { queue: emptyQueue, now: at(30), enterWait: 400, tries: {} as Record<number, number> };

  it('입력칸이 그 말 하나뿐이면 일하는 중이어도 고른다(일하는 중 Enter 는 줄 서기)', () => {
    expect(autoEnterTarget([{ text: '첫 토막둘째 토막', at: at(1) }], { ...ctx, termText: '첫 토막둘째 토막' })).toBe('첫 토막둘째 토막');
  });

  it('다른 글이 섞여 있으면 안 누른다 — 섞인 채 가 버린다', () => {
    expect(autoEnterTarget([{ text: 'A', at: at(1) }], { ...ctx, termText: 'A 그리고 쓰던 말' })).toBeNull();
  });

  it('↑로 되돌린(popAll) 말은 사람이 고치는 중일 수 있어 안 누른다', () => {
    const queue = { waiting: [], popped: [{ text: 'A', ts: at(3) }] };
    expect(autoEnterTarget([{ text: 'A', at: at(1) }], { ...ctx, queue, termText: 'A' })).toBeNull();
  });

  it('/ 명령·세 번 넘게 누른 말·막 친 말은 안 누른다', () => {
    expect(autoEnterTarget([{ text: '/model', at: at(1) }], { ...ctx, termText: '/model' })).toBeNull();
    expect(autoEnterTarget([{ text: 'A', at: at(1) }], { ...ctx, termText: 'A', tries: { [at(1)]: 3 } })).toBeNull();
    expect(autoEnterTarget([{ text: 'A', at: at(5) }], { ...ctx, termText: 'A', tries: { [at(1)]: 3 } })).toBe('A'); // 같은 말을 나중에 또 보냈으면 새로 센다
    expect(autoEnterTarget([{ text: 'A', at: at(29) }], { ...ctx, termText: 'A' })).toBeNull();
  });

  it('빈 입력칸이면 없음', () => {
    expect(autoEnterTarget([{ text: 'A', at: at(1) }], { ...ctx, termText: '' })).toBeNull();
  });
});

describe('escPlan — 채팅이 넘기는 Esc 를 거른다(Claude 는 쉴 때 Esc 두 번 = 입력칸 지우기, 2026-10-06 실측)', () => {
  it('처음 Esc 는 보낸다', () => {
    expect(escPlan(10_000, 0, 0)).toBe(true);
  });

  it('바로 앞 Esc 와 너무 가까우면 버린다', () => {
    expect(escPlan(10_000, 10_000 - ESC_GAP + 1, 0)).toBe(false);
    expect(escPlan(10_000, 10_000 - ESC_GAP, 0)).toBe(true);
  });

  it('앱이 글을 치는 중(Enter 전)이면 버린다 — 친 글이 Esc 로 지워지거나 되돌려졌다', () => {
    expect(escPlan(10_000, 0, 10_001)).toBe(false);
    expect(escPlan(10_000, 0, 10_000)).toBe(true);
  });
});

describe('inputLeftover — 입력칸에 남은 게 내가 보낸 말뿐인가(다음 말과 합쳐 보내지 않게)', () => {
  it('보낸 말 그대로면 그 말들', () => {
    expect(inputLeftover('첫 토막\n둘째 토막', ['첫 토막둘째 토막'])).toEqual(['첫 토막둘째 토막']);
  });

  it('여러 말이 이어 들어 있어도 다 아는 말이면', () => {
    expect(inputLeftover('빼기A\n빼기B', ['빼기B', '빼기A', '딴말'])).toEqual(['빼기A', '빼기B']);
  });

  it('모르는 글(지구본 키로 받아 적은 말·붙인 그림)이 섞이면 null — 그건 같이 가는 게 맞다', () => {
    expect(inputLeftover('빼기A 그리고', ['빼기A'])).toBeNull();
    expect(inputLeftover('[Image #1] 이거 봐', ['이거 봐'])).toBeNull();
    expect(inputLeftover('', ['A'])).toBeNull();
  });

  it('짧은 말이 긴 말 속에 들어 있어도 긴 말부터 맞춘다', () => {
    expect(inputLeftover('응 그래', ['응', '응 그래'])).toEqual(['응 그래']);
  });
});

describe('keepAfterRemove — 줄 선 말 하나를 빼면 나머지는 다시 줄 세운다', () => {
  it('뺄 말만 빼고 순서대로', () => {
    expect(keepAfterRemove(['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });

  it('같은 말이 두 번이면 하나만 뺀다', () => {
    expect(keepAfterRemove(['A', 'A'], 'A')).toEqual(['A']);
  });
});

// fix/chat-ghost 남은 것 ①: 채팅 치기가 JS setTimeout 으로 창에 바로 써서 Rust TYPE_LOCK(스페이스·카드 답장·폰)과 섞일 수 있었다.
// 이제 실제 치기는 Rust pty_type 이 자물쇠를 잡고, JS 는 세션별로 줄만 세운다(typeQueue)
describe('typeQueue — 세션별 앱 치기 줄', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('앞 것이 다 끝난 뒤에 다음 것 — 앞 것이 느려도 순서 그대로', async () => {
    const q = typeQueue(() => 0);
    const log: string[] = [];
    let release!: () => void;
    void q.push('s', () => new Promise<void>((r) => { log.push('a-start'); release = () => { log.push('a-end'); r(); }; }));
    void q.push('s', async () => { log.push('b'); });
    await tick();
    expect(log).toEqual(['a-start']);
    release();
    await tick(); await tick();
    expect(log).toEqual(['a-start', 'a-end', 'b']);
  });
  it('세션이 다르면 따로 줄', async () => {
    const q = typeQueue(() => 0);
    const log: string[] = [];
    void q.push('s', () => new Promise<void>(() => { log.push('s'); }));
    void q.push('t', async () => { log.push('t'); });
    await tick();
    expect(log).toEqual(['s', 't']);
  });
  it('치는 중엔 busyUntil 이 무한(Esc 를 버린다), 끝나면 끝난 때 + 100', async () => {
    let now = 1000;
    const q = typeQueue(() => now);
    expect(q.busyUntil('s')).toBe(0);
    let done!: () => void;
    const p = q.push('s', () => new Promise<void>((r) => { done = r; }));
    expect(q.busyUntil('s')).toBe(Infinity);
    expect(escPlan(now, 0, q.busyUntil('s'))).toBe(false);
    now = 2000;
    await tick();
    done();
    await p;
    expect(q.busyUntil('s')).toBe(2100);
  });
  it('하나가 실패해도 다음 것은 친다', async () => {
    const q = typeQueue(() => 0);
    const log: string[] = [];
    void q.push('s', async () => { throw new Error('pty gone'); });
    await q.push('s', async () => { log.push('b'); });
    expect(log).toEqual(['b']);
  });
  it('채팅 치기·Esc·지우기는 창에 바로 쓰지 않고 잠그는 길(pty_type)로', () => {
    expect(grid).not.toMatch(/api\.raw\(/);
    expect(grid).toMatch(/api\.type\(/);
    expect(pane).toMatch(/type: \(keys, enterMs\)/);
    expect(tauriTs).toMatch(/invoke<void>\('pty_type'/);
  });
});
