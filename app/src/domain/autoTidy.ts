// 세션 자동 정리(2026-10-23 사용자 "참모들이 잡고 있는 세션이 지저분하다 — 초보들은 나처럼 관리 안 할 것 같다").
// 사람이 세션 끄기를 배우지 않아도 되게, 끝난 팀 세션을 앱이 알아채서 맡긴 참모 입력칸에 [앱] 한 줄을 넣는다 → 참모가 starter·roadmap 갱신 → claude stop → 끝난 워크트리 정리.
// 정리 대상: ① 맡긴 일이 다 done + 마지막 움직임에서 2시간(진행 칸 GOAL_IDLE_MS 와 같은 2시간) ② 맡긴 기록이 없는 세션이 24시간 조용.
// 빼는 것: 안 닫힌 일·task wait·결정 대기(ask·직접 답하기 카드)·커밋 안 한 변경·main 에 안 들어간 커밋·선택지 창·사람 답 기다림·사람이 2시간 안에 친 입력
import { tr } from '../i18n';
import type { Activity } from './activity';
import { sendsTo } from './lostTriage';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

export const TIDY_DONE_MS = 2 * 3600_000;
export const TIDY_LOOSE_MS = 24 * 3600_000;
/** 사람이 그 세션에 직접 친 입력이 이보다 최근이면 안 건드린다 */
export const TIDY_HUMAN_MS = 2 * 3600_000;

/** 세션 폴더 git — dirty 커밋 안 한 변경, unmerged 기본 가지(main)에 안 들어간 커밋. git 이 아닌 폴더는 둘 다 false(Rust tidy_git) */
export type TidyGit = { dirty: boolean; unmerged: boolean };
/** git 을 아직 안 봤으면 undefined — 판정은 하고 needGit 으로 알린다(git 은 후보만 본다) */
export type TidyCand = { session: Session; activity?: Activity; git?: TidyGit };
export type TidyReason = 'done' | 'quiet';
export type TidyVerdict = { reason: TidyReason; since: number; needGit?: true };

const ms = (t?: string) => (t ? Date.parse(t) || 0 : 0);

/** 이 일들에 걸린 기다림 — 결정 대기(ask 뒤 answer 없음)·task wait(뒤에 reply·done·answer·retry 가 없고 until 이 안 지남) */
function held(tasks: Set<string>, events: TaskEvent[], now: number): boolean {
  const ask = new Set<string>();
  const wait = new Map<string, TaskEvent>();
  for (const e of events) {
    if (!tasks.has(e.task)) continue;
    if (e.type === 'ask') ask.add(e.task);
    else if (e.type === 'answer') ask.delete(e.task);
    if (e.type === 'wait') wait.set(e.task, e);
    else if (e.type === 'reply' || e.type === 'done' || e.type === 'answer' || (e.type === 'note' && e.retry)) wait.delete(e.task);
  }
  return ask.size > 0 || [...wait.values()].some((w) => !w.until || ms(w.until) > now);
}

/**
 * 정리할 세션인가. events = tasks.jsonl, asking = 직접 답하기 카드(답 기다림)를 띄운 세션 id·대화 id.
 * since = 마지막 움직임(세션 뜬 때·대화 줄·그 세션 일 기록 중 늦은 것) — 같은 조용한 구간엔 한 번만 알리는 열쇠
 */
