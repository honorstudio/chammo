// 하위 세션 선택지 창 → 참모에게 넘긴다 — 2026-09-28 사용자 "세션이 감지해서 나한테 되묻거나 자기가 판단해야".
// 앱은 하위 세션 질문을 사용자에게 직접 안 띄운다(참모 몫). 그런데 참모는 그 창을 못 봐서, 사용자가 손바닥을 눌러 봐야 알았다.
// 선택지 창에서 GRACE_MS 넘게 멈춘 하위 세션을 참모 입력칸에 한 줄로 알린다 → 참모가 scripts/choice 로 읽고 답하거나 사용자에게 묻는다
import { tr } from '../i18n';
import type { Activity } from './activity';
import type { Session } from './session';
import type { TaskEvent } from './tasks';
import { findTarget } from './inbox';
import { owners } from './spaceNav';

export const GRACE_MS = 30_000;

/**
 * 멈춘 하위 세션을 받을 참모 — 그 세션에 마지막으로 일을 보낸(넘겨받았으면 새 주인) 참모 → 같은 프로젝트를 최근에 맡긴 참모 → 맡은 일로 고른 참모(heir) → 맨 앞 참모.
 * 꺼진 참모는 건너뛴다. 맨 앞 참모에게만 보내서 개발 담당 세션 알림이 참모 업데이트에게 갔다(2026-10-03)
 */
export function forwardTo(sub: Session, events: TaskEvent[], orchs: Session[], sessions: Session[], front?: Session, heir?: (sub: Session) => Session | undefined): Session | undefined {
  const own = owners(events);
  const alive = (id?: string) => orchs.find((o) => o.id === id);
  const sends = events.filter((e) => e.type === 'send' && e.target).reverse(); // 기록은 덧붙이는 순서 = 최근이 뒤
  const last = sends.find((e) => findTarget(sessions, e.target)?.id === sub.id);
  const mine = last && alive(own.get(last.task));
  if (mine) return mine;
  if (sub.project) {
    for (const e of sends) {
      const t = findTarget(sessions, e.target);
      const o = t && t.project === sub.project && !orchs.includes(t) ? alive(own.get(e.task)) : undefined;
      if (o) return o;
    }
  }
  // 그다음 맡은 일로(domain/orchRoles roleHeir) — 맡던 참모가 꺼졌을 때 대신 맡은 참모에게(2026-10-04 QA ⑥: 새 참모 말고 맨 앞으로 갔다)
  return heir?.(sub) ?? front;
}

/** 세션 id → 선택지 창에서 처음 본 때. 넘기고 나면 FORWARDED — 세션이 다시 일하거나(working) 없어지면 지운다 */
export type AskTrack = Map<string, number>;
const FORWARDED = -1;

/**
 * 이번에 참모에게 넘길 하위 세션(한 번에 하나) + 갱신한 기록.
 * 참모가 확인창에 걸려 있으면 기다린다 — 그 입력칸에 글자 + Enter 를 넣으면 참모 창의 선택지를 골라 버린다
 */
export function nextForward(
  subs: Session[],
  orch: Session | undefined | ((s: Session) => Session | undefined),
  track: AskTrack,
  now: number,
  watching: (s: Session) => boolean,
): { sub?: Session; to?: Session; track: AskTrack } {
  const next: AskTrack = new Map();
  const asking = subs.filter((s) => s.kind === 'background' && s.waitingFor === 'input needed');
  for (const s of asking) next.set(s.id, track.get(s.id) ?? now);
  // 넘긴 멈춤은 상태가 잠깐 흔들려(input needed 가 한 번 빠짐) 돌아와도 다시 안 넘긴다 — 세션이 다시 일해야(working) 새 멈춤
  for (const s of subs) if (!next.has(s.id) && track.get(s.id) === FORWARDED && s.state !== 'working') next.set(s.id, FORWARDED);
  const toOf = typeof orch === 'function' ? orch : () => orch;
  for (const s of asking) {
    if (next.get(s.id) === FORWARDED || now - next.get(s.id)! < GRACE_MS || watching(s)) continue;
    const to = toOf(s);
    if (!to || to.state === 'blocked') continue; // 받을 참모가 확인창에 걸려 있으면 기다린다
    next.set(s.id, FORWARDED);
    return { sub: s, to, track: next };
  }
  return { track: next };
}

const whereOf = (s: Session) => [s.project, s.workspace, s.name && s.name !== s.project ? s.name : null].filter(Boolean).join(' / ');

/** 참모 입력칸에 들어갈 한 줄 (Enter 로 보내져서 줄바꿈 없이) */
export const forwardText = (s: Session) =>
  tr(
    `[앱] ${whereOf(s)} 세션(${s.id})이 선택지 창에서 멈췄어 — scripts/choice show ${s.id} 로 읽고, 되돌리기 쉬운 건 네가 골라 scripts/choice answer ${s.id} <번호…> 로 답하고, 사용자가 정할 거면 물어봐`,
    `[app] ${whereOf(s)} session (${s.id}) is stuck on a choice prompt — read it with scripts/choice show ${s.id}; answer easy-to-undo ones yourself with scripts/choice answer ${s.id} <numbers…>, and ask the user when it's theirs to decide`,
  );

