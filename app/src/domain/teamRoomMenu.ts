// 대화 목록 우클릭(10-26 사용자 "팀챗을 지울 수가 없다") — 무엇을 보일지와 DM 숨기기. 화면은 ui/team/useRoomMenu
// 이름·사람은 한 겹창(RoomCreate)이라 한 줄, 지우기는 만든 사람·팀장만(서버 chammo-relay rooms.ts 와 같은 기준) 맨 끝.
// DM 은 서버에서 못 지운다(사람 둘의 방) — 이 기기 목록에서만 숨기고 그 뒤 새 말이 오면 다시 보인다

export type RoomAct = 'edit' | 'leave' | 'delete' | 'hide';

export const roomActs = (kind: string, canDelete: boolean): RoomAct[] =>
  kind === 'group' ? ['edit', 'leave', ...(canDelete ? (['delete'] as const) : [])] : ['hide'];

/** 숨긴 DM — 상대 멤버 id → 숨긴 때(ms) */
export type HiddenDms = Record<string, number>;

export const hideDm = (h: HiddenDms, peer: string, at: number): HiddenDms => ({ ...h, [peer]: at });

export const shownDms = <C extends { peer: string; last: { at: number } | null }>(cs: C[], h: HiddenDms): C[] =>
  cs.filter((c) => { const at = h[c.peer]; return at == null || (c.last?.at ?? 0) > at; });

/** 이 컴퓨터에 팀마다 기억 */
export const hiddenKey = (team: string) => `chammo.team.hiddenDms.${team}`;
