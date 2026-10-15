// 세션 상태 → 사이드바 표시 모양. 순수 TS — 그리는 건 ui/StatusMark.tsx
import { tr } from '../i18n';
import type { Session, SessionState } from './session';
import { statusWord, type ActivityStatus } from './status';

/** 세션 판단(ActivityStatus) — 날 상태(SessionState)도 그 일부라 그대로 받는다 */
type St = SessionState | ActivityStatus;

/** working = 도는 중(움직임) · waiting = 사람 차례(말풍선) · idle = 멈춤 · none = 세션 없음 */
export type StatusKind = 'working' | 'waiting' | 'idle' | 'none';

export function statusKind(state: St | undefined): StatusKind {
  switch (state) {
    case 'working':
      return 'working';
    case 'blocked': // 권한 창·선택지 — 사람이 답해야 넘어간다
    case 'asks': // 질문으로 턴을 끝냄
    case 'login':
      return 'waiting';
    case undefined:
      return 'none';
    default: // 쉼·답함·잠듦·백그라운드 기다림·모름
      return 'idle';
  }
}

// 급한 순서 — 사람 차례가 맨 앞
const RANK: Record<StatusKind, number> = { waiting: 0, working: 1, idle: 2, none: 3 };
const byUrgency = (states: St[]) => states.map(statusKind).sort((a, b) => RANK[a] - RANK[b]);

/** 여러 세션 중 가장 급한 것 — 프로젝트 줄 왼쪽 표시 */
export function urgentKind(states: St[]): StatusKind {
  return byUrgency(states)[0] ?? 'none';
}

/**
 * 세션마다 표시 하나. max 넘으면 (max-1)개 + 나머지 수.
 * 급한 것부터 세우니 말풍선은 수 뒤로 숨지 않는다
 */
export function sessionMarks(states: St[], max = 4): { marks: StatusKind[]; more: number } {
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

/** 프로젝트 줄 둘째 줄 — 세션 하나면 그 상태 말(statusWord, 채팅 사이드바·대시보드와 같은 말) · 이름, 여럿이면 창 수·작업 중 수·묻는 수 */
export function projectLine<S extends Pick<Session, 'name' | 'workspace'>>(sessions: S[], of: (s: S) => ActivityStatus): string {
  if (sessions.length === 1) {
    const s = sessions[0]!;
    return `${statusWord(of(s))} · ${s.workspace ?? s.name}`;
  }
  const sts = sessions.map(of);
  const working = sts.filter((x) => x === 'working').length;
  const asking = sts.filter((x) => statusKind(x) === 'waiting').length;
  const base = tr(`창 ${sessions.length} · 작업 중 ${working}`, `${sessions.length} panes · ${working} working`);
  return asking ? `${base} · ${tr(`물어봄 ${asking}`, `${asking} asking`)}` : base;
}
