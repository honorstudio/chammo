// 팀 화면에서 연 참모 앱(10-28 사용자 "왜 팀 보관함에서 열었는데 내 참모한테 열리는지") — 칸은 팀 화면 탭 줄에, 주인 참모 없음
import { describe, expect, it } from 'vitest';
import { craftToTeam, dropTeamKey, fromTeamCraft, markTeamCraft, TEAM_CRAFT_TTL } from './teamCraft';
import { openTeamCraft, openTeamFile, reviseSrc, type TeamTabs } from './teamSpace';

describe('팀에서 연 참모 앱 칸은 팀 화면에', () => {
  it('팀 모드 + 팀 파일에서 열었다는 표시 → 팀 칸(띄운 세션이 있어도 — 그 세션이 먼저 띄운 인스턴스를 다시 쓴 것)', () => {
    expect(craftToTeam(true, true, '')).toBe(true);
    expect(craftToTeam(true, true, 'ab12cd34')).toBe(true);
  });
  it('팀 모드에서 사람이 연 것(띄운 세션 없음) → 팀 칸 — 미리보기 머리 \'참모 ○○로 열기\'도 팀 화면에서 눌렀다', () => {
    expect(craftToTeam(true, false, '')).toBe(true);
    expect(craftToTeam(true, false, undefined)).toBe(true);
  });
  it('참모가 맡긴 세션이 띄운 것 → 예전처럼 그 참모 칸(팀 화면에 끼어들지 않는다)', () => {
    expect(craftToTeam(true, false, 'ab12cd34')).toBe(false);
  });
  it('팀 모드가 아니면 늘 참모 칸 — 참모 보관함에서 연 것은 그대로', () => {
    expect(craftToTeam(false, false, '')).toBe(false);
    expect(craftToTeam(false, true, '')).toBe(false);
  });
});

describe('팀 파일에서 열었다는 표시', () => {
  it('한 번만 쓴다 — 다음 열기(서랍·독)는 표시 없이', () => {
    markTeamCraft('vectorcraft', '/peek/t1/로고/a.ai', 1000);
    expect(fromTeamCraft('vectorcraft', 2000)).toBe('/peek/t1/로고/a.ai'); // 연 파일 — 팀 탭이 수정본 올리기에 쓴다
    expect(fromTeamCraft('vectorcraft', 2000)).toBeNull();
  });
  it('같은 앱의 2·3번째 인스턴스 키(vectorcraft-2)로 와도 맞는다 — scripts/craft 가 빈 자리를 고른다', () => {
    markTeamCraft('vectorcraft', '/p/a.ai', 1000);
    expect(fromTeamCraft('vectorcraft-2', 1500)).toBe('/p/a.ai');
  });
  it('설치하고 여는 동안(최대 3분)은 남고 그 뒤엔 사라진다', () => {
    expect(TEAM_CRAFT_TTL).toBeGreaterThanOrEqual(180_000);
    markTeamCraft('photocraft', '/p/a.psd', 0);
    expect(fromTeamCraft('photocraft', TEAM_CRAFT_TTL + 1)).toBeNull();
  });
  it('다른 앱 표시는 안 맞는다', () => {
    markTeamCraft('pdfcraft', '/p/a.pdf', 0);
    expect(fromTeamCraft('gridcraft', 10)).toBeNull();
    expect(fromTeamCraft('pdfcraft', 10)).toBe('/p/a.pdf');
  });
});

describe('팀 칸 참모 앱 탭은 연 파일을 기억한다(수정본 올리기)', () => {
  it('새 탭이면 src 와 함께, 이미 있으면 src 만 새 파일로', () => {
    const a = openTeamCraft({ cur: 'locker', files: [] }, 'k:vectorcraft', '/p/a.ai');
    expect(a).toEqual({ cur: 'k:vectorcraft', files: [{ path: 'k:vectorcraft', from: 'locker', src: '/p/a.ai' }] });
    const b = openTeamCraft({ ...a, cur: 'home' }, 'k:vectorcraft', '/p/b.ai');
    expect(b).toEqual({ cur: 'k:vectorcraft', files: [{ path: 'k:vectorcraft', from: 'locker', src: '/p/b.ai' }] });
  });
  it('연 파일을 모르면(빈 글) 있던 src 를 그대로', () => {
    const a = openTeamCraft({ cur: 'locker', files: [] }, 'k:vectorcraft', '/p/a.ai');
    expect(openTeamCraft(a, 'k:vectorcraft', '').files[0]!.src).toBe('/p/a.ai');
  });
  it('보던 탭의 수정본 올릴 파일 — 파일 탭은 그 경로, 참모 앱 탭은 src, 고정 탭은 없음', () => {
    const t = openTeamCraft(openTeamFile({ cur: 'locker', files: [] }, '/p/a.pdf'), 'k:vectorcraft', '/p/a.ai');
    expect(reviseSrc(t)).toBe('/p/a.ai');
    expect(reviseSrc({ ...t, cur: '/p/a.pdf' })).toBe('/p/a.pdf');
    expect(reviseSrc({ ...t, cur: 'locker' })).toBe('');
    expect(reviseSrc({ ...t, cur: 'files:room1' })).toBe('');
  });
});

describe('꺼진·숨긴 참모 앱 칸은 모든 팀 탭 줄에서 거둔다', () => {
  const t: TeamTabs = openTeamFile(openTeamFile({ cur: 'locker', files: [] }, '/p/a.pdf'), 'k:vectorcraft');
  it('보던 칸이면 연 곳(팀 보관함)으로 돌아간다', () => {
    const m = dropTeamKey(new Map([['t1', t], ['t2', { cur: 'home', files: [] }]]), 'k:vectorcraft');
    expect(m.get('t1')).toEqual({ cur: 'locker', files: [{ path: '/p/a.pdf', from: 'locker' }] });
    expect(m.get('t2')).toEqual({ cur: 'home', files: [] });
  });
  it('그 칸이 없으면 같은 Map 을 돌려준다(다시 그리지 않게)', () => {
    const m = new Map([['t1', { cur: 'home', files: [] } as TeamTabs]]);
    expect(dropTeamKey(m, 'k:vectorcraft')).toBe(m);
  });
});
