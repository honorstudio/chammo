import { describe, expect, it } from 'vitest';
import locker from './TeamLocker.tsx?raw';
import phoneFiles from '../mobile/PhoneRoomFiles.tsx?raw';

// 11-08 DM 파일 중복 — 대화 파일 보기(데스크톱 '이 대화 파일'·폰 DM 보관함)는 옛 판이 다시 올린 사본을 하나로 접는다(domain roomTwins).
// 접힌 하나에 한 일은 숨은 사본에도 가야 한다 — 하나만 휴지통에 넣으면 사본이 떠서 '안 지워졌다'로 보인다
describe('대화 파일 쌍둥이 — 화면 연결', () => {
  it('두 화면 다 inRoom(접는 계산) 하나로 목록을 만든다', () => {
    expect(locker).toContain('inRoom(shown.items, roomId, trash)');
    expect(phoneFiles).toContain('inRoom(v.items, room)');
  });
  it('휴지통·되살리기·영구 지우기는 verbAll(숨은 사본까지) — 줄 하나만 부르는 verb(i.id·p.id) 가 안 남는다', () => {
    expect(locker).toMatch(/const verbAll = [^\n]*twinsById\.get\(id\)/);
    expect(locker).not.toMatch(/verb\((i|p)\.id,/);
    expect(locker).toMatch(/const trashMany = [^\n]*verbAll\(id, 'trash'\)/);
    expect(locker).toContain("verbAll(p.id, 'purge')");
  });
  it('이름 바꾸기도 숨은 사본까지 — 하나만 바뀌면 옛 이름 사본이 따로 뜬다', () => {
    expect(locker).toContain("for (const id of [i.id, ...(twinsById.get(i.id) ?? [])]) rename(id, { name: naming.value.trim() })");
  });
  it('쌍둥이 표는 살아 있는 것·휴지통을 다 본다 — 지운 뒤 되돌리기가 숨은 사본까지 되살린다', () => {
    expect(locker).toContain('roomTwins(shown.items, roomId)');
    expect(locker).toContain("undone.forEach((id) => verb(id, 'restore'))");
  });
});
