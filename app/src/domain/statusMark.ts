// 세션 상태 → 사이드바 표시 모양. 순수 TS — 그리는 건 ui/StatusMark.tsx
import { tr } from '../i18n';
import type { SessionState } from './session';

/** working = 도는 중(움직임) · waiting = 사람 차례(손바닥) · idle = 멈춤 · none = 세션 없음 */
export type StatusKind = 'working' | 'waiting' | 'idle' | 'none';

export function statusKind(state: SessionState | undefined): StatusKind {
  switch (state) {
    case 'working':
      return 'working';
    case 'blocked': // 권한 창·선택지 — 사람이 답해야 넘어간다
      return 'waiting';
    case 'idle':
      return 'idle';
    default:
      return 'none';
  }
}

// 급한 순서 — 사람 차례가 맨 앞
const RANK: Record<StatusKind, number> = { waiting: 0, working: 1, idle: 2, none: 3 };
const byUrgency = (states: SessionState[]) => states.map(statusKind).sort((a, b) => RANK[a] - RANK[b]);

/** 여러 세션 중 가장 급한 것 — 프로젝트 줄 왼쪽 표시 */
export function urgentKind(states: SessionState[]): StatusKind {
  return byUrgency(states)[0] ?? 'none';
}

/**
 * 세션마다 표시 하나. max 넘으면 (max-1)개 + 나머지 수.
 * 급한 것부터 세우니 손바닥은 수 뒤로 숨지 않는다
 */
export function sessionMarks(states: SessionState[], max = 4): { marks: StatusKind[]; more: number } {
  const all = byUrgency(states);
  if (all.length <= max) return { marks: all, more: 0 };
  return { marks: all.slice(0, max - 1), more: all.length - (max - 1) };
}

export function statusLabel(kind: StatusKind): string {
  switch (kind) {
    case 'working':
      return tr('작업 중', 'Working');
    case 'waiting':
      return tr('답을 기다리는 중', 'Waiting for you');
    case 'idle':
      return tr('대기', 'Idle');
    default:
      return tr('세션 없음', 'No session');
  }
}
