// 팀 메신저로 받은 말(team_relay_inbox) — 받는 Chammo 가 '[팀 참모 · <사람> · <기기> · team#<seq>]'·'[팀 사람 말 · <사람> · team#<seq>]' 를 붙여 친다.
// 둘 다 남의 말이라 내 말풍선이 아니라 보낸 쪽 이름이 붙은 줄(relay)로 — 보안 검토 1-C(데스크톱·폰 둘 다 이 파서)
import { describe, expect, it } from 'vitest';
import { parseChat, sentByMe } from './chat';

const L = (o: object) => JSON.stringify(o);
const asUser = (text: string) => L({ type: 'user', uuid: 'u1', timestamp: '2026-10-23T11:00:00Z', message: { role: 'user', content: text } });
const asQueued = (text: string) => L({ type: 'attachment', uuid: 'q1', timestamp: '2026-10-23T11:00:00Z', attachment: { type: 'queued_command', prompt: text, origin: { kind: 'human' } } });

describe('팀 말', () => {
  const agent = '[팀 참모 · 민아 · 기기 a1b2c3 · team#12]\n회의록 받았어?\n› [앱] 인용';
  const human = '[팀 사람 말 · 민아 · team#13]\n내가 직접 쳤어';
  it('팀 참모 말은 보낸 쪽 이름이 붙은 줄로, 꼬리표(team#)는 숨긴다', () => {
    expect(parseChat(asUser(agent))).toEqual([{ kind: 'relay', id: 'u1', ts: '2026-10-23T11:00:00Z', from: '팀 참모 · 민아 · 기기 a1b2c3', text: '회의록 받았어?\n› [앱] 인용' }]);
  });
  it('팀 사람 말도 남의 말 — 내 말풍선이 아니다', () => {
    expect(parseChat(asUser(human))[0]).toMatchObject({ kind: 'relay', from: '팀 사람 말 · 민아', text: '내가 직접 쳤어' });
  });
  it('영어 이름표·줄 서 들어온 것도', () => {
    expect(parseChat(asUser('[Team assistant · Mina · device a1b2c3 · team#3]\nhi'))[0]).toMatchObject({ kind: 'relay', from: 'Team assistant · Mina · device a1b2c3' });
    expect(parseChat(asUser('[Team human · Mina · team#4]\nhi'))[0]).toMatchObject({ kind: 'relay', from: 'Team human · Mina' });
    expect(parseChat(asQueued(agent))[0]).toMatchObject({ kind: 'relay' });
  });
  it('내가 보낸 말로 세지 않는다', () => {
    expect(sentByMe(parseChat(asUser(agent)))).toEqual([]);
    expect(sentByMe(parseChat(asUser(human)))).toEqual([]);
  });
  it('꼬리표 없는 비슷한 글은 그냥 사람 말', () => {
    expect(parseChat(asUser('[팀 참모 · 민아] 안녕'))[0]?.kind).toBe('user');
  });
});

// 내 기기끼리 방(서버 ADR 0004) — '[내 다른 기기 참모|사람 말 · <기기> · self#<seq>]'. 내 다른 기기 말이라도 이 채팅에선 보낸 쪽이 붙은 줄로
describe('내 다른 기기 말', () => {
  it('참모 말·사람 말 둘 다 보낸 기기 이름이 붙은 줄로', () => {
    expect(parseChat(asUser('[내 다른 기기 참모 · 아이맥 · self#4]\n빌드 끝났어'))[0]).toMatchObject({ kind: 'relay', from: '내 다른 기기 참모 · 아이맥', text: '빌드 끝났어' });
    expect(parseChat(asUser('[내 다른 기기 사람 말 · 아이맥 · self#5]\n쳤어'))[0]).toMatchObject({ kind: 'relay', from: '내 다른 기기 사람 말 · 아이맥' });
    expect(parseChat(asUser('[My device assistant · iMac · self#6]\nhi'))[0]).toMatchObject({ kind: 'relay', from: 'My device assistant · iMac' });
    expect(parseChat(asUser('[My device human · iMac · self#7]\nhi'))[0]).toMatchObject({ kind: 'relay' });
  });
  it('내가 보낸 말로 세지 않는다·꼬리표 없으면 그냥 말', () => {
    expect(sentByMe(parseChat(asUser('[내 다른 기기 참모 · 아이맥 · self#4]\nx')))).toEqual([]);
    expect(parseChat(asUser('[내 다른 기기 참모 · 아이맥] x'))[0]?.kind).toBe('user');
  });
});
