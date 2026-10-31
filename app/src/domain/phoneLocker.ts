// 폰 홈·보관함 v1(docs/design-drafts/phone-home, 사용자 10/11 "추천대로") — 폰이 데스크톱 보관함 v2 와 같은 판단을 쓰게 잇는 것.
// 폰 서버 phone_view(줄마다 rel·참모 폴더 dirs)를 데스크톱 나무(LkTree)로 바꾸면 기록(lockerLog)·폴더(kidsOf)·보기(defaultView)를 그대로 쓴다
import { josa, tr } from '../i18n';
import type { Activity } from './activity';
import { dotKind, worstDot, type DotKind } from './dot';
import { projectsOf, type LockerView } from './locker';
import type { LkEntry, LkTree } from './lockerTree';
import type { Session } from './session';
import type { ActivityStatus } from './status';

const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

/** 그 참모 보관함 — 폴더 먼저(얕은 것부터), 그다음 파일(Rust 가 준 순서). 별칭 줄의 path 는 가리키는 진짜 파일 = link. rel 이 없는 옛 맥이면 빈 나무 */
export function phoneTree(view: LockerView, owner: string): LkTree {
  const dir = view.dirs?.[owner] ?? '';
  if (!dir) return { dir: '', entries: [] };
  const folders: LkEntry[] = view.folders.filter((f) => f.owner === owner).map((f) => ({ rel: f.name, name: nameOf(f.name), dir: true, link: null, gone: false, vers: 0, ...(f.linked ? { linked: true } : {}), ...(f.ro ? { ro: true } : {}) }));
  folders.sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || a.rel.localeCompare(b.rel));
  const files: LkEntry[] = view.items.filter((i) => i.owner === owner && i.rel).map((i) => ({
    // 맥 폴더 연결 안쪽(ro)은 진짜 파일 경로가 link — 폰 문지기는 보관함의 링크 경로를 안 연다
    rel: i.rel!, name: nameOf(i.rel!), dir: false, link: i.copy && !i.ro ? null : i.path, gone: !!i.gone, size: i.size ?? null, mtime: i.mtime ?? null, vers: 0, ...(i.ro ? { ro: true } : {}),
  }));
  return { dir, entries: [...folders, ...files] };
}

/** 폰이 여는 경로 — 보관함 안 별칭 자리면 가리키는 진짜 파일(폰 문지기는 링크 경로를 안 연다), 아니면 그대로 */
export function openPathOf(path: string, t: LkTree): string {
  if (!t.dir || !path.startsWith(`${t.dir}/`)) return path;
  const e = t.entries.find((x) => !x.dir && `${t.dir}/${x.rel}` === path);
  return e?.link ?? path;
}

export type PhoneChip = { root: string; name: string; dot: DotKind };

const RANK: Record<DotKind, number> = { ask: 0, run: 1, rest: 2, off: 3 };

/** 진행 중 칩 = 이 참모가 맡긴(held) 세션의 프로젝트 중 일하는·기다리는 것, 모든 프로젝트 = 떠 있는 세션의 프로젝트 전부(데스크톱 lockerSide 와 같은 규칙).
 *  급한 순(기다림 > 일함 > 쉼), 같으면 원래 순서 */
export function phoneChips(sessions: Session[], held: string[], hqDir: string, statusOf: (s: Session) => ActivityStatus | undefined): { active: PhoneChip[]; all: PhoneChip[] } {
  const live = sessions.filter((x) => x.kind === 'background');
  const rootOf = (x: Session) => x.cwd.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '').replace(/\/$/, '');
  const all = projectsOf(live.map((x) => x.cwd), hqDir).map((p) => {
    const mine = live.filter((x) => rootOf(x) === p.root);
    return { root: p.root, name: p.name, dot: worstDot(mine.map((x) => dotKind({ st: statusOf(x) ?? 'idle' }))), held: mine.some((x) => held.includes(x.id)) };
  });
  const sorted = all.map((c, i) => ({ c, i })).sort((a, b) => RANK[a.c.dot] - RANK[b.c.dot] || a.i - b.i).map(({ c }) => c);
  const strip = ({ root, name, dot }: PhoneChip & { held: boolean }): PhoneChip => ({ root, name, dot });
  return { active: sorted.filter((c) => c.held && (c.dot === 'run' || c.dot === 'ask')).map(strip), all: sorted.map(strip) };
}

/** 폰 점 넷 — 모양은 mobile.css(일함 채움+숨쉬기 · 기다림 노랑+고리 · 쉼 빈 고리 · 꺼짐 점선) */
export function dotClass(k: DotKind): 'st-work' | 'st-wait' | 'st-done' | 'st-off' {
  return k === 'run' ? 'st-work' : k === 'ask' ? 'st-wait' : k === 'rest' ? 'st-done' : 'st-off';
}

const LINE = 60;
const cut = (t: string) => { const one = t.replace(/\s+/g, ' ').trim(); return one.length > LINE ? `${one.slice(0, LINE)}…` : one; };

/** 세션 줄 그 자리 펼침 — 시킨 말 · 하는 일(마지막 도구) · 답 첫마디. 없는 칸은 뺀다 */
export function peekLines(a: Activity): { who: 'me' | 'tool' | 'ai'; text: string }[] {
  const out: { who: 'me' | 'tool' | 'ai'; text: string }[] = [];
  if (a.prompt?.text) out.push({ who: 'me', text: cut(a.prompt.text) });
  if (a.tool) out.push({ who: 'tool', text: cut(a.tool.target ? `${a.tool.name} · ${a.tool.target}` : a.tool.name) });
  if (a.reply?.text) out.push({ who: 'ai', text: cut(a.reply.text) });
  return out;
}

/** 보관함 줄 '누가 보여 줌' — 참모 이름은 사용자가 정해서 조사를 받침으로 고른다('참모이 보여 줌'이 떴다, QA 2차). 세션은 조사 없이 */
export const shownBy = (who: string) => (who.endsWith('세션') ? tr(`${who} 보여 줌`, `Shown by ${who}`) : tr(`${josa(who, '이', '가')} 보여 줌`, `Shown by ${who}`));