/** input needed 인데 선택지 창(AskUserQuestion)이 아닐 때 — scripts/choice 로는 못 읽는다 */
export const inputWaitText = (s: Session) =>
  tr(
    `[앱] ${whereOf(s)} 세션(${s.id})이 입력 기다림으로 멈췄어(선택지 창 아님) — 화면을 봐야 해서, 되돌리기 어려운 거면 사용자에게 그 세션 화면을 열어 달라고 해`,
    `[app] ${whereOf(s)} session (${s.id}) is stopped waiting for input (not a choice prompt) — it needs its screen; ask the user to open that session's screen`,
  );

// ── 질문으로 턴을 끝내고 기다리는 하위 세션(2026-09-30 조사: 사용자가 "멈췄다"고 알린 14건 중 1위) ──
// 선택지 창이 아니라 답 글로 묻고 끝낸 경우. 하위 세션이 그 턴에 참모에게 메시지를 안 보냈으면(보냈는데 참모 이름이 바뀌어 사라진 것 포함)
// 참모는 모른다 → ASK_GRACE_MS 뒤 참모 입력칸에 한 줄. 물음표가 없어도 Claude 가 '사람 답 기다림'(awaiting)으로 판단하면 넘긴다

export const ASK_GRACE_MS = 120_000;
const ASK_MAX_AGE = 24 * 3600_000;

export type AskCand = { session: Session; activity: Activity };
/** 같은 답은 한 번만 — 세션 + 답 시각 */
export const askKeyOf = (c: AskCand) => `${c.session.id}:${c.activity.reply?.ts ?? ''}`;

export function nextAskForward(
  cands: AskCand[],
  orch: Session | undefined | ((s: Session) => Session | undefined),
  done: ReadonlySet<string>,
  now: number,
  watching: (s: Session) => boolean,
): AskCand | undefined {
  const toOf = typeof orch === 'function' ? orch : () => orch;
  return cands.find((c) => {
    const to = toOf(c.session);
    if (!to || to.state === 'blocked') return false;
    const { session: s, activity: a } = c;
    const r = a.reply;
    if (s.kind !== 'background' || s.state !== 'idle' || !r?.turnEnd) return false;
    if (a.prompt && a.prompt.ts > r.ts) return false; // 새 지시를 받았다
    if (a.messaged && (!a.prompt || a.messaged >= a.prompt.ts)) return false; // 이번 턴에 SendMessage 로 이미 보고했다
    if (!r.asks && !s.awaiting) return false;
    const at = Date.parse(r.ts);
    if (!(at > s.startedAt)) return false; // 이어서 켜기 전의 옛 답 — 가져온 세션은 쉬어도 blocked 로 나온다
    if (now - at < ASK_GRACE_MS || now - at > ASK_MAX_AGE) return false;
    return !done.has(askKeyOf(c)) && !watching(s);
  });
}

/** 참모 대화 기록 꼬리에 since 뒤로 그 세션(from-name)이 보낸 메시지가 있나 */
export function toldOrch(tail: string, name: string, since: string): boolean {
  if (!name) return false;
  const from = Date.parse(since);
  const marks = [`from-name=\\"${name}\\"`, `from-name="${name}"`];
  return tail.split('\n').some((line) => {
    if (!marks.some((m) => line.includes(m))) return false;
    try {
      const ts = (JSON.parse(line) as { timestamp?: string }).timestamp;
      return !!ts && Date.parse(ts) >= from;
    } catch {
      return false;
    }
  });
}

/** 참모 입력칸에 들어갈 한 줄 */
export function askForwardText(s: Session, a: Activity, now: number): string {
  const r = a.reply!;
  const mins = Math.max(1, Math.round((now - Date.parse(r.ts)) / 60_000));
  const said = (r.ask?.q || r.tail || r.text).replace(/\s+/g, ' ').trim();
  const q = said.length > 140 ? '…' + said.slice(-140) : said;
  return tr(
    `[앱] ${whereOf(s)} 세션(${s.id})이 ${mins}분째 답을 기다려 — 마지막 말: "${q}" — 되돌리기 쉬운 건 네가 답하고(SendMessage), 사용자가 정할 거면 물어봐`,
    `[app] ${whereOf(s)} session (${s.id}) has been waiting for an answer for ${mins} min — last words: "${q}" — answer easy-to-undo ones yourself (SendMessage), ask the user when it's theirs to decide`,
  );
}

/** 넘기기(입력칸에 넣기)가 실패했을 때 또 해 볼까 — 세 번째 실패부터 그만. 윈도우에서 매번 실패해 40초마다 끝없이 다시 보냈다(2026-09-30) */
export const MAX_FORWARD_FAILS = 3;
export function retryAfterFail(fails: Map<string, number>, key: string): boolean {
  const n = (fails.get(key) ?? 0) + 1;
  fails.set(key, n);
  return n < MAX_FORWARD_FAILS;
}
