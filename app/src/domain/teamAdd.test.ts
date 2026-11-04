// 팀 여러 개(11-02 사용자 "추가적으로 여러 팀을 굴릴 수 있게") — 레일 팀 줄·칩 ▾ 목록·폰 머리 팀 줄이 같이 쓰는 순수 함수
import { describe, expect, it } from 'vitest';
import { defaultMe, sameTeamName, teamStack } from './teamAdd';
import { startScreen } from './teamStart';

const acct = { email: 'a@b.c', name: '지수' };

describe('팀 줄(teamStack) — 레일·칩 메뉴·폰 머리가 같은 순서', () => {
  it('내 팀을 서버 순서 그대로 쌓고 지금 팀만 표시 — 바꿔도 칸 자리가 안 움직인다(슬랙·디스코드 줄)', () => {
    const v = { joined: true, teamId: 't2', team: 'B', teams: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }, { id: 't3', name: 'C' }] };
    expect(teamStack(v)).toEqual([
      { id: 't1', name: 'A', current: false },
      { id: 't2', name: 'B', current: true },
      { id: 't3', name: 'C', current: false },
    ]);
  });
  it('이름이 같은 팀은 id 끝 네 자리로 가른다', () => {
    const v = { joined: true, teamId: 'aaaa1111', team: 'ACME', teams: [{ id: 'aaaa1111', name: 'ACME' }, { id: 'bbbb2222', name: 'ACME' }] };
    expect(teamStack(v).map((t) => t.name)).toEqual(['ACME(…1111)', 'ACME(…2222)']);
  });
  it('옛 화면 덩어리(teams 없음)는 지금 팀 하나, 팀이 없으면 빈 줄', () => {
    expect(teamStack({ joined: true, teamId: 't1', team: 'A' })).toEqual([{ id: 't1', name: 'A', current: true }]);
    expect(teamStack({ joined: false, teamId: '', team: '', teams: [] })).toEqual([]);
    expect(teamStack(null)).toEqual([]);
  });
  it('지금 팀 id 가 목록에 없으면(나간 직후) 표시 없이 그대로 — 엉뚱한 칸에 테두리를 안 그린다', () => {
    const v = { joined: true, teamId: 'gone', team: 'X', teams: [{ id: 't1', name: 'A' }] };
    expect(teamStack(v)).toEqual([{ id: 't1', name: 'A', current: false }]);
  });
});

describe('같은 이름 경고(sameTeamName) — 막지 않고 한 줄만', () => {
  const teams = [{ id: 't1', name: 'Moraeal' }, { id: 't2', name: '바다 협업' }];
  it('앞뒤 빈칸·대소문자만 다르면 같은 이름', () => {
    expect(sameTeamName(' moraeal ', teams)).toBe(true);
    expect(sameTeamName('바다 협업', teams)).toBe(true);
  });
  it('다른 이름·빈 칸은 경고 없음', () => {
    expect(sameTeamName('Moraeal 마케팅', teams)).toBe(false);
    expect(sameTeamName('   ', teams)).toBe(false);
    expect(sameTeamName('A', undefined)).toBe(false);
  });
});

describe('이 팀에서 보일 내 이름 기본값(defaultMe)', () => {
  it('지금 팀에서 쓰는 이름 → 없으면 계정 이름 → 없으면 빈 칸', () => {
    expect(defaultMe({ me: '하늘', account: acct })).toBe('하늘');
    expect(defaultMe({ me: '', account: acct })).toBe('지수');
    expect(defaultMe({ me: '', account: null })).toBe('');
    expect(defaultMe(null)).toBe('');
  });
});

describe("팀이 있어도 '새 팀 만들기'(wantMake) — 레일 + 메뉴·칩 ▾ 메뉴", () => {
  it('계정 기기는 팀이 있어도 만들기 화면', () => {
    expect(startScreen({ joined: true, account: acct }, { invite: '', wantJoin: false, wantMake: true })).toBe('make');
  });
  it('팀 없는 계정 기기도 만들기, 로그인 안 했으면 로그인부터', () => {
    expect(startScreen({ joined: false, account: acct }, { invite: '', wantJoin: false, wantMake: true })).toBe('make');
    expect(startScreen({ joined: false, account: null }, { invite: '', wantJoin: false, wantMake: true })).toBe('login');
  });
  it('초대 링크로 열렸으면 만들기보다 들어가기가 먼저', () => {
    expect(startScreen({ joined: true, account: acct }, { invite: 'https://chammo.app/join#Ab', wantJoin: false, wantMake: true })).toBe('join');
  });
  it('계정 없이 초대 코드로만 들어온 옛 기기는 팀 하나 — 한 줄 안내', () => {
    expect(startScreen({ joined: true, account: null }, { invite: '', wantJoin: false, wantMake: true })).toBe('already');
  });
});
