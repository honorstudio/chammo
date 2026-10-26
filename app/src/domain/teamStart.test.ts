// 팀 만들기·초대받기 팝업(TeamStart) — 어느 화면을 보여 줄지(순수 함수). 링크로 앱이 열렸을 때(딥링크)도 같은 판단
import { describe, expect, it } from 'vitest';
import { startScreen } from './teamStart';

const base = { joined: false, account: null as { email: string; name: string } | null };

describe('팀 시작 팝업 화면 고르기', () => {
  it('로그인 안 한 기기는 무엇을 하든 로그인부터 — 초대 링크로 열렸어도', () => {
    expect(startScreen(base, { invite: '', wantJoin: false })).toBe('login');
    expect(startScreen(base, { invite: 'https://chammo.app/join#Ab', wantJoin: true })).toBe('login');
  });
  it('팀 상태를 아직 못 읽었으면 기다림 — 링크로 앱이 막 켜졌을 때 로그인 화면이 번쩍이지 않게', () => {
    expect(startScreen(null, { invite: 'https://chammo.app/join#Ab', wantJoin: false })).toBe('loading');
  });
  it('로그인했고 팀이 없으면 만들기, 초대받았어요를 눌렀거나 링크로 열렸으면 초대받기', () => {
    const v = { ...base, account: { email: 'a@b.c', name: '지수' } };
    expect(startScreen(v, { invite: '', wantJoin: false })).toBe('make');
    expect(startScreen(v, { invite: '', wantJoin: true })).toBe('join');
    expect(startScreen(v, { invite: 'https://chammo.app/join#Ab', wantJoin: false })).toBe('join');
  });
  it('이미 팀이 있으면 초대 링크 만들기 — 계정 기기는 다른 팀 초대도 받는다(team_relay 여러 팀, 10-26 세 사람 시험)', () => {
    const v = { joined: true, account: { email: 'a@b.c', name: '지수' } };
    expect(startScreen(v, { invite: '', wantJoin: false })).toBe('invite');
    expect(startScreen(v, { invite: '', wantJoin: true })).toBe('join');
    expect(startScreen(v, { invite: 'https://chammo.app/join#Ab', wantJoin: false })).toBe('join');
  });
  it('계정 없이 초대 코드로만 들어온 옛 기기는 팀 하나 — 링크로 또 열렸으면 한 줄 안내', () => {
    const old = { joined: true, account: null };
    expect(startScreen(old, { invite: '', wantJoin: false })).toBe('invite');
    expect(startScreen(old, { invite: 'https://chammo.app/join#Ab', wantJoin: false })).toBe('already');
    expect(startScreen(old, { invite: '', wantJoin: true })).toBe('already');
  });
});
