import { describe, expect, it } from 'vitest';
import { ALL_ROOM, allRoomPlan } from './teamAllRoom';

const m = (id: string, me = false, role = 'member') => ({ id, name: id, role, me });
const view = (members: ReturnType<typeof m>[], rooms: { id: string; kind: string; name?: string; members?: string[] }[] = [], role = 'owner') =>
  ({ joined: true, teamId: 't', role, members, rooms: rooms.map((r) => ({ peer: '', with: '', ...r })) });

describe("팀 만들면 '전체' 팀챗(10-26 사용자 추천안) — 팀장 기기가 만들고 채운다", () => {
  it('팀장이고 다른 사람이 있는데 전체 팀챗이 없으면 만든다(나 말고 모두)', () => {
    expect(allRoomPlan(view([m('me', true, 'owner'), m('a'), m('b')]))).toEqual({ make: ['a', 'b'] });
  });
  it('있으면 빠진 사람만 더한다', () => {
    expect(allRoomPlan(view([m('me', true, 'owner'), m('a'), m('b')], [{ id: 'r1', kind: 'group', name: ALL_ROOM, members: ['me', 'a'] }]))).toEqual({ room: 'r1', add: ['b'] });
  });
  it('다 들어 있으면·팀원 기기면·나 혼자면 할 일 없음', () => {
    expect(allRoomPlan(view([m('me', true, 'owner'), m('a')], [{ id: 'r1', kind: 'group', name: ALL_ROOM, members: ['me', 'a'] }]))).toBeNull();
    expect(allRoomPlan(view([m('me', true), m('a')], [], 'member'))).toBeNull();
    expect(allRoomPlan(view([m('me', true, 'owner')]))).toBeNull();
  });
  it('이름이 같은 DM 은 전체 팀챗이 아니다', () => {
    expect(allRoomPlan(view([m('me', true, 'owner'), m('a')], [{ id: 'd1', kind: 'dm', name: ALL_ROOM }]))).toEqual({ make: ['a'] });
  });
});

// 10-26 사용자 캡처 dup-all-rooms.png — '전체'가 셋. Rust 화면 목록(team_cmd::view)은 방 이름을 with 에 주고 name 은 없다,
// 그리고 모든 팀 방이 한 목록에 온다. 그래서 켤 때마다 '없다'로 보고 또 만들었다
describe("'전체' 팀챗은 한 번만 — 실제 화면 목록 모양(with·team)", () => {
  const real = (rooms: { id: string; team: string; with: string; members: string[] }[]) =>
    ({ joined: true, teamId: 't', role: 'owner', members: [m('me', true, 'owner'), m('a')], rooms: rooms.map((r) => ({ kind: 'group', peer: '', ...r })) });
  it('이름이 with 에만 있어도 있는 걸로 본다', () => {
    expect(allRoomPlan(real([{ id: 'r1', team: 't', with: ALL_ROOM, members: ['me', 'a'] }]))).toBeNull();
  });
  it('다른 언어로 만든 전체(Everyone·전체)도 같은 방', () => {
    expect(allRoomPlan(real([{ id: 'r1', team: 't', with: 'Everyone', members: ['me', 'a'] }]))).toBeNull();
    expect(allRoomPlan(real([{ id: 'r1', team: 't', with: '전체', members: ['me', 'a'] }]))).toBeNull();
  });
  it('다른 팀의 전체는 이 팀 것이 아니다', () => {
    expect(allRoomPlan(real([{ id: 'r9', team: 'other', with: ALL_ROOM, members: ['me', 'a'] }]))).toEqual({ make: ['a'] });
  });
  it('여럿이면 먼저 온 하나에만 더한다', () => {
    expect(allRoomPlan({ ...real([{ id: 'r1', team: 't', with: ALL_ROOM, members: ['me'] }, { id: 'r2', team: 't', with: ALL_ROOM, members: ['me'] }]) })).toEqual({ room: 'r1', add: ['a'] });
  });
});
