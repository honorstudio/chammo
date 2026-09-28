// 하위 세션 선택지 창 → 참모에게 넘긴다 — 2026-09-28 사용자 "세션이 감지해서 나한테 되묻거나 자기가 판단해야".
// 앱은 하위 세션 질문을 사용자에게 직접 안 띄운다(참모 몫). 그런데 참모는 그 창을 못 봐서, 사용자가 손바닥을 눌러 봐야 알았다.
// 선택지 창에서 GRACE_MS 넘게 멈춘 하위 세션을 참모 입력칸에 한 줄로 알린다 → 참모가 scripts/choice 로 읽고 답하거나 사용자에게 묻는다
import { tr } from '../i18n';
import type { Session } from './session';

export const GRACE_MS = 30_000;

/** 세션 id → 선택지 창에서 처음 본 때. 넘기고 나면 FORWARDED — 창이 닫히면 지운다 */
export type AskTrack = Map<string, number>;
const FORWARDED = -1;

/**
 * 이번에 참모에게 넘길 하위 세션(한 번에 하나) + 갱신한 기록.
 * 참모가 확인창에 걸려 있으면 기다린다 — 그 입력칸에 글자 + Enter 를 넣으면 참모 창의 선택지를 골라 버린다
 */
export function nextForward(
  subs: Session[],
  orch: Session | undefined,
  track: AskTrack,
  now: number,
  watching: (s: Session) => boolean,
): { sub?: Session; track: AskTrack } {
  const next: AskTrack = new Map();
  const asking = subs.filter((s) => s.kind === 'background' && s.waitingFor === 'input needed');
  for (const s of asking) next.set(s.id, track.get(s.id) ?? now);
  if (!orch || orch.state === 'blocked') return { track: next };
  const sub = asking.find((s) => next.get(s.id) !== FORWARDED && now - next.get(s.id)! >= GRACE_MS && !watching(s));
  if (sub) next.set(sub.id, FORWARDED);
  return { sub, track: next };
}

const whereOf = (s: Session) => [s.project, s.workspace, s.name && s.name !== s.project ? s.name : null].filter(Boolean).join(' / ');

/** 참모 입력칸에 들어갈 한 줄 (Enter 로 보내져서 줄바꿈 없이) */
export const forwardText = (s: Session) =>
  tr(
    `[앱] ${whereOf(s)} 세션(${s.id})이 선택지 창에서 멈췄어 — scripts/choice show ${s.id} 로 읽고, 되돌리기 쉬운 건 네가 골라 scripts/choice answer ${s.id} <번호…> 로 답하고, 사용자가 정할 거면 물어봐`,
    `[app] ${whereOf(s)} session (${s.id}) is stuck on a choice prompt — read it with scripts/choice show ${s.id}; answer easy-to-undo ones yourself with scripts/choice answer ${s.id} <numbers…>, and ask the user when it's theirs to decide`,
  );
