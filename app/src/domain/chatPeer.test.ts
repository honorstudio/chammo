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
