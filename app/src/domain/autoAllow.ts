// 도구 권한 창 자동 허용 — 사용자 방침 2026-09-27 "권한은 항상 다 준다".
// 화면(attach 로 뜬 글자)을 읽어 선택지에서 Allow/Yes 줄을 **이름으로** 찾고, 커서에서 그 줄까지 화살표 + Enter.
// 권한 창 맨 위는 Deny 일 수 있다(computer-use) — Enter = 맨 위 가정 금지. 비밀번호·2FA·결제·과금 창은 사람 몫.
// 민감한 낱말은 창이 묻는 말에서만 찾는다 — 명령 본문·위쪽 대화 기록은 빼고(2026-09-28 project-b: 커밋 메시지의 "인증번호" 로 10분 멈춤)
import { tr } from '../i18n';
import { sentBy } from './forwardQuestion';
import type { Session } from './session';
import type { TaskEvent } from './tasks';
const SENSITIVE = /password|비밀번호|2fa|otp|인증\s*번호|결제|payment|billing|과금|credit card|카드/i;
const ALLOW = /\b(allow|yes|approve|continue|use|deliver)\b|허용|승인|전달/i;
const NOT = /deny|don't|do not|without|reject|cancel|거절|거부|다시 묻지/i;
/** "No" 는 줄 맨 앞일 때만 거절 — "Yes, and switch to BYPASS PERMISSIONS (no further prompts)" 의 no 는 아니다(2026-10-01 플랜 승인 창) */
const NO_FIRST = /^(\d+\.\s*)?no\b/i;
const DOWN = '\x1b[B';
const UP = '\x1b[A';

/** hold = 사람이 골라야 하는 창(민감함·허용 줄 없음) — 세션이 그 창을 벗어날 때까지 다시 안 본다. 커서를 못 찾은 건 화면이 덜 그려졌을 수 있어 hold 아님.
 *  soon = attach 가 붙는 중 뜨는 전환 화면 — 창이 아니다, 곧 다시 본다 */
export type AllowPick = { keys: string; option: string } | { skip: string; hold?: true; soon?: true };

/** attach 가 세션에 붙는 동안 잠깐 보이는 화면(Claude Code 문구) — 10-08~10 '커서 못 찾음' 35건 중 32건이 이것이었다 */
const ATTACHING = /session is starting|waiting for session to redraw|starting background service|waking session/i;

const SENSITIVE_SKIP = (): AllowPick => ({ skip: tr('민감한 창(비밀번호·인증·결제) — 직접 골라줘', 'Sensitive prompt (password, verification, payment) — choose it yourself'), hold: true });

const RULE = /─{4,}/;

/** 선택지 커서 줄 — 아래에서부터 찾는다. 창의 커서(❯ 1. Yes · ❯ Deny …)는 늘 한 칸 넘게 들여 쓴다 —
 *  맨 앞 칸의 ❯ 는 대화 기록의 '내 말'이나 입력칸이라 커서가 아니다. 찾는 길에 입력칸(구분선 바로 아래 맨 앞 ❯)을 먼저 만나면
 *  창이 아직 안 그려진 화면 — 그 위는 대화 기록이라 거기 인용된 "❯ 1. Yes" 를 커서로 잡지 않는다.
 *  창 아래에 세션 이름 구분선('──── ci-runner ─')·상태줄·작업 목록이 붙어도 찾는다(2026-11-05 — 마지막 구분선 아래만 보다가 135번 건너뜀) */
function cursorAt(all: string[]): number {
  for (let i = all.length - 1; i >= 0; i--) {
    if (/^❯(\s|$)/.test(all[i]!) && i > 0 && RULE.test(all[i - 1]!)) return -1;
    if (/^\s+❯\s/.test(all[i]!)) return openBelow(all, i) ? -1 : i;
  }
  return -1;
}

