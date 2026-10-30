// 팀 스페이스 탭(시안 team-space v1 A, 10-26 사용자 "추천대로") — 팀 모드 오른쪽은 팀 홈·팀 보관함·팀 캘린더(relay ADR 0011) 고정 탭 + 연 파일 탭.
// 참모 탭 줄(lockerTabs)과 섞이지 않게 팀마다 따로 들고, 보던 파일 탭을 닫으면 그 파일을 연 곳(홈·보관함·대화 파일 보기)으로 돌아간다.
// 대화 파일 보기(DM·팀챗에 붙인 파일, 10-28 사용자 "디엠 보관함이 따로")도 연 파일처럼 탭 하나 — 열쇠 files:<방 id>
export type TeamFixed = 'home' | 'locker' | 'cal';
/** from = 연 곳 — 고정 탭이나 대화 파일 보기 열쇠 · src = 참모 앱 탭(k:<앱>)이 연 팀 파일(수정본 올리기, domain/teamRevise) */
export type TeamTabs = { cur: string; files: { path: string; from: string; src?: string }[] };

const ROOM_FILES = 'files:';
export const roomFilesKey = (room: string) => `${ROOM_FILES}${room}`;
/** 대화 파일 보기 탭이면 그 방 id, 아니면 빈 글(파일 경로는 / 로 시작해 안 겹친다) */
export const roomOfTab = (k: string) => (k.startsWith(ROOM_FILES) ? k.slice(ROOM_FILES.length) : '');

export const EMPTY_TEAM_TABS: TeamTabs = { cur: 'home', files: [] };

const isFixed = (k: string): k is TeamFixed => k === 'home' || k === 'locker' || k === 'cal';

export function openTeamFile(t: TeamTabs, path: string): TeamTabs {
  if (t.files.some((f) => f.path === path)) return { ...t, cur: path };
  const from = isFixed(t.cur) || roomOfTab(t.cur) ? t.cur : (t.files.find((f) => f.path === t.cur)?.from ?? 'locker');
  return { cur: path, files: [...t.files, { path, from }] };
}

/** 팀에서 연 참모 앱 칸 — 파일 탭처럼 열고 연 파일(src)을 붙인다. 이미 있으면 src 만 새 파일로(모르면 그대로) */
export function openTeamCraft(t: TeamTabs, key: string, src: string): TeamTabs {
  const o = openTeamFile(t, key);
  return src ? { ...o, files: o.files.map((f) => (f.path === key ? { ...f, src } : f)) } : o;
}

/** 보던 탭의 수정본 올릴 파일 — 파일 탭은 그 경로, 참모 앱 탭은 연 파일, 고정 탭·대화 파일 보기는 없음(빈 글) */
export function reviseSrc(t: TeamTabs): string {
  if (isFixed(t.cur) || roomOfTab(t.cur)) return '';
  const f = t.files.find((x) => x.path === t.cur);
  if (!f) return '';
  return t.cur.startsWith('k:') ? (f.src ?? '') : f.path;
}

export function closeTeamTab(t: TeamTabs, path: string): TeamTabs {
  const gone = t.files.find((f) => f.path === path);
  const files = t.files.filter((f) => f.path !== path);
  // 연 곳이 대화 파일 보기였는데 그 탭도 닫혔으면 홈
  const back = gone && (isFixed(gone.from) || files.some((f) => f.path === gone.from)) ? gone.from : 'home';
  return { cur: t.cur === path ? back : t.cur, files };
}

export function pickTeamTab(t: TeamTabs, k: string): TeamTabs {
  return { ...t, cur: isFixed(k) || t.files.some((f) => f.path === k) ? k : 'home' };
}

export const teamTabsOf = (m: Map<string, TeamTabs>, team: string): TeamTabs => m.get(team) ?? EMPTY_TEAM_TABS;
