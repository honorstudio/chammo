// 보낼 함 — 연결이 끊겨(TypeError) 답을 못 받은 말은 같은 말 id 로 한 번 더 보낸다(맥은 같은 id 를 한 번만 친다).
// 느린 셀룰러에서 소켓이 먹통이 되면 그 말은 60초 넘게 '보내는 중'이다가 맥에 안 간 채 남았다(2026-10-27 '채팅이 안 간다')
import { afterEach, describe, expect, it, vi } from 'vitest';

const sent: { id: string; text: string; cid?: string }[] = [];
let fails = 1;
vi.mock('../../data/web', () => ({
  sendTextToSession: async (id: string, text: string, cid?: string) => {
    sent.push({ id, text, cid });
    if (fails-- > 0) throw new TypeError('Load failed');
  },
  sendStatus: async () => ({ state: 'unknown' }),
  readTranscriptBefore: async () => ({ text: '', start: 0 }),
}));
vi.mock('../space/useChatItems', () => ({ chatStart: () => undefined }));

afterEach(() => { vi.useRealTimers(); sent.length = 0; });

describe('보낼 함 — 끊겨도 이어 보내기', () => {
  it('망 오류로 끝난 말은 잠시 뒤 같은 id 로 한 번 더 보낸다', async () => {
    vi.useFakeTimers();
    fails = 1;
    const { sendOut } = await import('./outbox');
    const r = await sendOut('aaaa0001', '안녕');
    expect(r.ok).toBe(true);
    expect(sent.length).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.length).toBe(2);
    expect(sent[1]!.cid).toBe(sent[0]!.cid);
    expect(sent[1]!.cid).toBe(r.id);
  });
  it('다시 보내기도 끊기면 더 안 보낸다(그다음은 맥에 묻기 — send-status)', async () => {
    vi.useFakeTimers();
    fails = 5;
    const { sendOut } = await import('./outbox');
    await sendOut('aaaa0001', '두 번째');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.filter((s) => s.text === '두 번째').length).toBe(2);
  });
});
