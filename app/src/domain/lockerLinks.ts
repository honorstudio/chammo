// 보관함 링크 칸(시안 locker-links v1 B, 사용자 11-06) — 참모와 주고받은 주소. Rust locker_links 가 대화 기록(사람 말·참모 답)에서 모은 것 +
// 참모·맡긴 세션이 보여 준 주소(scripts/show 기록)를 한 목록으로. 빼기는 목록에서만(대화 그대로), 같은 주소 합치기는 아직(roadmap 부채)
import { josa, tr } from '../i18n';
import { webParts } from './phoneFile';

/** 링크 칸 자리 — 보관함 맨 위 { kind: 'root', project: LINKS_VIEW } ('모든 프로젝트' ALL_PROJECTS 와 같은 수, 프로젝트 뿌리는 늘 '/' 로 시작) */
export const LINKS_VIEW = '@links';

/** said = 내가 친 말 · answer = 참모 답 · shown = 참모·세션이 보여 줌 · hand = 보관함에서 직접 넣음 */
export type LinkHow = 'said' | 'answer' | 'shown' | 'hand';
/** by = 'me' 또는 참모·세션 id(화면의 whoOf 가 읽을 이름으로), label = 대화 속 [이름](주소) 의 이름 */
export type LockerLink = { id: string; url: string; ts: string; by: string; how: LinkHow; label?: string };
/** Rust locker_links::View — hidden 은 보여 준 주소 줄(show:…)을 거르는 데도 쓴다 */
export type LinksStore = { links: LockerLink[]; hidden: string[] };
export const EMPTY_LINKS: LinksStore = { links: [], hidden: [] };

type Shown = { path: string; ts: string; by: string };
const ms = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? 0 : t; };

/** 보여 준 주소 줄의 열쇠 — 빼면 Rust 에 이 열쇠로 남는다 */
export const shownLinkId = (s: { path: string; ts: string }) => `show:${s.ts}:${s.path}`;

/** 모은 것 + 보여 준 웹 주소(같은 줄은 한 번), 뺀 것은 빼고 최근 것 먼저 */
export function mergeLinks(store: LinksStore, shown: Shown[]): LockerLink[] {
  const hidden = new Set(store.hidden);
  const seen = new Set<string>();
  const fromShow: LockerLink[] = shown.filter((s) => webParts(s.path)).map((s) => ({ id: shownLinkId(s), url: s.path, ts: s.ts, by: s.by, how: 'shown' }));
  return [...store.links, ...fromShow]
    .filter((l) => !hidden.has(l.id) && !seen.has(l.id) && !!seen.add(l.id))
    .sort((a, b) => ms(b.ts) - ms(a.ts));
}

/** 줄 제목 — 이름이 있으면 이름(사이트는 아래 줄), 없으면 사이트 + 나머지 주소 */
export function linkTitle(l: { url: string; label?: string }): { title: string; host: string; rest: string } {
  const p = webParts(l.url) ?? { host: l.url, rest: '' };
  return l.label ? { title: l.label, host: p.host, rest: '' } : { title: '', host: p.host, rest: p.rest };
}

/** '내가 보냄' · '참모-2가 알려 줌' · 'onboarding 세션이 보여 줌' · '내가 넣음' — who = 화면의 whoOf(by) */
export function linkWhoHow(l: Pick<LockerLink, 'by' | 'how'>, who: string): string {
  if (l.by === 'me') return l.how === 'hand' ? tr('내가 넣음', 'Added by me') : tr('내가 보냄', 'Sent by me');
  if (l.how === 'answer') return tr(`${josa(who, '이', '가')} 알려 줌`, `From ${who}`);
  if (l.how === 'shown') return tr(`${josa(who, '이', '가')} 보여 줌`, `Shown by ${who}`);
  return tr(`${josa(who, '이', '가')} 보냄`, `Sent by ${who}`);
}

/** 손으로 넣는 주소 — 빈칸 없는 http(s) 주소 하나(주소 앞이 없으면 https://), 이름 자리는 점 있는 이름·localhost. Rust clean_input 과 같은 규칙 */
export function cleanLinkInput(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s) || s.length > 2048) return null;
  const withScheme = s.includes('://') ? s : `https://${s}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (host !== 'localhost' && (!host.includes('.') || host.startsWith('.') || host.endsWith('.'))) return null;
  return withScheme;
}

/** 열 곳을 고를 문서 자리 — 맡긴 세션이 보여 준 주소면 그 세션 폴더(시안 칸 링크 다리 linkBrowser 가 그 세션 브라우저를 고른다), 아니면 빈 글(참모 브라우저) */
export function linkDoc(l: Pick<LockerLink, 'how' | 'by'>, held: { id: string; cwd: string }[]): string {
  if (l.how !== 'shown') return '';
  const s = held.find((h) => h.id === l.by);
  return s?.cwd ? `${s.cwd.replace(/\/$/, '')}/` : '';
}
