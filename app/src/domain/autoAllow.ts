// 도구 권한 창 자동 허용 — 사용자 방침 2026-09-27 "권한은 항상 다 준다".
// 화면(attach 로 뜬 글자)을 읽어 선택지에서 Allow/Yes 줄을 **이름으로** 찾고, 커서에서 그 줄까지 화살표 + Enter.
// 권한 창 맨 위는 Deny 일 수 있다(computer-use) — Enter = 맨 위 가정 금지. 비밀번호·2FA·결제·과금 창은 사람 몫.
// 민감한 낱말은 창이 묻는 말에서만 찾는다 — 명령 본문·위쪽 대화 기록은 빼고(2026-09-28 project-b: 커밋 메시지의 "인증번호" 로 10분 멈춤)
import { tr } from '../i18n';
const SENSITIVE = /password|비밀번호|2fa|otp|인증\s*번호|결제|payment|billing|과금|credit card|카드/i;
const ALLOW = /\b(allow|yes|approve|continue|use|deliver)\b|허용|승인|전달/i;
const NOT = /deny|don't|do not|without|reject|cancel|거절|거부|다시 묻지/i;
/** "No" 는 줄 맨 앞일 때만 거절 — "Yes, and switch to BYPASS PERMISSIONS (no further prompts)" 의 no 는 아니다(2026-10-01 플랜 승인 창) */
const NO_FIRST = /^(\d+\.\s*)?no\b/i;
const DOWN = '\x1b[B';
const UP = '\x1b[A';

export type AllowPick = { keys: string; option: string } | { skip: string };

const SENSITIVE_SKIP = () => ({ skip: tr('민감한 창(비밀번호·인증·결제) — 직접 골라줘', 'Sensitive prompt (password, verification, payment) — choose it yourself') });

export function pickAllow(screen: string): AllowPick {
  const all = screen.split('\n');
  // 대화 기록의 "❯ 내가 친 말" 과 헷갈리지 않게 마지막 구분선 아래만 본다
  let from = 0;
  all.forEach((l, i) => { if (/─{4,}/.test(l)) from = i + 1; });
  const lines = all.slice(from);
  const cur = lines.findIndex((l) => /^\s*❯\s/.test(l));
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
  if (target < 0) return { skip: tr('허용 줄을 못 찾았어', "Couldn't find an allow option") };
  const d = target - curOpt;
  return { keys: (d > 0 ? DOWN.repeat(d) : UP.repeat(-d)) + '\r', option: options[target]! };
}

/** 같은 세션을 다시 보기까지 — 풀었으면 5초 뒤(곧 다음 창이 뜰 수 있다 — 막 풀린 창이 목록에 한 번 더 남아 있어도 헛손질 안 하게), 건너뛰었거나 못 풀었으면 1분(같은 창을 계속 두드리지 않게) */
export type AllowOutcome = 'allowed' | 'skipped' | 'stillOpen' | 'failed';
export const retryAfter = (o: AllowOutcome): number => (o === 'allowed' ? 5_000 : 60_000);

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
