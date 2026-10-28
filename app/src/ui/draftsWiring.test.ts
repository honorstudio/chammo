// 입력칸 쓰던 글 연결 — 팀챗·DM·참모 채팅 모두 데이터 폴더 파일(drafts.json, 600)로, 그리기 전에 읽는다(10-28 "채팅하다가 나가면 채팅 지워짐")
import { describe, expect, it } from 'vitest';
import convo from './team/TeamConvo.tsx?raw';
import chat from './chat/ChatView.tsx?raw';
import phone from './mobile/PhoneTeam.tsx?raw';
import main from '../main.tsx?raw';
import messenger from '../messenger.tsx?raw';

describe('쓰던 글 저장 연결', () => {
  it('팀챗·DM 은 대화마다 읽고, 바뀔 때마다 남긴다(보내서 비우면 지워진다)', () => {
    expect(convo).toContain('drafts = teamDrafts');
    expect(convo).toContain('drafts.load(convo.key).text');
    expect(convo).toContain('drafts.save(convo.key, { text, refs: [] })');
  });
  it('참모 채팅은 localStorage 가 아니라 파일 저장소', () => {
    expect(chat).toContain('const drafts = chatDrafts;');
    expect(chat).not.toContain('window.localStorage');
  });
  it('폰은 메모리만 — 비밀이 폰 저장소에 남지 않게', () => expect(phone).toContain('drafts={phoneDrafts}'));
  it('본 창·메신저 따로 창 모두 그리기 전에 파일을 읽는다', () => {
    expect(main.indexOf('loadDrafts()')).toBeGreaterThan(-1);
    expect(main.indexOf('loadDrafts()')).toBeLessThan(main.indexOf("import('./App')"));
    expect(messenger.indexOf('loadDrafts()')).toBeLessThan(messenger.indexOf("import('./ui/team/MessengerApp')"));
  });
});
