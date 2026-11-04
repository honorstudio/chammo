// 팀 화면 사람 이름 = 프로필 이름 한 길(teamProfile lookNames·lookOf) — 11-02 사용자 "여기 닉네임으로 안 나옴"(폰 일정 고치기 참석자 칩이 계정 이름)
// 명부(view.members)의 name 은 계정 이름이다. 사람 이름을 그리는 화면은 프로필판을 거쳐야 한다
import { describe, expect, it } from 'vitest';
import cal from './TeamCal.tsx?raw';
import room from './RoomCreate.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import locker from './TeamLocker.tsx?raw';
import bits from './RoomBits.tsx?raw';
import settings from './TeamSettings.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';
import phoneLocker from '../mobile/PhoneTeamLocker.tsx?raw';

describe('팀 화면 이름은 프로필 이름', () => {
  it('캘린더 참석자 칩·지운 사람 — lookNames 를 거친 사람으로(데스크톱·폰 같은 TeamCal)', () => {
    expect(cal).toContain('const people = useMemo(() => lookNames(members, board), [members, board]);');
    expect(cal).toContain('people={people}');
    expect(cal).not.toContain('people={members}');
  });
  it('팀챗 만들기 사람 고르기 — 프로필 이름, 색은 계정 이름', () => {
    expect(room).toContain('lookNames(members.filter((m) => !m.me), board)');
    expect(room).toContain('color={personColor(m.account)}');
  });
  it('부르기 — 목록은 프로필 이름, 말풍선의 @계정이름도 프로필 이름으로 보인다', () => {
    expect(convo).toMatch(/const callable = useMemo\(\(\) => lookNames\(/);
    expect(convo).toContain('shown={shown}');
    expect(bits).toContain('mentionParts(text, names, myName, shown)');
    expect(bits).toContain('<Person name={m.label} color={personColor(m.name)}');
  });
  it('반응 누른 사람·내 반응 — 프로필 이름', () => {
    expect(convo).toContain('reactionsOf(items, convo.room, (m, roster) => lookOf(board, m, roster).name)');
    expect(convo).toContain('withMyReacts(got, pendReact, myShown)');
  });
  it('보관함 올린 사람 — byMember 로 프로필 이름', () => {
    expect(locker).toContain('lookOf(board, i.byMember, i.by).name');
    expect(phoneLocker).toContain('lookOf(board, item.byMember, item.by).name');
  });
  it('팀 참모 이름 겹침 — 계정·프로필 이름 둘 다와 견준다(데스크톱·폰)', () => {
    for (const src of [settings, phone]) {
      expect(src).not.toContain('people={view.members.map((m) => m.name)}');
      expect(src).toContain('.flatMap((m) => [m.name, m.account])');
    }
  });
});
