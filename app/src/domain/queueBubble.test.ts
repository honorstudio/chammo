import { describe, expect, it } from 'vitest';
import { applyQueueOps, emptyQueue, LOST_AFTER, newPending, pendingState, pendMark, waitingOf, type QueueState } from './chatQueue';
import { dropRescued, type ChatItem } from './chat';

// 2026-11-17 사용자: 일하는 중에 보낸 말이 점선 상자 + '대기 중 · 참모가 지금 단계를 마치면 들어가요' + 보내기·지우기 단추로 떠
// 아직 안 간 것처럼 보였다. CLI 는 보낸 말이 그냥 내 말 줄로 쌓이고, 일하는 중 표시는 그 밑에 있다 — 앱도 그렇게.
const T = (s: number) => `2026-11-17T05:46:${String(s).padStart(2, '0')}.000Z`;
const at = (s: number) => Date.parse(T(s));
const op = (operation: string, ts: string, content?: string) =>
  JSON.stringify({ type: 'queue-operation', operation, timestamp: ts, sessionId: 's', ...(content === undefined ? {} : { content }) });

describe('그림 붙인 말도 줄 서면 대기열에 든 것 — 기록 앞에 그림 경로가 붙어 온다', () => {
  // 실제 기록(05:46:58): 앱이 그림 경로를 먼저 붙이고 '#img1 #img2 자 봐봐' 를 쳤다 — 대기열 글은 경로 + 말.
  // 같은 글만 찾아서 대기열을 못 알아보고 30초 뒤 '전달 안 됨 + 다시 보내기' 가 떴다(CLI 엔 줄 서 있었다)
  const path = '/Users/me/Documents/보관함/스크린샷/스크린샷\\ 2026-11-17\\ 오후\\ 2.46.46.png';
  const q: QueueState = applyQueueOps(emptyQueue, op('enqueue', T(58), `${path} ${path} #img1 #img2 자 봐봐`));
  it('경로가 앞에 붙은 대기열 글도 그 말이다 — 한참 지나도 대기 중', () => {
    expect(pendingState({ text: '#img1 #img2 자 봐봐', at: at(58) - 300 }, { queue: q, termText: '', now: at(58) + LOST_AFTER * 3, enterWait: 300 })).toBe('queued');
  });
  it('글 일부만 같은 건 아니다 — 끝이 같아야(앞에 붙는 건 그림·경로뿐)', () => {
    expect(pendingState({ text: '자 봐', at: at(58) - 300 }, { queue: q, termText: '', now: at(58) + LOST_AFTER * 3, enterWait: 300 })).toBe('lost');
  });
});

describe('pendMark — 보낸 말은 보통 말풍선, 표시는 작은 점(아직 안 읽음)이나 다시 보내기(끝내 안 감)만', () => {
  const c = { queue: emptyQueue, now: at(40), enterWait: 300 };
  it('보내는 중·줄 섬·다시 붙는 중은 아직 안 읽음 — 작은 점', () => {
    for (const st of ['sending', 'queued', 'wait'] as const) expect(pendMark(st, { text: 'A', at: at(30) }, c)).toBe('unread');
  });
  it('세션이 받았으면(흡수) 표시 없음 — 기록 줄이 따라올 때까지 그냥 말풍선', () => {
    const queue: QueueState = { waiting: [], popped: [], absorbed: [{ text: 'A', ts: at(35) }] };
    expect(pendMark('sending', { text: 'A', at: at(30) }, { ...c, queue })).toBe('none');
  });
  it('어디에도 없음(세션이 죽음 등)은 끝내 안 간 것 — 다시 보내기', () => {
    expect(pendMark('lost', { text: 'A', at: at(1) }, c)).toBe('failed');
  });
  it('입력칸에 걸린 말은 앱이 Enter 를 다시 넣는 동안은 점, 30초 넘게 그대로면 다시 보내기', () => {
    expect(pendMark('input', { text: 'A', at: at(38) }, c)).toBe('unread');
    expect(pendMark('input', { text: 'A', at: at(1) }, { ...c, now: at(1) + 300 + LOST_AFTER })).toBe('failed');
  });
});

describe('dropRescued — 끊고 보내기로 다시 넣은 말은 한 번만 보인다', () => {
  const u = (id: string, s: number, text: string): ChatItem => ({ kind: 'user', id, ts: T(s), text });
  const stop = (id: string, s: number): ChatItem => ({ kind: 'note', id, ts: T(s), text: '멈췄어' });
  const a = (id: string, s: number, text: string): ChatItem => ({ kind: 'assistant', id, ts: T(s), text });
  it('끊긴 턴에 묻힌 말 → 멈췄어 → 같은 말 다시: 앞의 묻힌 말을 뺀다(답은 뒤 말 밑에 붙는다)', () => {
    const items = [u('1', 1, '처음 말'), a('2', 2, '답'), u('3', 10, '묻힌 말'), stop('4', 12), u('5', 13, '묻힌 말'), u('6', 14, '새 말')];
    expect(dropRescued(items).map((i) => i.id)).toEqual(['1', '2', '4', '5', '6']);
  });
  it('멈춘 뒤 한참 지나 사람이 같은 말을 또 보낸 건 그대로 둘 다', () => {
    const items = [u('3', 1, '네'), stop('4', 2), a('5', 30, '다른 답'), u('6', 50, '네')];
    expect(dropRescued(items)).toEqual(items);
  });
  it('멈춤 없이 같은 말 두 번은 그대로', () => {
    const items = [u('1', 1, '네'), a('2', 2, '답'), u('3', 5, '네')];
    expect(dropRescued(items)).toEqual(items);
  });
  it('그림 칩이 앞에 붙어 다시 들어가도 같은 말', () => {
    const items = [u('3', 10, '[Image #4] 이거 봐'), stop('4', 12), u('5', 13, '[Image #4] 이거 봐')];
    expect(dropRescued(items).map((i) => i.id)).toEqual(['4', '5']);
  });
});

describe('일하는 중에 3번 연달아 보내면 보통 말풍선 3개가 보낸 순서대로', () => {
  it('셋 다 줄 서면 셋 다 남고 순서 그대로, 표시는 작은 점뿐 — 한참 지나도 다시 보내기는 안 뜬다', () => {
    const sent = ['하나', '둘', '셋'].map((t, i) => newPending(t, [], at(10 + i)));
    const queue = applyQueueOps(emptyQueue, [op('enqueue', T(10), '하나'), op('enqueue', T(11), '둘'), op('enqueue', T(12), '셋')].join('\n'));
    const now = at(12) + LOST_AFTER * 4;
    const rows = waitingOf(sent, [], now, queue).map((p) => { const st = pendingState(p, { queue, termText: '', now, enterWait: 200 }); return `${p.text}:${st}:${pendMark(st, p, { queue, now, enterWait: 200 })}`; });
    expect(rows).toEqual(['하나:queued:unread', '둘:queued:unread', '셋:queued:unread']);
  });
  it('세션이 하나를 받으면(흡수) 그 말만 점이 사라지고 나머지는 그대로', () => {
    const sent = ['하나', '둘'].map((t, i) => newPending(t, [], at(10 + i)));
    const queue = applyQueueOps(emptyQueue, [op('enqueue', T(10), '하나'), op('enqueue', T(11), '둘'),
      JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: T(20), sessionId: 's', content: '하나', reason: 'absorbed_mid_turn' })].join('\n'));
    const now = at(21);
    expect(sent.map((p) => pendMark(pendingState(p, { queue, termText: '', now, enterWait: 200 }), p, { queue, now, enterWait: 200 }))).toEqual(['none', 'unread']);
  });
});

