import { describe, expect, it } from 'vitest';
import { closeTeamTab, EMPTY_TEAM_TABS, openTeamFile, pickTeamTab, teamTabsOf, type TeamTabs } from './teamSpace';

describe('팀 스페이스 탭(시안 team-space A — 팀 홈·팀 보관함 + 연 파일)', () => {
  it('처음엔 팀 홈, 연 파일 없음', () => {
    expect(EMPTY_TEAM_TABS).toEqual({ cur: 'home', files: [] });
  });
  it('파일을 열면 끝에 탭이 붙고 그 탭을 본다 — 연 곳(홈·보관함)을 적는다', () => {
    const t = openTeamFile({ cur: 'locker', files: [] }, '/d/a.png');
    expect(t).toEqual({ cur: '/d/a.png', files: [{ path: '/d/a.png', from: 'locker' }] });
  });
  it('이미 연 파일을 다시 열면 탭을 늘리지 않고 그 탭으로', () => {
    const t0: TeamTabs = { cur: 'home', files: [{ path: '/d/a.png', from: 'locker' }] };
    expect(openTeamFile(t0, '/d/a.png')).toEqual({ cur: '/d/a.png', files: t0.files });
  });
  it('파일 탭에서 다른 파일을 열면 연 곳은 처음 연 곳(파일이 아니라 홈·보관함)', () => {
    const t = openTeamFile(openTeamFile({ cur: 'home', files: [] }, '/d/a.md'), '/d/b.md');
    expect(t.files[1]).toEqual({ path: '/d/b.md', from: 'home' });
  });
  it('보던 탭을 닫으면 연 곳으로, 안 보던 탭을 닫으면 보던 곳 그대로', () => {
    const t: TeamTabs = { cur: '/d/a.png', files: [{ path: '/d/a.png', from: 'locker' }, { path: '/d/b.md', from: 'home' }] };
    expect(closeTeamTab(t, '/d/a.png')).toEqual({ cur: 'locker', files: [{ path: '/d/b.md', from: 'home' }] });
    expect(closeTeamTab(t, '/d/b.md')).toEqual({ cur: '/d/a.png', files: [{ path: '/d/a.png', from: 'locker' }] });
  });
  it('홈·보관함 고르기 — 없는 파일 탭 주소는 홈으로', () => {
    const t: TeamTabs = { cur: 'home', files: [{ path: '/d/a.png', from: 'locker' }] };
    expect(pickTeamTab(t, 'locker').cur).toBe('locker');
    expect(pickTeamTab(t, '/d/a.png').cur).toBe('/d/a.png');
    expect(pickTeamTab(t, '/d/x.png').cur).toBe('home');
  });
  it('팀마다 따로 — 모르는 팀은 빈 탭', () => {
    const m = new Map([['t1', { cur: 'locker', files: [] } as TeamTabs]]);
    expect(teamTabsOf(m, 't1').cur).toBe('locker');
    expect(teamTabsOf(m, 't2')).toEqual(EMPTY_TEAM_TABS);
  });
});
