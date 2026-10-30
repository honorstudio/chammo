// 팀 설정(메신저 머리 톱니·팀 아이콘 메뉴) — 화면 판단(순수 함수)
import { describe, expect, it } from 'vitest';
import { canDeleteTeam, deleteAsk, leaveNote, memberRows, menuFor, PERM_CHIPS, quietContextMenu, switchTargets } from './teamSettings';

const m = (id: string, role: string, me = false, devices: { id: string; name: string }[] = []) => ({ id, name: id, role, me, devices });

describe('팀 아이콘 메뉴', () => {
  it('팀이 있으면 팀 초대·팀 설정, 없으면 팀 만들기 하나', () => {
    expect(menuFor({ joined: true })).toEqual(['invite', 'settings']);
    expect(menuFor({ joined: false })).toEqual(['make']);
    expect(menuFor(null)).toEqual(['make']);
  });
});

describe('팀원 줄', () => {
  it('나는 맨 위, 팀장 표시, 팀장만 남을 뺄 수 있다(나·다른 팀장 포함 — 서버가 마지막 팀장만 막는다)', () => {
    const v = { role: 'owner', members: [m('b', 'member'), m('a', 'owner', true, [{ id: 'd1', name: '맥북' }]), m('c', 'owner')] };
    const rows = memberRows(v);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => [r.owner, r.canRemove])).toEqual([[true, false], [false, true], [true, true]]);
    expect(rows[0]?.devices).toEqual(['맥북']);
  });
  it('팀원이면 아무도 못 뺀다', () => {
    expect(memberRows({ role: 'member', members: [m('a', 'member', true), m('b', 'owner')] }).some((r) => r.canRemove)).toBe(false);
  });
});

describe('나가기 안내', () => {
  it('내가 유일한 팀장이면 먼저 팀장을 넘기라고 한 줄(서버 409 last_owner 와 같은 기준)', () => {
    expect(leaveNote({ role: 'owner', members: [m('a', 'owner', true), m('b', 'member')] })).toBe('last-owner');
    expect(leaveNote({ role: 'owner', members: [m('a', 'owner', true)] })).toBe('last-owner');
    expect(leaveNote({ role: 'owner', members: [m('a', 'owner', true), m('b', 'owner')] })).toBe('');
    expect(leaveNote({ role: 'member', members: [m('a', 'member', true), m('b', 'owner')] })).toBe('');
  });
});

describe('메신저 창 오른쪽 클릭', () => {
  it('글 칸·고른 글 위에서만 기본 메뉴(붙여넣기·복사), 나머지는 웹뷰 메뉴(다시 로드·요소 검사)를 막는다', () => {
    expect(quietContextMenu({ editable: true, selection: '' })).toBe(false);
    expect(quietContextMenu({ editable: false, selection: '복사할 글' })).toBe(false);
    expect(quietContextMenu({ editable: false, selection: '' })).toBe(true);
  });
  it('팀 지우기는 팀장만(서버 deleteTeam 과 같은 기준) — 혼자 남은 팀장이 옛 팀을 치울 길', () => {
    expect(canDeleteTeam({ role: 'owner' })).toBe(true);
    expect(canDeleteTeam({ role: 'member' })).toBe(false);
  });
  it('팀 지우기 확인 창 — 팀 이름·팀원 수, 같은 이름 팀이 있으면 id 끝자리까지(같은 이름 팀 둘)', () => {
    const v = { teamId: 'team-aaaa1111', team: 'ACME', members: [m('a', 'owner', true), m('b', 'member')], teams: [{ id: 'team-aaaa1111', name: 'ACME' }] };
    expect(deleteAsk(v)).toEqual({ title: 'ACME 팀을 지울까요?', body: '팀원 2명이 모두 빠지고 이 팀 대화가 지워져요. 되돌릴 수 없어요.' });
    const dup = { ...v, teams: [...v.teams, { id: 'team-bbbb2222', name: 'ACME' }] };
    expect(deleteAsk(dup).title).toBe('ACME(…1111) 팀을 지울까요?');
    expect(deleteAsk(dup).body).toContain('같은 이름 팀이 하나 더 있어요');
  });
  it('팀 바꾸기 — 지금 팀 말고 내 팀들(이름이 같으면 id 끝자리)(QA 6)', () => {
    expect(switchTargets({ teamId: 't1', teams: [{ id: 't1', name: 'QA팀' }] })).toEqual([]);
    expect(switchTargets({ teamId: 't2', teams: [{ id: 't1', name: 'QA팀' }, { id: 't2', name: 'QA팀2' }] })).toEqual([{ id: 't1', label: 'QA팀' }]);
    expect(switchTargets({ teamId: 't2', teams: [{ id: 'aaaa1111', name: 'ACME' }, { id: 't2', name: 'ACME' }] })).toEqual([{ id: 'aaaa1111', label: 'ACME(…1111)' }]);
    expect(switchTargets({ teamId: 't1' })).toEqual([]);
  });
});

describe('매니저 권한(relay ADR 0014)', () => {
  const p = (id: string, perms: string[], me = false) => ({ id, name: id, role: 'manager', perms, me, devices: [] });
  it('줄마다 매니저·전체 권한 표시와 권한', () => {
    const rows = memberRows({ role: 'owner', members: [m('o', 'owner', true), p('a', ['invite', 'kick']), p('f', ['all']), m('x', 'member')] });
    expect(rows.map((r) => r.badge)).toEqual(['owner', 'manager', 'all', '']);
    expect(rows.find((r) => r.id === 'a')?.perms).toEqual(['invite', 'kick']);
  });
  it('팀장은 누구든 권한·넘기기·빼기, 전체 권한 칩도', () => {
    const rows = memberRows({ role: 'owner', members: [m('o', 'owner', true), p('f', ['all']), m('x', 'member')] });
    expect(rows.filter((r) => !r.me).map((r) => [r.canPerms, r.canAll, r.canTransfer, r.canRemove])).toEqual([[true, true, true, true], [true, true, true, true]]);
  });
  it('전체 권한은 아래 사람만 — 전체 칩·넘기기는 못, 팀장·다른 전체 권한 줄은 아무것도', () => {
    const rows = memberRows({ role: 'manager', members: [p('f', ['all'], true), m('o', 'owner'), p('f2', ['all']), p('g', ['posts']), m('x', 'member')] });
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect([of('o').canPerms, of('o').canRemove, of('f2').canPerms, of('f2').canRemove]).toEqual([false, false, false, false]);
    expect([of('g').canPerms, of('g').canAll, of('g').canTransfer, of('g').canRemove]).toEqual([true, false, false, true]);
  });
  it('kick 매니저는 팀원만 빼고 권한은 못 바꾼다', () => {
    const rows = memberRows({ role: 'manager', members: [p('k', ['kick'], true), p('g', ['posts']), m('x', 'member')] });
    expect(rows.filter((r) => !r.me).map((r) => [r.id, r.canPerms, r.canRemove])).toEqual([['g', false, false], ['x', false, true]]);
  });
  it('권한 칩 차례·이름 — 전체 먼저', () => {
    expect(PERM_CHIPS.map((c) => c.key)).toEqual(['all', 'invite', 'kick', 'posts', 'look', 'files', 'agents']);
  });
});
