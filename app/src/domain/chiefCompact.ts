// 참모 자동 정리(2026-11-17 사용자 "사용자들이 쓸 때 알아서 컴팩트를 해야 하잖아? 성능에는 문제없게").
// 참모 대화가 40% 를 넘고 10분 넘게 조용하면: 인계(handoff.md) → /compact(요약 뒤 handoff 다시 읽기) → % 가 줄었나 확인.
// Claude Code 자동 압축은 95% 근처라 그 전까지 매 턴 수십만 토큰을 다시 읽는다. 일하는 중엔 70% 를 넘어도 끊지 않는다 — 다음 쉬는 틈까지.
// 하위 세션의 60/80% 인계 규칙(참모 메모리 subsession-context-policy)을 참모에게 넓힌 것. 흐름은 ui/useChiefCompact
import type { ActivityStatus } from './status';

/** 이 % 부터 정리 후보 */
export const COMPACT_MIN = 40;
/** 마지막 대화 줄부터 이만큼 조용해야 — 사람이 잠깐 다른 걸 보는 사이에 끊지 않게 */
export const QUIET_MS = 10 * 60_000;
/** 인계 파일을 이 안에 못 쓰면 그만 */
export const HANDOFF_MAX_MS = 10 * 60_000;
/** /compact 뒤 % 가 이 안에 안 줄면 실패로 적는다 */
export const COMPACT_MAX_MS = 15 * 60_000;
/** 이만큼(%p) 줄어야 정리된 것 — 1~2% 오르내림은 압축이 아니다 */
export const MIN_DROP = 10;
/** 실패한 뒤 다시 해 보기까지 */
export const COOL_MS = 60 * 60_000;

/** 쉬는 상태 — 턴을 끝내고 아무것도 안 기다림. asks(사람 답)·bgwait(뒤 일)·blocked(창)·login 은 기다리는 중 */
const RESTING: ActivityStatus[] = ['idle', 'done'];

export type VerdictIn = {
  used?: number;
  status: ActivityStatus;
  /** 마지막 대화 줄 시각(ms) */
  lastAt?: number;
  now: number;
  /** 사람이 그 참모 채팅을 보고 있다(창에 포커스 + 그 탭) */
  viewing: boolean;
  /** 입력칸에 글을 치는 중 */
  typing: boolean;
  /** 답을 기다리는 카드가 있다 */
  asking: boolean;
  coolUntil?: number;
  /** 시작 % — 참모는 COMPACT_MIN, 프로젝트 세션은 PROJECT_MIN(domain/projectCompact) */
  min?: number;
};

export function compactVerdict(i: VerdictIn): 'go' | 'wait' | 'no' {
  if (i.used == null || i.used < (i.min ?? COMPACT_MIN)) return 'no';
  if (!RESTING.includes(i.status) || i.asking || i.viewing || i.typing) return 'wait';
  if (i.lastAt == null || i.now - i.lastAt < QUIET_MS) return 'wait';
  if (i.coolUntil != null && i.now < i.coolUntil) return 'wait';
  return 'go';
}

/** 입력칸 글이 '치는 중'인가 — 비었으면 아님, 마지막으로 바뀐 지 10분이 넘은 글은 잊고 둔 글(그것 때문에 영영 안 하면 안 된다) */
export const typingNow = (text: string, changedAt: number, now: number) => text.trim() !== '' && now - changedAt < QUIET_MS;

export type Flow = { phase: 'handoff' | 'compact'; at: number; before: number; mtime0: number };
/** idle = claude agents 가 일 안 함으로 본다 — 압축 요약 줄(isCompactSummary)이 기록에 사람 말처럼 들어가 앱 판정(status)은 다음 답까지 working 이다(11-17 실측) */
export type StepIn = { now: number; status: ActivityStatus; used?: number; mtime?: number; idle?: boolean };
export type Step = { kind: 'wait' } | { kind: 'compact' } | { kind: 'done'; after: number } | { kind: 'fail'; why: string; after?: number };

export function compactStep(f: Flow, i: StepIn): Step {
  const resting = RESTING.includes(i.status);
  if (f.phase === 'handoff') {
    if ((i.mtime ?? 0) > f.mtime0 && resting) return { kind: 'compact' };
    return i.now - f.at > HANDOFF_MAX_MS ? { kind: 'fail', why: 'handoff-timeout' } : { kind: 'wait' };
  }
  if ((resting || i.idle) && i.used != null && i.used <= f.before - MIN_DROP) return { kind: 'done', after: i.used };
  return i.now - f.at > COMPACT_MAX_MS ? { kind: 'fail', why: 'no-drop', after: i.used } : { kind: 'wait' };
}

/** 정리 전 참모에게 — 한 줄(입력칸에 치는 말이라 줄바꿈 없이) */
export const handoffText = (path: string) =>
  `[앱] 대화가 길어져서 곧 정리(/compact)할게. 그 전에 지금 진행 중인 일·기다리는 답·최근 결정·다음 할 일(맡긴 세션 이름·task id·건 조건 포함)을 ${path} 에 적어(덮어써). 다 적으면 '적었어' 한 줄만 답해.`;

/** /compact 요약 지시 — 요약 뒤 첫 일로 인계 파일을 다시 읽게 */
export const compactText = (path: string) =>
  `/compact 진행 중인 일·기다리는 답·세션에 건 조건(머지 금지 등)을 빠뜨리지 말고 요약해. 요약 뒤에는 먼저 ${path} 를 다시 읽고 이어서 해.`;
