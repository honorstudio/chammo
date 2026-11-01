import { describe, expect, it } from 'vitest';
import { replyInbox } from './inboxReply';

// 2026-11-01 ux-daily M15·M16 — 결정 대기함 답장이 실패해도 친 글이 지워졌고(실패를 삼킴),
// 폰에서 이미 답한 결정을 데스크톱이 확인 없이 또 쳤다(폰은 /api/task-answer 가 '아직 기다리나'부터 본다)
const run = (o: Partial<Parameters<typeof replyInbox>[0]> = {}) => {
  const log: string[] = [];
  const p = replyInbox({
    why: null, taskId: 't1',
    waiting: async () => { log.push('check'); return true; },
    send: async () => { log.push('send'); },
    record: async () => { log.push('record'); },
    dismiss: () => { log.push('dismiss'); },
    ...o,
  });
  return { p, log };
};

describe('replyInbox — 결정 대기함 답장', () => {
  it('기다리는지 보고 → 치고 → 기록', async () => {
    const { p, log } = run();
    await p;
    expect(log).toEqual(['check', 'send', 'record']);
  });
  it('작업 id 가 없는 물음(참모 물어봄)은 확인·기록 없이 치고 치운다', async () => {
    const { p, log } = run({ taskId: undefined });
    await p;
    expect(log).toEqual(['send', 'dismiss']);
  });
  it('답장을 못 넣는 까닭(선택지 창 등)이 있으면 안 치고 실패로 돌려준다 — 부른 쪽이 글을 남긴다', async () => {
    const { p, log } = run({ why: '확인창이 떠 있어' });
    await expect(p).rejects.toThrow('확인창이 떠 있어');
    expect(log).toEqual([]);
  });
  it('이미 답한 결정(폰·다른 참모)이면 안 친다', async () => {
    const { p, log } = run({ waiting: async () => false });
    await expect(p).rejects.toThrow('이미 답했어요');
    expect(log).toEqual([]);
  });
  it('치다 실패하면 기록하지 않고 실패로 — 카드가 남는다', async () => {
    const { p, log } = run({ send: async () => { throw new Error('세션 없음'); } });
    await expect(p).rejects.toThrow('세션 없음');
    expect(log).toEqual(['check']);
  });
});
