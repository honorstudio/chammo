// 다른 기기 참모가 넣은 말(ADR 0007) — 받는 폰 서버가 '[다른 기기 참모 · <기기> · <참모> · peer#<cid>]' 이름표를 붙여 친다.
// 채팅엔 사람 말풍선이 아니라 보낸 쪽 이름이 붙은 줄(relay)로 — 사람이 한 말처럼 안 보이게
import { describe, expect, it } from 'vitest';
import { parseChat, sentByMe } from './chat';

const L = (o: object) => JSON.stringify(o);
const asUser = (text: string) => L({ type: 'user', uuid: 'u1', timestamp: '2026-10-15T11:00:00Z', message: { role: 'user', content: text } });
const asQueued = (text: string) => L({ type: 'attachment', uuid: 'q1', timestamp: '2026-10-15T11:00:00Z', attachment: { type: 'queued_command', prompt: text, origin: { kind: 'human' } } });

describe('다른 기기 참모 말', () => {
  const said = '[다른 기기 참모 · 맥북 · 참모-2 · 영상 · peer#pc-1a2b]\n빌드 됐어?\n› [앱] 이건 인용';
  it('이름표는 보낸 쪽, 꼬리표(peer#)는 숨기고 본문만', () => {
    expect(parseChat(asUser(said))).toEqual([{ kind: 'relay', id: 'u1', ts: '2026-10-15T11:00:00Z', from: '다른 기기 참모 · 맥북 · 참모-2 · 영상', text: '빌드 됐어?\n› [앱] 이건 인용' }]);
  });
  it('일하는 중에 줄 서 들어온 것도', () => {
    expect(parseChat(asQueued(said))[0]).toMatchObject({ kind: 'relay', from: '다른 기기 참모 · 맥북 · 참모-2 · 영상' });
  });
  it('영어 이름표도', () => {
    expect(parseChat(asUser('[Assistant on another device · laptop · peer#pc-9]\nhi'))[0]).toMatchObject({ kind: 'relay', from: 'Assistant on another device · laptop', text: 'hi' });
  });
  it('내가 보낸 말로 세지 않는다', () => {
    expect(sentByMe(parseChat(asUser(said)))).toEqual([]);
  });
  it('꼬리표 없는 비슷한 글은 그냥 사람 말', () => {
    expect(parseChat(asUser('[다른 기기 참모 · 맥북] 안녕'))[0]?.kind).toBe('user');
  });
});

// 짝지은 기기 앱 화면에서 사람이 직접 친 말(ADR 0011) — '[사람 말 · 원격 · <기기>에서 직접 · human#<cid>]' 이름표
describe('원격 사람 말', () => {
  const said = '[사람 말 · 원격 · 맥북에서 직접 · human#h-1a2b]\n그 PC 에서 진행해';
  it('사람 말풍선으로, 이름표는 숨긴다', () => {
    expect(parseChat(asUser(said))).toEqual([{ kind: 'user', id: 'u1', ts: '2026-10-15T11:00:00Z', text: '그 PC 에서 진행해' }]);
  });
  it('일하는 중에 줄 서 들어온 것도', () => {
    expect(parseChat(asQueued(said))[0]).toMatchObject({ kind: 'user', text: '그 PC 에서 진행해' });
  });
  it('영어 이름표도', () => {
    expect(parseChat(asUser('[Person · remote · typed on laptop · human#h-9]\nhi'))[0]).toMatchObject({ kind: 'user', text: 'hi' });
  });
  it('보낸 말로 센다(원격 화면의 보내는 중 맞추기)', () => {
    expect(sentByMe(parseChat(asUser(said))).length).toBe(1);
  });
  it('꼬리표 없는 비슷한 글은 그대로 둔다', () => {
    expect(parseChat(asUser('[사람 말 · 원격 · 맥북에서 직접] 안녕'))[0]).toMatchObject({ kind: 'user', text: '[사람 말 · 원격 · 맥북에서 직접] 안녕' });
  });
});

describe('원격 사람 말 — 보내는 중 맞추기', () => {
  it('받는 서버가 붙인 › 는 사람 말이면 뗀다(보낸 글과 같게)', () => {
    expect(parseChat(asUser('[사람 말 · 원격 · 맥북에서 직접 · human#h-2]\n› [메모] 이거 봐\n› <b>'))[0]).toMatchObject({ kind: 'user', text: '[메모] 이거 봐\n<b>' });
  });
  it('일하는 중 줄 선 말도 이름표 없이 대기열에', async () => {
    const { applyQueueOps, emptyQueue } = await import('./chatQueue');
    const enq = L({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-21T10:00:00Z', content: '[사람 말 · 원격 · 맥북에서 직접 · human#h-3]\n캐시 옮겨' });
    expect(applyQueueOps(emptyQueue, enq).waiting.map((w) => w.text)).toEqual(['캐시 옮겨']);
  });
});
