// [앱] 줄(재시작으로 꺼진 세션·정리할 세션·오래 조용)에 붙는 '어디까지 했나' — 대화 끝 두어 문장 + 하던 도구 + git 가지@짧은 해시(커밋 안 한 변경 N).
// 참모가 그 세션 대화·git 을 안 열고 이어 할지 정하게(2026-10-31 — 남의 에이전트 복구 알림이 대화 끝·branch@sha 를 싣는 것을 배움).
// 입력칸에 Enter 로 들어가는 한 줄이라 줄바꿈 없이, 길이를 자르고, 키·비번처럼 생긴 것은 가린다(notify.log 에도 앞부분이 남는다)
import { tr } from '../i18n';
import type { Activity } from './activity';
import { safeDoing, SECRET_PREFIX, SECRET_WORD } from './phoneOffice';

/** 세션 폴더 git — branch 가지(떨어진 HEAD 면 'HEAD'), sha 짧은 해시, changed 커밋 안 한 변경 수. git 이 아니면 sha 가 빈 글(Rust tidy_git) */
export type GitHead = { branch: string; sha: string; changed: number };

/** 붙는 덩어리 하나의 상한 — 꺼진 세션이 여럿이면 하나당 더 짧게 */
export const HINT_MAX = 280;
/** 입력칸 한 줄 전체 상한 */
export const LINE_MAX = 900;

const HIDE = '•••';
const LONG_MIX = /[A-Za-z0-9_\-+/=]{32,}/;
const KEY_VAL = new RegExp(`((?:${SECRET_WORD.source})\\s*[:=：]\\s*)[^\\s,·]+`, 'gi');
const HOME = /(?:\/Users|\/home|[A-Za-z]:\\Users)[/\\][^/\\\s]+[/\\]/g;
const mixed = (w: string) => LONG_MIX.test(w) && /\d/.test(w) && /[a-z]/.test(w) && /[A-Z]/.test(w);

/** 키·토큰·'비밀번호: 값'을 가리고 홈 폴더 앞부분을 ~ 로 — 보통 말·해시·짧은 경로는 그대로 */
export function maskSecrets(t: string): string {
  return t
    .replace(HOME, '~/')
    .replace(KEY_VAL, `$1${HIDE}`)
    .split(/(\s+)/)
    .map((w) => (SECRET_PREFIX.test(w) || mixed(w) ? HIDE : w))
    .join('');
}

const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
const cut = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, n - 1).join('') + '…' : t);
const cutHead = (t: string, n: number) => ([...t].length > n ? '…' + [...t].slice(-(n - 1)).join('') : t);

/** 대화 끝 말 — 턴 끝 답의 마지막 두 문장(답 꼬리에서, 문장마다 90자) + 답 뒤에 부른 도구가 있으면 '하던 도구' 한 줄 */
export function lastSaid(a: Activity | undefined, n = 2): string[] {
  const out: string[] = [];
  const r = a?.reply;
  const said = flat(r?.tail || r?.text || '');
  if (said) out.push(...said.split(/(?<=[.!?。])\s+/).filter(Boolean).slice(-n).map((x) => cutHead(x, 90)));
  const t = a?.tool;
  if (t && (!r || t.ts > r.ts)) out.push(tr(`하던 도구: ${cut(safeDoing(t.name, flat(t.target)), 70)}`, `running: ${cut(safeDoing(t.name, flat(t.target)), 70)}`));
  return out;
}

export function gitLabel(g: Partial<GitHead> | undefined): string {
  if (!g?.sha) return '';
  return `${g.branch || 'HEAD'}@${g.sha}${g.changed ? tr(` (커밋 안 한 변경 ${g.changed})`, ` (${g.changed} uncommitted)`) : ''}`;
}

/**
 * 줄 끝에 붙일 ' · 어디까지: "…" · git 가지@해시' — 붙일 게 없으면 빈 글.
 * said false = 이미 '마지막 말'이 실린 줄(오래 조용)이라 하던 도구·git 만
 */
export function progressHint(a: Activity | undefined, g: Partial<GitHead> | undefined, o: { said?: boolean; max?: number } = {}): string {
  const lines = lastSaid(a);
  const parts: string[] = [];
  if (o.said === false) {
    const tool = a?.tool && (!a.reply || a.tool.ts > a.reply.ts) ? lines.at(-1) : undefined;
    if (tool) parts.push(tool);
  } else if (lines.length) parts.push(tr(`어디까지: "${lines.join(' / ')}"`, `where it got to: "${lines.join(' / ')}"`));
  const git = gitLabel(g);
  if (git) parts.push(`git ${git}`);
  return parts.length ? cut(maskSecrets(` · ${parts.join(' · ')}`), o.max ?? HINT_MAX) : '';
}

/** 입력칸 한 줄 — 줄바꿈 없이, 상한을 넘으면 끝을 자른다 */
export const capLine = (t: string, max = LINE_MAX) => cut(t.replace(/\s*\n\s*/g, ' '), max);