export function tidyVerdict(c: TidyCand, o: { events: TaskEvent[]; now: number; asking: ReadonlySet<string> }): TidyVerdict | undefined {
  const { session: s, activity: a, git } = c;
  if (s.kind !== 'background' || s.state !== 'idle' || s.awaiting || s.waitingFor) return undefined;
  if (a?.wake || a?.limit || a?.auth) return undefined;
  if (git && (git.dirty || git.unmerged)) return undefined;
  if (o.asking.has(s.id) || (s.sessionId && o.asking.has(s.sessionId))) return undefined;
  if (a?.prompt && o.now - ms(a.prompt.ts) < TIDY_HUMAN_MS) return undefined;
  const sends = sendsTo({ sessionId: s.sessionId ?? s.id, id: s.id, name: s.name, cwd: s.cwd, startedAt: s.startedAt || undefined }, o.events);
  const tasks = new Set(sends.map((e) => e.task));
  const closed = new Set(o.events.filter((e) => e.type === 'done' && tasks.has(e.task)).map((e) => e.task));
  if ([...tasks].some((t) => !closed.has(t)) || held(tasks, o.events, o.now)) return undefined;
  const since = Math.max(
    s.startedAt || 0,
    ms(a?.lastAt), ms(a?.reply?.ts), ms(a?.prompt?.ts), ms(a?.peer?.ts),
    ...o.events.filter((e) => tasks.has(e.task)).map((e) => ms(e.ts)),
  );
  const reason: TidyReason = tasks.size ? 'done' : 'quiet';
  if (o.now - since < (reason === 'done' ? TIDY_DONE_MS : TIDY_LOOSE_MS)) return undefined;
  return git ? { reason, since } : { reason, since, needGit: true };
}

/** 같은 세션·같은 조용한 구간은 한 번만 */
export const tidyKey = (s: Session, since: number) => `${s.sessionId ?? s.id}:${since}`;

/**
 * 이번에 알릴 세션 하나 + 받을 참모(맡긴 참모 → … → 맨 앞, forwardTo). 받을 참모가 일하는 중·확인창이면 이번엔 건너뛴다 —
 * 조건은 그대로 남아 있으니 다음 폴링에 다시 잡힌다(= 쌓아 뒀다 한가할 때). git 을 아직 안 본 후보는 고르지 않는다
 */
export function pickTidy(
  cands: TidyCand[],
  o: { events: TaskEvent[]; now: number; asking: ReadonlySet<string>; seen: ReadonlySet<string>; toOf: (s: Session) => Session | undefined },
): { cand: TidyCand; verdict: TidyVerdict; to: Session } | undefined {
  for (const cand of cands) {
    const v = tidyVerdict(cand, o);
    if (!v || v.needGit || o.seen.has(tidyKey(cand.session, v.since))) continue;
    const to = o.toOf(cand.session);
    if (!to || to.state !== 'idle') continue;
    return { cand, verdict: v, to };
  }
  return undefined;
}

/** 도우미(HQ 안에서 띄운 세션)·예약(routine-<이름>) 세션 — starter 가 없어서 갱신 없이 바로 끈다 */
export const tidyLight = (s: Session, helpers: readonly Session[]) => s.name.startsWith('routine-') || helpers.some((h) => h.id === s.id);

/** 참모 입력칸에 넣을 한 줄(Enter 로 보내져서 줄바꿈 없이) — 재시작으로 꺼진 세션 줄과 같은 모양. light = 도우미·예약(tidyLight) */
export function tidyText(s: Session, reason: TidyReason, light = false): string {
  const name = s.name || s.project || s.cwd.split('/').filter(Boolean).pop() || s.id;
  const ws = s.workspace ? tr(` · 워크트리 ${s.workspace}`, ` · worktree ${s.workspace}`) : '';
  const why = reason === 'done'
    ? tr('맡긴 일 다 끝남·2시간 조용', 'all its tasks are done, quiet for 2 hours')
    : tr('하루 넘게 조용', 'quiet for over a day');
  const todo = light
    ? tr('도우미·예약 세션이라 starter·roadmap 갱신 없이 바로 끄기', "a helper/routine session, so just stop it (no starter/roadmap update)")
    : tr('starter·roadmap 갱신시키고 끄고, 끝난 워크트리는 정리', 'Have it update starter/roadmap, stop it, and clean up a finished worktree');
  return tr(`[앱] 정리할 세션: ${name}(${s.id})${ws} — ${why}. ${todo}`, `[app] Session to tidy: ${name} (${s.id})${ws} — ${why}. ${todo}`);
}
