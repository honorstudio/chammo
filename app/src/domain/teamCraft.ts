// 팀 화면에서 연 참모 앱(Craft) — 칸은 팀 스페이스 탭 줄에, 주인 참모는 없다(10-28 사용자 "왜 팀 보관함에서 열었는데 내 참모한테 열리는지").
// 예전엔 사람이 연 인스턴스(띄운 세션 없음)를 '지금 보는 참모'에 붙였는데, 팀 모드는 참모 화면 고름을 그대로 두어 팀에 들어오기 직전 보던 참모
// (예: 마지막에 보던 참모)가 늘 주인이 되고 팀 모드를 떠나 그 참모 화면으로 갔다. 열기는 Rust → scripts/craft → app.jsonl → __craftSpace 로 돌아오니
// 팀 파일에서 연다는 표시를 앱별로 잠깐 남겨 두고 돌아올 때 쓴다
import { craftBase } from './craftTab';
import type { TeamTabs } from './teamSpace';
import { closeTeamTab } from './teamSpace';

/** 표시가 남는 시간 — 안 깔린 앱은 설치하고 연다(서랍과 같은 한도 3분) */
export const TEAM_CRAFT_TTL = 200_000;

const marks = new Map<string, { at: number; path: string }>();

/** 팀 파일을 참모 앱으로 열기 직전 — path = 연 파일(풀어 둔 자리, 팀 탭이 수정본 올리기에 쓴다) */
export function markTeamCraft(app: string, path = '', now = Date.now()) {
  if (app) marks.set(app, { at: now, path });
}

/** 이 인스턴스(키 vectorcraft-2 도)가 팀 파일에서 열렸으면 그 파일(모르면 빈 글), 아니면 null — 한 번 쓰면 지운다 */
export function fromTeamCraft(key: string, now = Date.now()): string | null {
  const app = craftBase(key);
  const m = marks.get(app);
  marks.delete(app);
  return m && now - m.at <= TEAM_CRAFT_TTL ? m.path : null;
}

/** 칸을 팀 화면에 둘까 — 팀 모드이고, 팀 파일에서 열었거나 사람이 연 것(띄운 세션 없음). 맡긴 세션이 띄운 건 그 참모 몫 */
export const craftToTeam = (teamOn: boolean, fromTeam: boolean, by: string | undefined) => teamOn && (fromTeam || !by);

/** 꺼진·숨긴 앱 칸 — 모든 팀 탭 줄에서 거둔다(보던 칸이면 연 곳으로). 바뀐 게 없으면 같은 Map */
export function dropTeamKey(m: Map<string, TeamTabs>, key: string): Map<string, TeamTabs> {
  if (![...m.values()].some((t) => t.files.some((f) => f.path === key))) return m;
  const n = new Map(m);
  for (const [k, t] of n) if (t.files.some((f) => f.path === key)) n.set(k, closeTeamTab(t, key));
  return n;
}
