// 팀 메신저(중계 서버) — 화면은 Rust 명령만 부른다. 소켓은 Rust 가 쥐고(team_relay_ws), 받은 말은 Rust 가 내 참모에게 넘긴다.
// 사람 말(team_human_say)은 메인 창의 진짜(isTrusted) 키·클릭 뒤 1.5초 안에서만 — 다른 기기 참모 채팅(remoteChat)과 같은 문.
// 참모·스크립트는 scripts/team(늘 참모 말)로만 보낸다
import { invoke } from '@tauri-apps/api/core';
import { sendAllowed } from '../domain/remoteChat';
import type { TeamAccount } from '../domain/teamAccount';
import type { MyDevice } from '../domain/myDevices';
import type { TeamFile, TeamItem } from '../domain/teamChat';
import type { SafetyPerson } from '../domain/e2eSafety';

export type TeamView = {
  joined: boolean;
  team: string;
  teamId: string;
  me: string;
  device: string;
  role: string;
  server: string;
  deliverTo: string;
  members: { id: string; name: string; role: string; me: boolean; devices?: { id: string; name: string }[] }[];
  /** 단톡방(group)은 with = 방 이름, members 도(Rust team_cmd::view). team = 그 방 팀(내 기기끼리 방은 빈 값) — 모든 팀 방이 한 목록에 온다 */
  rooms: { id: string; kind: string; peer: string; with: string; team?: string; name?: string; members?: string[] }[];
  /** 내 팀들(Rust view teams) — 같은 이름 팀 가리기 등 */
  teams?: { id: string; name: string; role?: string; current?: boolean }[];
  /** 구글로 로그인한 기기면 그 계정(서버 ADR 0004) */
  account: TeamAccount | null;
  /** 내 계정 기기(ADR 0014 — 종류·허용 대기·마지막) */
  devices: MyDevice[];
  /** 이 기기가 다른 기기의 허용을 기다린다 · 거절 없으면 저절로 허용되는 때(ms) */
  pending: boolean;
  pendingAutoAt: number;
};

export const teamStatus = () => invoke<TeamView>('team_status');

// 설정 > Chammo 계정 — 다 메인 창 전용 Rust 명령. 로그인은 사람 브라우저에서 마칠 때까지(최대 10분) 기다린다
export const teamLogin = (server: string, device = '') => invoke<TeamView>('team_login', { server, device });
export const teamAccountRefresh = () => invoke<TeamView>('team_account_refresh');
export const teamDeviceRename = (id: string, name: string) => invoke<TeamView>('team_device_rename', { id, name });
export const teamDeviceRevoke = (id: string) => invoke<TeamView>('team_device_revoke', { id });
export const teamLogout = () => invoke<TeamView>('team_logout');
export const teamAccountDelete = (confirm: string) => invoke<TeamView>('team_account_delete', { confirm });

