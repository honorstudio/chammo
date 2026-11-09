// 공식 설치 파일에만 있는 팀 화면이 들어오는 자리 — 공개 코드는 이 모양만 안다(@pro/index). 공개 빌드는 src/pro-stub 이 null 로 채운다
import type { ComponentType } from 'react';
import type { HomeApi } from './teamHome';
import type { HomeDialog } from '../ui/team/TeamHome';

export type ProBoardApi = {
  board: (team: string, seen: number | null) => Promise<unknown>;
  write: (team: string, op: unknown) => Promise<unknown>;
};

export type ProWeb = {
  /** 팀 스페이스·폰의 판 — null 이면 탭을 안 그린다 */
  MemoryTab: ComponentType<{ teamId: string; members: { id: string; name: string }[]; roomName: (id: string) => string; api?: ProBoardApi; homeApi?: HomeApi; phone?: boolean; Dialog?: HomeDialog }> | null;
  /** 팀 DM 맨 위 칸 — null 이면 줄도 칸도 안 그린다 */
  AgentChat: ComponentType<{ teamId: string; fontSize?: number }> | null;
  tabLabel: () => string;
  mineRow: () => { title: string; sub: string };
};
