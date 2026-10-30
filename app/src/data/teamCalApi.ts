// 팀 캘린더 길(chammo-relay ADR 0011) — 데스크톱은 Tauri 명령(team_app_cmd), 폰은 맥 폰 서버(/api/team-cal). 봉하기·합치기는 Rust
import { invoke } from '@tauri-apps/api/core';
import type { CalData, CalSnap, CalWrite } from '../domain/teamCal';

export type CalApi = {
  /** 망 없이 — 이 기기 메모리·봉한 캐시. 처음이면 null */
  cached: (team: string) => Promise<CalSnap | null>;
  /** 따라잡기(본 판 뒤만) */
  sync: (team: string) => Promise<CalSnap>;
  /** 1초마다 — 바뀐 번호·다시 받아야 함(망 안 씀) */
  poll: (team: string) => Promise<{ ver: number; stale: boolean }>;
  /** 만들기·고치기·지우기(data null) — base = 고치기 시작한 판 */
  put: (team: string, id: string, base: number, before: CalData | null, data: CalData | null, restore?: boolean) => Promise<CalWrite>;
};

export const desktopCal: CalApi = {
  cached: (team) => invoke<CalSnap | null>('team_cal_cached', { team }),
  sync: (team) => invoke<CalSnap>('team_cal', { team }),
  poll: (team) => invoke<{ ver: number; stale: boolean }>('team_cal_poll', { team }),
  put: (team, id, base, before, data, restore) => invoke<CalWrite>('team_cal_put', { team, id, base, before, data, restore: !!restore }),
};