const newCid = () => `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** 사람이 친 말 — trustedAt 은 그 입력칸의 마지막 진짜 키·클릭 시각. 문 밖이면 안 보낸다(null).
 *  to = 상대 멤버 id(DM) 또는 'room:<방 id>'(단톡방, domain/teamChat sayTarget) */
export function teamHumanSay(to: string, text: string, trustedAt: number, extra: SayExtra = {}, now = Date.now()): Promise<{ room: string; seq: number }> | null {
  const empty = !text.trim() && !extra.react && !extra.files?.length;
  if (!sendAllowed(trustedAt, now) || empty) return null;
  const room = to.startsWith('room:') ? to.slice(5) : null;
  return invoke('team_human_say', { to: room ? '' : to, text, cid: newCid(), room, react: extra.react ?? null, files: extra.files?.length ? extra.files : null });
}

/** 말에 딸린 것(시안 msg-rooms v2) — 반응 달기·떼기, 팀 보관함에 올린 파일 참조 */
export type SayExtra = { react?: { seq: number; mark: string; on: boolean }; files?: TeamFile[] };

// 채팅 붙이기 — 팀 보관함(team-locker 세션의 team_locker_cmd): 방 사람 기기마다 봉투로 올리고 FileRef 를 돌려준다
export const teamFileAttach = (team: string, room: string, paths: string[]) => invoke<TeamFile[]>('team_file_attach', { team, room, paths });
/** 받아서 데이터 폴더 자리(team-locker-peek)에 풀기 — 푼 경로. external 이면 맥 기본 앱으로도 연다(스페이스가 못 그리는 형식·'다른 앱으로 열기') */
export const teamFileOpen = (team: string, id: string, external = false) => invoke<string>('team_file_open', { team, id, external });
/** 이 기기 팀 폴더(~/Documents/Chammo/<팀>/대화 파일)에 저장하고 파인더에서 보이기 — 받은 경로 */
export const teamFileSave = (team: string, id: string) => invoke<string>('team_file_save', { team, id }).then((path) => invoke('locker_reveal', { path }).then(() => path));
/** 앱 창에 붙는 파일 고르기 시트(NSOpenPanel) — 고른 경로들(취소면 []) */
export const teamPickFiles = () => invoke<string[]>('team_pick_files');

// 단톡방(chammo-relay team-rooms) — 사람·방 이름은 명부 room 고리로만 바뀐다(Rust team_rooms). people = 멤버 id
export const teamRoomNew = (team: string, name: string, people: string[]) => invoke<{ room: string; name: string }>('team_ui_room_new', { team, name, people });
export const teamRoomSet = (room: string, name: string, add: string[], remove: string[]) => invoke<TeamView>('team_ui_room_set', { room, name, add, remove });
/** 단톡방 나가기 — 화면이 확인을 받은 뒤에만 */
/** '전체' 팀챗 — 없을 때만 만든다(Rust 가 서버 목록을 새로 보고, 팀마다 정해진 방 id). 이미 있거나 예전에 지웠으면 made: false */
export const teamAllRoom = (team: string, name: string, people: string[]) => invoke<{ made: boolean; room?: string }>('team_ui_all_room', { team, name, people });
/** 우클릭 메뉴 — 만든 사람(멤버 id)·내가 지울 수 있나(만든 사람·팀장) */
export const teamRoomInfo = (room: string) => invoke<{ by: string; canDelete: boolean }>('team_ui_room_info', { room });
/** 팀챗 지우기 — 모두에게서 사라진다(방 말까지). 화면이 글자 확인을 받은 뒤에만 */
export const teamRoomDelete = (room: string) => invoke<TeamView>('team_ui_room_delete', { room });
export const teamRoomLeave = (room: string) => invoke<TeamView>('team_ui_room_leave', { room });

// ── 메신저 본 화면(시안 v2) — 메인 창·메신저 따로 창(team-*) ─────────────
/** 보안 번호가 바뀌어 멈춘 말(Rust e2e_state::Held) — 받아들이면 보낸다 */
export type HeldMsg = { room: string; cid: string; body: string; human: boolean; at: number; account: string };
export type TeamFeed = { view: TeamView; items: TeamItem[]; safety?: SafetyPerson[]; held?: HeldMsg[] };
/** 보안 번호 '같아요'(확인됨)·막아 둔 카드 다시 띄우기 — 메인 창·메신저 창 */
export const e2eSafetyVerify = (account: string) => invoke<void>('e2e_safety_verify', { account });
export const e2eSafetyUnblock = (account: string) => invoke<void>('e2e_safety_unblock', { account });
/** 갈린 사람 '다시 받기' — 서버에서 사슬을 새로 받아 그 번호로 카드를 다시 띄운다 */
export const e2eSafetyRefetch = (account: string) => invoke<void>('e2e_safety_refetch', { account });
/** 받아들이기·막아 두기 — 결정 대기함 카드 답과 같은 문(direct_answer, 메인 창만) */
export const safetyAnswer = (card: string, yes: boolean) => invoke<void>('direct_answer', { id: card, pick: { pick: yes ? 'yes' : 'no' } });
export const teamFeed = (n = 400) => invoke<TeamFeed>('team_feed', { n });
export const teamCreate = (team: string, me = '') => invoke<TeamView>('team_ui_create', { team, me });
export const teamJoin = (invite: string, me = '') => invoke<TeamView>('team_ui_join', { invite, me });
export const teamInvite = () => invoke<{ code: string; expiresAt: number; link: string }>('team_ui_invite');
// 팀 설정(메신저 머리 톱니·팀 아이콘 메뉴) — 메인 창·메신저 창 전용. 나가기·빼기는 화면이 확인을 받은 뒤에만 부른다
export type OpenInvite = { id: string; createdAt: number; expiresAt: number };
// team = 팀 id(팀 여러 개 — 빈 글이면 지금 팀). 나가기·빼기·팀장은 scripts/team 과 같은 Rust 길(team_relay leave·remove_member·set_role)
export const teamRename = (team: string, name: string) => invoke<TeamView>('team_ui_rename', { team, name });
export const teamInvites = (team: string) => invoke<OpenInvite[]>('team_ui_invites', { team });
export const teamRevokeInvites = (team: string) => invoke<number>('team_ui_revoke_invites', { team });
export const teamLeave = (team: string) => invoke<TeamView>('team_ui_leave', { team });
/** 지금 팀 바꾸기(띠·메신저 창 팀 아이콘 메뉴) — scripts/team use 와 같은 team_relay::use_team */
export const teamUse = (team: string) => invoke<TeamView>('team_ui_use', { team });
/** 팀 지우기(팀장) — 확인 창 뒤에만. 되돌릴 수 없다 */
export const teamDelete = (team: string) => invoke<TeamView>('team_ui_delete', { team });
export const teamRemove = (team: string, member: string) => invoke<TeamView>('team_ui_remove', { team, member });
export const teamMakeOwner = (team: string, member: string) => invoke<TeamView>('team_ui_make_owner', { team, member });
/** 클립보드에 받은 초대 링크가 있으면 그 링크만(원문은 Rust 가 안 넘긴다) — '초대받았어요'를 누를 때 */
export const teamClipInvite = () => invoke<string | null>('team_clip_invite');
/** chammo://join 으로 앱이 열렸을 때 기다리던 초대(한 번만 가져간다, ADR 0015) */
export const teamTakeInvite = () => invoke<string | null>('team_take_invite');
/** 이 창이 지금 보는 대화(빈 글 = 안 봄) — Rust 가 그 대화 새 말엔 안 울린다 */
export const teamViewing = (room: string) => invoke<void>('team_viewing', { room }).catch(() => {});

export type TeamAlert = { settings: { sound: boolean; name: string }; sounds: string[] };
export const teamAlertGet = () => invoke<TeamAlert>('team_alert_get');
export const teamAlertSet = (sound: boolean, name: string) => invoke<void>('team_alert_set', { sound, name });
export const teamSoundTry = (name: string) => invoke<void>('team_sound_try', { name });

export type TeamWindowState = { open: string[]; shown: string[]; screens: number; spotAlive: boolean };
export const teamWindowOpen = (key: string, title = '') => invoke<string>('team_window_open', { key, title });
export const teamWindowClose = (key: string) => invoke<void>('team_window_close', { key });
export const teamWindowState = () => invoke<TeamWindowState>('team_window_state');
