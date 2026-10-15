// 상태 점(홈·모드 v1 정할 것 9, 사용자 10/11) — 일함 · 기다림(사람 차례) · 쉼 · 꺼짐. 그리는 모양은 locker.css .lk-dot.d-*
// 프사 띠·나무·진행 중 칩·세션 줄·활동 줄이 다 이 판단 하나를 쓴다
import type { ActivityStatus } from './status';

export type DotKind = 'run' | 'ask' | 'rest' | 'off';

const HUMAN: ActivityStatus[] = ['asks', 'blocked', 'login'];

/** 세션 하나 — status 는 대시보드 줄(run·ask·wait), st 는 세션 판단. 꺼진 세션은 off */
export function dotKind(l: { status?: 'run' | 'ask' | 'wait'; st?: ActivityStatus; off?: boolean }): DotKind {
  if (l.off || (!l.status && !l.st)) return 'off';
  if (l.status === 'ask' || (l.st && HUMAN.includes(l.st))) return 'ask';
  if (l.status === 'run' || l.st === 'working') return 'run';
  return 'rest';
}

const RANK: Record<DotKind, number> = { ask: 0, run: 1, rest: 2, off: 3 };

/** 여럿 중 가장 급한 것(프로젝트 줄·칩) — 없으면 꺼짐 */
export function worstDot(ks: DotKind[]): DotKind {
  return [...ks].sort((a, b) => RANK[a] - RANK[b])[0] ?? 'off';
}
