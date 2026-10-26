// 팀 프로필(이름·사진·상태·상태 글)·팀 아이콘 — Rust team_profile(팀 보관함 암호 길, 서버엔 평문 없음). 그림은 data URL 로 오간다
// teamApi.ts 와 따로 둔 건 단톡방 가지(team-rooms)가 그 파일을 크게 고쳐서
import { invoke } from '@tauri-apps/api/core';
import type { ProfileBoard } from '../domain/teamProfile';

export const teamProfiles = (team = '') => invoke<ProfileBoard>('team_profiles', { team });
/** 화면이 본 판(rev)보다 새 판이 알려졌나 — 창마다 자기 판을 든다 */
export const teamProfileChanged = (team: string, rev: number) => invoke<boolean>('team_profile_changed', { team, rev });
/** 바꿀 것만 — photo: 잘라 만든 그림 data URL · '' = 사진 지우기. 돌려받는 건 실패한 팀 이유(다른 팀은 바뀜) */
export const teamProfileSet = (c: { name?: string; status?: string; note?: string; photo?: string }) => invoke<string[]>('team_profile_set', c);
export const teamIconSet = (team: string, image: string) => invoke<void>('team_icon_set', { team, image });
