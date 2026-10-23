// 팀 메신저(중계 서버) — 화면은 Rust 명령만 부른다. 소켓은 Rust 가 쥐고(team_relay_ws), 받은 말은 Rust 가 내 참모에게 넘긴다.
// 사람 말(team_human_say)은 메인 창의 진짜(isTrusted) 키·클릭 뒤 1.5초 안에서만 — 다른 기기 참모 채팅(remoteChat)과 같은 문.
// 참모·스크립트는 scripts/team(늘 참모 말)로만 보낸다
import { invoke } from '@tauri-apps/api/core';
import { sendAllowed } from '../domain/remoteChat';
import type { TeamAccount, TeamDevice } from '../domain/teamAccount';
import type { TeamItem } from '../domain/teamChat';

export type TeamView = {
  joined: boolean;
  team: string;
  teamId: string;
  me: string;
  device: string;
  role: string;
  server: string;
  deliverTo: string;
  members: { id: string; name: string; role: string; me: boolean }[];
  rooms: { id: string; kind: string; peer: string; with: string }[];
  /** 구글로 로그인한 기기면 그 계정(서버 ADR 0004) */
  account: TeamAccount | null;
  devices: TeamDevice[];
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

/** 사람이 친 말 — trustedAt 은 그 입력칸의 마지막 진짜 키·클릭 시각. 문 밖이면 안 보낸다(null) */
export function teamHumanSay(to: string, text: string, trustedAt: number, now = Date.now()): Promise<{ room: string; seq: number }> | null {
  if (!sendAllowed(trustedAt, now) || !text.trim()) return null;
  return invoke('team_human_say', { to, text, cid: newCid() });
}

// ── 메신저 본 화면(시안 v2) — 메인 창·메신저 따로 창(team-*) ─────────────
export type TeamFeed = { view: TeamView; items: TeamItem[] };
export const teamFeed = (n = 400) => invoke<TeamFeed>('team_feed', { n });
export const teamCreate = (team: string, me = '') => invoke<TeamView>('team_ui_create', { team, me });
export const teamJoin = (invite: string, me = '') => invoke<TeamView>('team_ui_join', { invite, me });
export const teamInvite = () => invoke<{ code: string; expiresAt: number; link: string }>('team_ui_invite');
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
