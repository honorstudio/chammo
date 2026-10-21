// 채팅의 Enter 다시 넣기·입력칸 보내기가 치기 줄(typeQueue·Rust TYPE_LOCK)을 안 거치고 pty 에 바로 '\r' 을 써서,
// 다른 글(카드 답·[앱] 줄·새 말)을 치는 중간에 Enter 가 박혀 반만 보내졌다(2026-10-21 리뷰 ②-8)
import { describe, expect, it } from 'vitest';
import { enterTask, typeQueue } from './chatQueue';

const RULE = '─'.repeat(20);
const screenOf = (input: string) => ({ lines: ['답', RULE, `❯ ${input}`, RULE], cursor: [2, 2 + input.length] as [number, number] });

describe('enterTask — 치기 줄 안에서, 칠 때 입력칸을 다시 보고 Enter', () => {
  it('앞 치기가 끝난 뒤에 친다', async () => {
    const log: string[] = [];
    let input = '';
    const api = { screen: () => screenOf(input), type: async (keys: string[]) => { for (const k of keys) { if (k === '\r') log.push(`enter:${input}`); else { input += k; log.push(k); await new Promise((r) => setTimeout(r, 5)); } } } };
    const q = typeQueue();
    void q.push('s', () => api.type(['가', '나', '다']));
    await q.push('s', enterTask(api));
    expect(log).toEqual(['가', '나', '다', 'enter:가나다']);
  });
  it('기대한 말이 입력칸에 그대로일 때만 — 그새 다른 글이 들어왔으면 안 친다', async () => {
    const sent: string[][] = [];
    const api = (input: string) => ({ screen: () => screenOf(input), type: async (k: string[]) => { sent.push(k); } });
    await enterTask(api('도메인 연결 됐어?'), '도메인 연결 됐어?')();
    await enterTask(api('도메인 연결 됐어? [앱] 다른 줄'), '도메인 연결 됐어?')();
    expect(sent).toEqual([['\r']]);
  });
});
