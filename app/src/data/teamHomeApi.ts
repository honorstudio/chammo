// 팀 홈 판(ADR 0018) — Rust team_home_store(팀 보관함 봉투 길 kind post 안쪽 t=home·homeblk, 서버엔 평문 없음)
import { invoke } from '@tauri-apps/api/core';
import type { ContentDraft, Home, HomeApi, HomeBoard, HomeSources } from '../domain/teamHome';
import type { LockerView } from '../domain/teamLocker';
import { openTeamFile } from '../ui/team/openTeamFile';
import { openTarget } from './tauri';
import { teamAgents, teamAgentsCached } from './teamAgentApi';
import { teamProfileChanged } from './teamProfileApi';

export const teamHome = (team: string) => invoke<HomeBoard>('team_home', { team });

/** 데스크톱 판 길 — 글판과 같은 판 번호로 보관함이 바뀌었을 때만 다시 읽는다 */
export const desktopHome: HomeApi = {
  board: async (team, seen) => (seen === null || (await teamProfileChanged(team, seen)) ? teamHome(team) : { same: true }),
  save: (team, home: Home) => invoke('team_home_save', { team, home }),
  content: (team, block, content: ContentDraft) => invoke('team_home_content', { team, block, content }),
  cover: (team, image) => invoke<string>('team_home_cover', { team, image }),
};

/** 데스크톱 블록 출처 — 참모는 망 없는 목록부터, 파일은 봉해 둔 목록부터(판이 오르면 새로) */
export const desktopSources: HomeSources = {
  agents: async (team) => { const c = await teamAgentsCached(team).catch(() => null); return c?.agents.length ? c.agents : (await teamAgents(team)).agents; },
  files: async (team, fresh) => ((fresh ? null : await invoke<LockerView | null>('team_locker_cached', { team }).catch(() => null)) ?? (await invoke<LockerView>('team_locker_list', { team }))).items,
  openFile: (team, i) => void openTeamFile((external) => invoke<string>('team_locker_open', { team, id: i.id, external }), i.name).catch(() => {}),
  openUrl: (url) => void openTarget('url', url).catch(() => {}),
};
