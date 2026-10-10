// 훅이 느리면 기록이 늦게 써진다 — 부하가 높던 날 UserPromptSubmit 훅이 18~21초 걸려, 보낸 말의 user 줄·enqueue 줄이 그만큼 늦게 붙었다
// (시각은 보낸 때로 찍힌다). 10초 만에 '안 갔어요'로 넘어가 사용자가 다시 보냈고, 다시 보낸 말풍선은 늦게 붙은 첫 기록(옛 시각)과 안 맞아 남았다(2026-10-10)
import { describe, expect, it } from 'vitest';
import { parseChat, pendingLeft } from './chat';
import { emptyQueue, LOST_AFTER, pendingState, resent } from './chatQueue';

const T0 = Date.parse('2026-10-10T11:56:53Z');
const MSG = '쉬고 있는 시험 세션들 정리해 줘';

describe('pendingState — 기록이 훅 때문에 20초 늦게 붙어도 그 사이엔 보내는 중', () => {
  it('보낸 지 21초, 아직 기록·대기열·입력칸 어디에도 없음 → 보내는 중', () => {
    expect(pendingState({ text: MSG, at: T0 }, { queue: emptyQueue, termText: '', now: T0 + 21_000, enterWait: 400 })).toBe('sending');
  });
  it('그래도 끝없이 기다리진 않는다 — 넉넉히 지나면 안 갔어요', () => {
    expect(pendingState({ text: MSG, at: T0 }, { queue: emptyQueue, termText: '', now: T0 + LOST_AFTER + 1000, enterWait: 400 })).toBe('lost');
  });
});

describe('resent — 다시 보낸 말풍선은 처음 보낸 때 뒤 기록과도 맞춘다', () => {
  it('처음 보낸 말의 기록이 다시 보낸 뒤에 (옛 시각으로) 붙어도 지워진다', () => {
    const again = resent({ text: MSG, at: T0 }, T0 + 27_000);
    expect(again.at).toBe(T0 + 27_000);
    const items = parseChat(JSON.stringify({ type: 'user', uuid: 'u1', timestamp: new Date(T0).toISOString(), message: { role: 'user', content: MSG } }));
    expect(pendingLeft([again], items, T0 + 30_000)).toEqual([]);
  });
  it('입력칸에 되돌아온 말(since)은 그 since 를 그대로 — 그 앞 기록은 안 친다', () => {
    const back = { text: MSG, at: T0, since: T0 + 5000 };
    expect(resent(back, T0 + 9000).since).toBe(T0 + 5000);
  });
});
