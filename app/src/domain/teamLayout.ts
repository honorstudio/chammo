// 팀 모드 칸 폭(10-26 사용자 "채팅이 작고 패널이 작고 스페이스가 넓다") — 메인 창 팀 모드와 메신저 따로 창이 같이 쓴다.
// 대화 폭(convo)만 사람이 끌어 바꾸고 기억한다. 목록 폭은 고정, 오른쪽 팀 스페이스가 나머지 전부
/** 대화 목록 폭 — 목록 | 대화 */
export const TEAM_LIST_W = 220;
/** 따로 창 왼쪽 팀 표 줄 폭(team.css .tmx-win-teams) */
export const TEAMS_W = 58;
/** 따로 창 오른쪽 팀 칸 최소 폭 — 이보다 좁으면 보관함 머리 단추가 칸 밖으로 나갔다(10-26 detached-locker.png) */
export const SIDE_MIN = 420;
/** 대화 폭 — 기본은 참모 채팅 기본(420)보다 좁게 */
export const CONVO = { def: 300, min: 280, max: 720 };

export const clampConvo = (w: number): number => (typeof w === 'number' && Number.isFinite(w) ? Math.min(CONVO.max, Math.max(CONVO.min, Math.round(w))) : CONVO.def);

/** 기억 열쇠 — 메인 창과 따로 창은 창 크기가 달라 따로 둔다 */
export const convoKey = (alone: boolean) => (alone ? 'teamWinConvoWidth' : 'teamConvoWidth');
export const foldKey = (alone: boolean) => (alone ? 'teamWinChatFold' : 'teamChatFold');

/** 따로 창 — 창 폭에서 대화 폭을 맞춘다. 오른쪽 칸이 SIDE_MIN 아래로 가면 대화가 먼저 줄고(기억한 값은 그대로),
 *  대화 최소로도 안 되면 좁은 창(오른쪽 칸은 접고 아이콘으로). 메신저를 접었으면 오른쪽 칸이 창 전체 */
export function winFit(win: number, convo: number, fold: boolean): { convo: number; max: number; narrow: boolean } {
  const room = win - TEAMS_W - TEAM_LIST_W - SIDE_MIN;
  const max = Math.min(CONVO.max, Math.max(CONVO.min, room));
  return { convo: Math.min(clampConvo(convo), max), max, narrow: !fold && room < CONVO.min };
}
