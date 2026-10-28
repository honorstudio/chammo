// 팀 보관함 화면 계산(chammo-relay ADR 0009) — Rust team_locker_list 의 줄을 폴더 칩·자리·크기 글로. 화면(ui/team/TeamLocker)과 따로 시험한다
import { tr } from '../i18n';
import { kindOf, pageDoc } from './reader';
import { readSortOf, sortList, type SortState } from './sortList';

export type LockerItem = {
  id: string; name: string; size: number; cipher: number; at: number;
  state: 'live' | 'trash'; kind: string; room: string; folder: string;
  by: string; byMember: string; mine: boolean; why: string; deletedAt: number | null;
  /** 빈 폴더 표시 줄(봉한 meta 의 dir) — 줄로는 안 그리고 폴더 칩으로만 */
  dir?: boolean;
};
export type LockerUsage = { used: number; reserved: number; seats: number; limit: number };
/** cached = 기기에 봉해 둔 마지막 목록(열자마자, 뒤에서 새로 받는 중) · timing = 단계별 ms(재기) */
export type LockerView = { rev: number; usage: LockerUsage; items: LockerItem[]; skipped: string[]; shared: number; cached?: boolean; timing?: Record<string, number> };
/** kind = 무엇을 올리나(file 사람 파일 · profile·avatar·post 앱 안쪽 줄) — 옛 앱은 안 실었다 */
export type LockerUpload = { local: string; team: string; room: string; name: string; done: number; total: number; error: string; kind?: string };

/** fileDrop 이 팀 보관함 칸([data-team-locker])에 놓인 파일을 넘기는 사건 — detail {paths, team} */
export const TEAM_LOCKER_DROP = 'team-locker-drop';
/** 팀 보관함 파일을 폴더 칩에 끌어 놓음(ui/space/dragPath) — detail {team, ids, folder('' = 맨 위)} */
export const TEAM_LOCKER_MOVE = 'team-locker-move';
/** 팀 보관함 파일을 채팅 칸에 끌어 놓음 — detail {team, ids, chat(세션 id)}. TeamLocker 가 풀어서 그 채팅에 붙인다 */
export const TEAM_LOCKER_OUT = 'team-locker-out';


