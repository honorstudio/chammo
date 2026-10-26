// 팀 스페이스 탭(시안 team-space v1 A, 10-26 사용자 "추천대로") — 팀 모드 오른쪽은 팀 홈·팀 보관함 두 고정 탭 + 연 파일 탭.
// 참모 탭 줄(lockerTabs)과 섞이지 않게 팀마다 따로 들고, 보던 파일 탭을 닫으면 그 파일을 연 곳(홈·보관함)으로 돌아간다
export type TeamFixed = 'home' | 'locker';
export type TeamTabs = { cur: string; files: { path: string; from: TeamFixed }[] };

export const EMPTY_TEAM_TABS: TeamTabs = { cur: 'home', files: [] };

const isFixed = (k: string): k is TeamFixed => k === 'home' || k === 'locker';

export function openTeamFile(t: TeamTabs, path: string): TeamTabs {
  if (t.files.some((f) => f.path === path)) return { ...t, cur: path };
  const from: TeamFixed = isFixed(t.cur) ? t.cur : (t.files.find((f) => f.path === t.cur)?.from ?? 'locker');
  return { cur: path, files: [...t.files, { path, from }] };
}

export function closeTeamTab(t: TeamTabs, path: string): TeamTabs {
  const gone = t.files.find((f) => f.path === path);
  const files = t.files.filter((f) => f.path !== path);
  return { cur: t.cur === path ? (gone?.from ?? 'home') : t.cur, files };
}

export function pickTeamTab(t: TeamTabs, k: string): TeamTabs {
  return { ...t, cur: isFixed(k) || t.files.some((f) => f.path === k) ? k : 'home' };
}

export const teamTabsOf = (m: Map<string, TeamTabs>, team: string): TeamTabs => m.get(team) ?? EMPTY_TEAM_TABS;