/** 세션 이름 구분선('──── ci-runner ─') — 창 아래에 붙는다 */
const NAMED_RULE = /─{4,}\s+\S.*─\s*$/;
/** 창 아래 붙는 것(상태줄·작업 목록) */
const FOOTER = /^\s*$|⏵⏵|shift\+tab|bypass permissions|auto mode|· (Opus|Sonnet|Haiku|Fable)\b|^\s*\d+ tasks? \(|^\s*[◻◼✔]/;
/** 커서 아래 이름 없는 구분선 뒤에 상태줄·작업 목록 말고 다른 게 있다 = 그 구분선이 새 창의 윗줄(덜 그려짐) — 커서는 그 위 대화 기록이다.
 *  모르는 모양이면 '못 찾음'(안 누름)으로 기운다 */
function openBelow(all: string[], cur: number): boolean {
  for (let i = cur + 1; i < all.length; i++) {
    if (!RULE.test(all[i]!) || NAMED_RULE.test(all[i]!)) continue;
    let j = i + 1;
    while (j < all.length && !RULE.test(all[j]!) && FOOTER.test(all[j]!)) j++;
    if (j < all.length && !RULE.test(all[j]!)) return true;
  }
  return false;
}

/** 창이 시작하는 줄 — 커서 위 마지막 구분선 다음 줄(커서가 없으면 마지막 구분선 다음 줄) */
function windowFrom(all: string[], cur: number): number {
  let from = 0;
  all.forEach((l, i) => { if ((cur < 0 || i < cur) && RULE.test(l)) from = i + 1; });
  return from;
}

/** 건너뛴 창 기록용 — 창 첫 12줄(300자). 왜 건너뛰었는지 나중에 보려고 */
export function promptTail(screen: string): string {
  const all = screen.split('\n');
  return all.slice(windowFrom(all, cursorAt(all))).map((l) => l.trim()).filter(Boolean).slice(0, 12).join(' / ').slice(0, 300);
}

export function pickAllow(screen: string): AllowPick {
  const all = screen.split('\n');
  // 커서 줄을 먼저 찾고 그 위 마지막 구분선부터가 창 — 위쪽 대화 기록("❯ 내가 친 말")은 안 본다
  const at = cursorAt(all);
  const lines = all.slice(windowFrom(all, at));
  const cur = at < 0 ? -1 : at - (all.length - lines.length);
  if (cur < 0 && ATTACHING.test(screen)) return { skip: tr('세션 화면이 아직 안 떴어', 'Session screen not ready yet'), soon: true };
  if (cur < 0) return SENSITIVE.test(lines.join('\n')) ? SENSITIVE_SKIP() : { skip: tr('선택지 커서를 못 찾았어', "Couldn't find the option cursor") };
  // 선택지 = 커서 줄과 글자 시작 칸이 같은, 이어진 줄들
  const col = lines[cur]!.indexOf('❯') + 2;
  const textAt = (l: string) => (l.replace('❯', ' ').search(/\S/));
  // 한 선택지가 여러 줄로 접히면 이어지는 줄은 더 안쪽에서 시작한다 — 그 줄은 앞 선택지에 붙인다
  const isOpt = (l: string) => textAt(l) === col;
  const isMore = (l: string) => !!l.trim() && textAt(l) > col;
  let top = cur, bottom = cur;
  while (top > 0 && (isOpt(lines[top - 1]!) || isMore(lines[top - 1]!))) top--;
  while (top < cur && !isOpt(lines[top]!)) top++;
  while (bottom < lines.length - 1 && (isOpt(lines[bottom + 1]!) || isMore(lines[bottom + 1]!))) bottom++;
  const options: string[] = [];
  let curOpt = 0;
  for (let i = top; i <= bottom; i++) {
    const t = lines[i]!.replace('❯', ' ').trim();
    if (isOpt(lines[i]!)) { if (i === cur) curOpt = options.length; options.push(t); } else options[options.length - 1] += ` ${t}`;
  }
  // 선택지 바로 위 "…?" 줄(Do you want to proceed?)이 창이 묻는 말 — 그 위는 도구 인자(명령·diff)라 안 본다.
  // 그런 줄이 없는 창(computer-use·새 MCP)은 창 전체를 본다. 마지막 선택지 아래(Esc 안내·세션 작업 목록)는 안 본다 —
  // 작업 이름 "카드 늘 보이게 …" 를 결제로 읽어 훅 확인 창을 30분 건너뛰었다(2026-10-05)
  let q = top - 1;
  while (q >= 0 && !lines[q]!.trim()) q--;
  const asked = lines.slice(q >= 0 && /\?\s*(\(.*\))?\s*$/.test(lines[q]!) ? q : 0, bottom + 1);
  if (SENSITIVE.test(asked.join('\n'))) return SENSITIVE_SKIP();
  const target = options.findIndex((o) => ALLOW.test(o) && !NOT.test(o) && !NO_FIRST.test(o));
  if (target < 0) return { skip: tr('허용 줄을 못 찾았어', "Couldn't find an allow option"), hold: true };
  const d = target - curOpt;
  return { keys: (d > 0 ? DOWN.repeat(d) : UP.repeat(-d)) + '\r', option: options[target]! };
}

/** 같은 세션을 다시 보기까지 — 풀었으면 5초 뒤(곧 다음 창이 뜰 수 있다 — 막 풀린 창이 목록에 한 번 더 남아 있어도 헛손질 안 하게), 건너뛰었거나 못 풀었으면 1분(같은 창을 계속 두드리지 않게).
 * held(사람이 골라야 하는 창) = 세션이 그 창을 벗어나면(leftWindow) 바로 놓고, 안 벗어나면 안전망으로 10분에 한 번만 — 같은 창을 6.5시간 동안 250번 다시 봤다(2026-10-11 perf 9번) */
/** carded = 회사 정책 아래 사람 카드를 띄운 창(ADR 0023) — 30초마다 다시 봐서 답한 뒤 곧바로 뜬 다음 창도 카드가 되게(같은 창이면 같은 카드) */
export type AllowOutcome = 'allowed' | 'soon' | 'skipped' | 'held' | 'stillOpen' | 'failed' | 'carded';
export const retryAfter = (o: AllowOutcome): number => (o === 'allowed' || o === 'soon' ? 5_000 : o === 'held' ? 10 * 60_000 : o === 'carded' ? 30_000 : 60_000);

/** 건너뛴 창을 어떻게 — 사람 몫(hold)은 바로 알리고, 전환 화면(soon)은 조용히 5초 뒤(30초 넘게 그대로면 알리고 보통 주기 — attach 를 끝없이 안 띄우게),
 *  커서를 못 찾은 건 한 번은 조용히 다시 보고(덜 그려졌을 수 있다). misses = 이 세션에서 연달아 못 읽은 횟수(이번 것 빼고) */
export const SOON_MAX = 6;
export function skipPlan(pick: { skip: string; hold?: true; soon?: true }, misses: number): { outcome: AllowOutcome; tell: boolean } {
  if (pick.hold) return { outcome: 'held', tell: true };
  if (misses < (pick.soon ? SOON_MAX : 1)) return { outcome: 'soon', tell: false };
  return { outcome: 'skipped', tell: true };
}

/** 붙잡아 둔 세션 중 그 창을 벗어난 것 — 목록에서 빠졌거나 자동 허용 대상 기다림이 아니게 됨. 다음 창은 바로 본다 */
export function leftWindow(held: Iterable<string>, sessions: { id: string; waitingFor?: string }[], auto: string[]): string[] {
  const waiting = new Set(sessions.filter((s) => auto.includes(s.waitingFor ?? '')).map((s) => s.id));
  return [...held].filter((id) => !waiting.has(id));
}

/** 권한 창에서 멈춘 세션을 알릴 참모 — 일 기록으로 그 세션에 일을 맡긴(넘겨받았으면 새 주인) 참모만. 없으면 undefined(사용자 알림만, 예전처럼).
 *  참모가 확인창에 걸려 있으면 넣지 않는다 — 그 입력칸에 글자 + Enter 를 넣으면 참모 창의 선택지를 골라 버린다 */
export function permStuckTo(sub: Session, events: TaskEvent[], orchs: Session[], sessions: Session[]): Session | undefined {
  const to = sentBy(sub, events, orchs, sessions);
  return to && to.id !== sub.id && to.state !== 'blocked' ? to : undefined;
}

/** 맡긴 참모 입력칸에 들어갈 한 줄(Enter 로 보내져서 줄바꿈 없이) — 선택지 창 30초 줄(forwardQuestion forwardText)과 같은 모양 */
export const permStuckText = (s: Session, why: string) => {
  const where = [s.project, s.workspace, s.name && s.name !== s.project ? s.name : null].filter(Boolean).join(' / ');
  const w = why.replace(/\s+/g, ' ').trim();
  return tr(`[앱] ${where} 세션(${s.id})이 권한 창에서 멈췄어 — ${w}`, `[app] ${where} session (${s.id}) is stuck on a permission prompt — ${w}`);
};

export type AllowLog = { ts: string; where: string; option?: string; result: string };

/** 자동 허용 기록(~/.honor-orchestrator/auto-allow.jsonl) — 최근 것이 위, 최대 n 개 */
export function parseAllowLog(raw: string, n: number): AllowLog[] {
  const out: AllowLog[] = [];
  for (const line of raw.split('\n')) {
    try {
      const j = JSON.parse(line) as AllowLog;
      if (j && j.ts && j.where && j.result) out.push(j);
    } catch {
      // 쓰는 중이던 줄
    }
  }
  return out.reverse().slice(0, n);
}