export function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${Math.round(v)}B` : `${v >= 100 || i === 1 ? Math.round(v) : Math.round(v * 10) / 10}${u[i]}`;
}

/** 머리 작은 막대 — '쓴 것 / 한도' 와 비율 */
export function usageText(u: LockerUsage): { text: string; ratio: number } {
  const used = fmtBytes(u.used);
  const lim = fmtBytes(u.limit);
  const sameUnit = used.replace(/[\d.]/g, '') === lim.replace(/[\d.]/g, '');
  return { text: sameUnit ? `${used.replace(/[A-Z]+$/, '')} / ${lim}` : `${used} / ${lim}`, ratio: u.limit > 0 ? Math.min(1, Math.round((u.used / u.limit) * 100) / 100) : 0 };
}

/** 화면에 보이는 줄 = 사람이 올린 파일만. 프로필·사진·팀 홈 글·팀 참모 정의 같은 앱 안쪽 줄(kind ≠ file)과 빈 폴더 표시 줄은 안 보인다 */
const shown = (i: LockerItem) => i.kind === 'file' && !i.dir;

/** 팀 보관함 올리는 중 줄 — 사람이 올린 팀 파일만(kind 없으면 옛 앱 줄 = 파일). 휴지통·대화 파일 보기에선 없다(대화 첨부는 채팅 칸이 그린다).
 *  10-28 사용자 "프로필 바꾸면 profile.json 112B 카드" — 프로필·사진·글 올리기가 이 줄로 샜다 */
export function lockerUps(ups: LockerUpload[], at: { trash?: boolean; room?: string }): LockerUpload[] {
  if (at.trash || at.room) return [];
  return ups.filter((u) => (u.kind ?? 'file') === 'file' && !u.room);
}

// ── 폴더 나무 — 폴더는 봉한 meta 의 경로 글('견적/10월', 빈 글 = 맨 위). 파일이 든 경로의 위 폴더는 다 있는 것으로 본다(깊이 제한 없음).
// 옛 앱(0.4.3)이 쓴 한 단계 폴더는 그대로 맨 위 폴더. 빈 폴더는 봉한 표시 줄(dir) ──

/** 팀 보관함 폴더 안 것(팀 파일·표시 줄, 살아 있는 것) — 대화 파일·프로필 사진·휴지통은 폴더가 아니다 */
const teamLive = (i: LockerItem) => i.kind === 'file' && i.state === 'live' && !i.room;
/** path 가 folder 이거나 그 안인가(맨 위는 폴더가 아니다) — Rust team_locker::under 와 같은 규칙 */
export const under = (path: string, folder: string) => !!folder && (path === folder || path.startsWith(`${folder}/`));
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** 폴더 이름 바꾸기 — 마지막 칸만 새 이름으로(빗금은 칸 나눔이 아니라 -) */
export const renamedPath = (path: string, name: string) => { const p = parentOf(path); const n = name.trim().replace(/\//g, '-'); return p ? `${p}/${n}` : n; };
/** 폴더도 끌고 고른다 — 고르기·끌기 id 는 'dir:<경로>'(파일 id 와 안 겹친다) */
export const dirId = (path: string) => `dir:${path}`;
export const dirOfId = (id: string) => (id.startsWith('dir:') ? id.slice(4) : null);

/** 모든 폴더 경로(위 폴더 포함, 가나다) */
export function allFolders(items: LockerItem[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    if (!teamLive(i) || !i.folder) continue;
    const parts = i.folder.split('/');
    for (let k = 1; k <= parts.length; k++) out.add(parts.slice(0, k).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
}

export type TeamFolder = { key: string; name: string; n: number };
/** 그 자리 바로 아래 폴더 타일(가나다) — n = 안쪽까지 든 파일 수(참모 보관함 폴더 카드와 같게) */
export function kidFolders(items: LockerItem[], place: string): TeamFolder[] {
  const kids = allFolders(items).filter((f) => parentOf(f) === place);
  const files = items.filter((i) => teamLive(i) && !i.dir);
  return kids.map((key) => ({ key, name: baseOf(key), n: files.filter((i) => under(i.folder, key)).length }));
}

/** 경로 줄 — 맨 위 다음 칸마다 그 자리 경로 */
export function crumbsOf(place: string): { key: string; name: string }[] {
  if (!place) return [];
  const parts = place.split('/');
  return parts.map((name, k) => ({ key: parts.slice(0, k + 1).join('/'), name }));
}

/** 옮길 곳 — 맨 위('') + 모든 폴더. 지금 자리(from, 다 같은 자리에서 왔을 때)와, 옮기는 폴더(dirs) 자신·그 안쪽·이미 그 위 폴더는 뺀다 */
export function moveTargets(items: LockerItem[], o: { from?: string; dirs?: string[] }): string[] {
  const dirs = o.dirs ?? [];
  return ['', ...allFolders(items)].filter((t) => t !== o.from && !dirs.some((d) => under(t, d) || parentOf(d) === t));
}

/** 팀 보관함 한 자리 파일 — 그 폴더에 바로 든 것만(맨 위 = 폴더 밖 파일), trash 면 휴지통 전부(폴더 없이). 팀 파일만(대화 파일은 inRoom). 새것 먼저 */
export function inPlace(items: LockerItem[], place: string, trash = false): LockerItem[] {
  return items
    .filter((i) => shown(i) && !i.room && (trash ? i.state === 'trash' : i.state === 'live' && i.folder === place))
    .sort((a, b) => b.at - a.at);
}

/** 대화 파일 보기 — 그 방(DM·팀챗)에 붙인 파일만, trash 면 그 방 휴지통. 새것 먼저 */
export function inRoom(items: LockerItem[], room: string, trash = false): LockerItem[] {
  if (!room) return [];
  return items.filter((i) => shown(i) && i.room === room && i.state === (trash ? 'trash' : 'live')).sort((a, b) => b.at - a.at);
}

/** 썸네일 종류 — 대화 말풍선·대화 파일 보기·팀 보관함 카드가 같이 쓴다. 그림은 그대로, PDF 는 첫 장(QuickLook).
 *  크기 상한: 그림 20MB(말풍선마다 풀어 두니), PDF 50MB(맥 peek 상한). 크기 모름(0)은 받아 본다 */
export function thumbKind(name: string, size: number): 'image' | 'pdf' | null {
  const k = kindOf(name);
  if (k === 'image') return size <= 20 * 1024 * 1024 ? 'image' : null;
  if (k === 'pdf') return size <= 50 * 1024 * 1024 ? 'pdf' : null;
  return null;
}

export type DropPlan = { move: string[]; copy: string[]; stay: number; dirs: { from: string; to: string }[]; keep: string[] };
/** 폴더(타일·경로 줄)에 놓은 것 가르기 — 팀 보관함 파일은 옮기고(이미 거기면 빼고), 폴더(dir:경로)는 그 안으로(자기 안·이미 거기면 빼고),
 *  대화 파일은 폴더로 복사(옮기면 대화에서 사라진다, 10-28 사용자). 대화 파일을 맨 위에 놓으면 복사할 폴더가 없다 — stay 로 세어 화면이 이유를 말한다.
 *  keep = 마지막 것이 빠져 비는데 표시 줄이 없는 폴더 — 화면이 먼저 표시 줄을 남겨 빈 폴더가 사라지지 않게(파인더처럼). 못 여는 파일은 셈에서 뺀다 */
export function dropPlan(ids: string[], to: string, find: (id: string) => LockerItem | undefined, items: LockerItem[] = []): DropPlan {
  const out: DropPlan = { move: [], copy: [], stay: 0, dirs: [], keep: [] };
  for (const id of ids) {
    const d = dirOfId(id);
    if (d !== null) { if (d && parentOf(d) !== to && !under(to, d)) out.dirs.push({ from: d, to: to ? `${to}/${baseOf(d)}` : baseOf(d) }); continue; }
    const i = find(id);
    if (!i || i.why) continue;
    if (!i.room) { if (i.folder !== to) out.move.push(id); }
    else if (to) out.copy.push(id);
    else out.stay++;
  }
  // 비는 폴더 — 옮기는 파일의 폴더·옮기는 폴더의 위 폴더 중, 남는 게 없고 표시 줄도 없는 것
  const going = new Set(out.move);
  const gone = (i: LockerItem) => going.has(i.id) || out.dirs.some((x) => under(i.folder, x.from));
  const from = new Set([...out.move.map((id) => find(id)?.folder ?? ''), ...out.dirs.map((x) => parentOf(x.from))].filter(Boolean));
  for (const f of from) if (items.length && !items.some((i) => teamLive(i) && under(i.folder, f) && !gone(i))) out.keep.push(f);
  return out;
}

/** 오늘이면 시:분, 어제, 그 전은 월/일 */
export function whenText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  if (diff === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 1) return tr('어제', 'Yesterday');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.slice(0, 4) : '');

/** 스페이스(show 길)가 그리는 형식인가 — 글·그림·PDF·md·영상·소리·html·워드, QuickLook 페이지 문서(엑셀·슬라이드). 아니면 맥 기본 앱 */
export const opensInSpace = (name: string) => {
  const k = kindOf(name);
  return (k !== 'other' && k !== 'web') || pageDoc(name);
};

/** 팀 파일을 풀어 두는 자리 이름 — Rust team_locker_app::VIEW_DIR 와 같은 글(데이터 폴더 아래) */
export const VIEW_DIR = 'team-locker-peek';
/** 풀어 둔 팀 파일인가 — 스페이스 탭 머리에 내려받기 단추를 붙인다 */
export const isTeamCache = (path: string) => path.replace(/\\/g, '/').split('/').slice(0, -1).includes(VIEW_DIR);

export const SORTS = ['name', 'at', 'size', 'by'] as const;
export type LockerSort = SortState<(typeof SORTS)[number]>;
/** 기억한 정렬 — 모르는 값·막힌 저장소면 기본(올린 날짜 새것 먼저) */
export const readSort = (get: () => string | null): LockerSort => readSortOf(get, SORTS);
/** 줄 정렬 — 같은 값이면 새것 먼저 */
export const sortItems = (items: LockerItem[], s: LockerSort) => sortList(items, s, (i) => i);
