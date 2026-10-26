// '전체' 팀챗(10-26 사용자 — 팀을 만들면 팀 사람 모두가 든 팀챗 하나) — 서버는 팀챗을 명부 고리로만 만들고 바꿔서,
// 팀장 기기 앱이 없으면 만들고 새로 든 사람을 더한다. 화면(useTeamMode)과 따로 시험한다
// 만들기는 Rust team_ui_all_room 이 한 번 더 본다(서버 목록을 새로 받고, 팀마다 정해진 방 id 라 두 기기가 같이 만들어도 하나)
import { tr } from '../i18n';

export const ALL_ROOM = tr('전체', 'Everyone');
/** 어느 언어로 만들었든 '전체' — Rust team_rooms::ALL_NAMES 와 같다 */
export const ALL_NAMES = ['전체', 'Everyone'];

type Room = { id: string; kind: string; team?: string; name?: string; with?: string; members?: string[] };
type View = { joined: boolean; teamId: string; role: string; members: { id: string; me: boolean }[]; rooms: Room[] };

/** 그 팀 '전체' 팀챗 — 화면 목록은 방 이름을 with 에 준다(team_cmd::view), 모든 팀 방이 한 목록에 온다 */
export const isAllRoom = (r: Room, teamId: string) => r.kind === 'group' && (r.team ?? teamId) === teamId && ALL_NAMES.includes(r.name || r.with || '');

export function allRoomPlan(v: View): { make: string[] } | { room: string; add: string[] } | null {
  if (!v.joined || v.role !== 'owner') return null;
  const others = v.members.filter((m) => !m.me).map((m) => m.id);
  if (!others.length) return null;
  const all = v.rooms.find((r) => isAllRoom(r, v.teamId));
  if (!all) return { make: others };
  const add = others.filter((id) => !(all.members ?? []).includes(id));
  return add.length ? { room: all.id, add } : null;
}
