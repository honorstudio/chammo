// 팀 참모(ADR 0017) — Rust team_agent_cmd. 정의는 팀 홈 글과 같은 팀 보관함 봉투 길(서버엔 평문 없음)
import { invoke } from '@tauri-apps/api/core';
import { refCandidates, type AgentDef, type AgentList, type AgentRef } from '../domain/teamAgent';
import type { LockerView } from '../domain/teamLocker';

export const teamAgents = (team: string) => invoke<AgentList>('team_agents', { team });
/** 망 없이 마지막 목록(부르기 메뉴·말풍선 얼굴) */
export const teamAgentsCached = (team: string) => invoke<AgentList>('team_agents_cached', { team });
/** origin = 고칠 참모 id — 참모 id 를 돌려준다 */
export const teamAgentSave = (team: string, def: AgentDef, origin?: string) => invoke<string>('team_agent_save', { team, def, origin: origin ?? null });
export const teamAgentRemove = (team: string, id: string) => invoke<void>('team_agent_remove', { team, id });
/** 보내기 직전 확인 장에서 '확인하고 부르기' */
export const teamAgentConfirm = (team: string, id: string) => invoke<void>('team_agent_confirm', { team, id });
/** 그 방에서 이 기기가 부른 팀 참모 답의 토큰 — seq → [모델, 토큰] */
export const teamAgentUsage = (room: string) => invoke<Record<string, [string, number]>>('team_agent_usage', { room });
export type Tried = { text: string; files: string[]; model: string; tokens: number; ms: number };
/** 시험으로 불러 보기 — 방엔 안 올린다. prev = 앞 시험 문답 */
export const teamAgentTry = (team: string, room: string, def: AgentDef, ask: string, prev: [string, string][]) => invoke<Tried>('team_agent_try', { team, room, def, ask, prev });
/** 참고 자료로 고를 팀 보관함 글 파일 — 기기에 봉해 둔 마지막 목록부터(망 없이), 없으면 새로 받는다 */
export const teamAgentRefFiles = async (team: string): Promise<AgentRef[]> => {
  const v = (await invoke<LockerView | null>('team_locker_cached', { team }).catch(() => null)) ?? (await invoke<LockerView>('team_locker_list', { team }));
  return refCandidates(v.items);
};
