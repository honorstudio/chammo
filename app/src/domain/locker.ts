// 파일 보관함(2026-10-11 사용자) — 참모마다 하나. 내가 넣은 것(<데이터>/locker.jsonl, Rust locker.rs 가 접어 준 것)과
// 참모·맡긴 세션이 보여 준 것(scripts/show 기록)을 한 목록으로 합친다. 폴더 = 내 폴더(사람이 만든 것) > 프로젝트(경로로 저절로) > 기타
import { tr } from '../i18n';
import type { ShowAt } from './showAt';

export type LockerItem = {
  owner: string; path: string; copy: boolean; by: string; ts: string;
  folder?: string | null; name?: string | null; gone?: boolean; mtime?: number | null; size?: number | null;
  /** 참모 폴더 안 자리(폰 서버 phone_view — 폰 홈·보관함 v1) */
  rel?: string;
  /** 맥 폴더 연결 안쪽 파일 — 폰은 읽기만 */
  ro?: boolean;
};
/** dirs = 참모 폴더 이름 → 절대 경로(폰 서버만) */
export type LockerView = { items: LockerItem[]; hidden: { owner: string; path: string }[]; folders: { owner: string; name: string; /** 맥 폴더 연결 폴더 자체 */ linked?: boolean; /** 연결 폴더 안쪽 폴더 */ ro?: boolean }[]; dirs?: Record<string, string> };
export const EMPTY_LOCKER: LockerView = { items: [], hidden: [], folders: [] };

/** 폴더 열쇠 — recent(최근, 전부) · p:<프로젝트> · u:<내 폴더> · etc(기타) */
export type FolderKey = string;

export type LockerFile = {
  path: string; ts: string;
  /** 'me' 또는 보여 준 세션 id */
  by: string; byName?: string;
  /** 보관함 안 이름(바꾼 이름이 있으면 그것) */
  name: string;
  folder: FolderKey;
  /** 보관함 기록에 있는 것(연결·복사) — 없으면 보여 준 기록에서만 온 것 */
  kept: boolean;
  copy: boolean;
  gone: boolean;
  /** 넣은 뒤 원본이 고쳐졌으면 그 시각(ms) */
  edited?: number;
  /** 보여 준 곳(scripts/show --line 등) — 대시보드 미리보기가 그 자리를 짚는다 */
  at?: ShowAt;
};

type Shown = { path: string; ts: string; by: string; byName?: string; at?: ShowAt };
type Project = { name: string; root: string };

const baseName = (p: string) => p.split('/').pop() ?? p;
/** 웹 주소(scripts/show http…)는 파일이 아니라 보관함에 안 넣는다 — 대시보드가 따로 붙인다 */
export const isWebPath = (p: string) => /^https?:\/\//i.test(p);
const ms = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? 0 : t; };
/** 넣은 시각보다 1분 넘게 뒤에 바뀌었으면 '고침' */
const EDIT_GAP = 60_000;

/** 프로젝트 폴더 — 가장 긴 뿌리가 이긴다(워크트리를 따로 띄운 프로젝트) */
export function folderKeyOf(path: string, projects: Project[]): FolderKey {
  const p = projects.filter((x) => path.startsWith(`${x.root.replace(/\/$/, '')}/`)).sort((a, b) => b.root.length - a.root.length)[0];
  return p ? `p:${p.name}` : 'etc';
}

export function lockerFiles(view: LockerView, owner: string, shown: Shown[], projects: Project[]): LockerFile[] {
  const hidden = new Set(view.hidden.filter((h) => h.owner === owner).map((h) => h.path));
  const out = new Map<string, LockerFile>();
  for (const it of view.items) {
    if (it.owner !== owner || hidden.has(it.path)) continue;
    const edited = it.mtime && it.mtime > ms(it.ts) + EDIT_GAP ? it.mtime : undefined;
    out.set(it.path, {
      path: it.path, ts: it.ts, by: it.by || 'me', name: it.name || (it.copy ? baseName(it.path).replace(/^\d+-/, '') : baseName(it.path)),
      folder: it.folder ? `u:${it.folder}` : folderKeyOf(it.path, projects), kept: true, copy: it.copy, gone: !!it.gone, ...(edited ? { edited } : {}),
    });
  }
  for (const s of shown) {
    if (s.path.startsWith('data:') || isWebPath(s.path) || hidden.has(s.path)) continue;
    const had = out.get(s.path);
    if (had) { if (ms(s.ts) > ms(had.ts)) had.ts = s.ts; if (s.at && !had.at) had.at = s.at; continue; }
    out.set(s.path, { path: s.path, ts: s.ts, by: s.by, ...(s.byName ? { byName: s.byName } : {}), name: baseName(s.path), folder: folderKeyOf(s.path, projects), kept: false, copy: false, gone: false, ...(s.at ? { at: s.at } : {}) });
  }
  const at = (f: LockerFile) => Math.max(ms(f.ts), f.edited ?? 0);
  return [...out.values()].sort((a, b) => at(b) - at(a));
}

/** 세션 폴더들 → 프로젝트 뿌리(워크트리는 본 폴더로) — 폰처럼 프로젝트 목록을 따로 안 받는 곳. skip = 참모 HQ */
export function projectsOf(cwds: string[], skip: string): Project[] {
  const out: Project[] = [];
  for (const c of cwds) {
    const root = c.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '').replace(/\/$/, '');
    if (!root || root === skip.replace(/\/$/, '') || out.some((p) => p.root === root)) continue;
    out.push({ name: baseName(root), root });
  }
  return out;
}

export type Tree = { recent: number; projects: { key: string; name: string; count: number }[]; mine: { key: string; name: string; count: number }[]; etc: number };

/** 왼쪽 폴더 나무 — 프로젝트는 파일이 있는 것만(최근 것 먼저), 내 폴더는 빈 것도(만든 순서) */
export function folderTree(files: LockerFile[], view: LockerView, owner: string): Tree {
  const count = (k: string) => files.filter((f) => f.folder === k).length;
  const projects: Tree['projects'] = [];
  for (const f of files) if (f.folder.startsWith('p:') && !projects.some((p) => p.key === f.folder)) projects.push({ key: f.folder, name: f.folder.slice(2), count: count(f.folder) });
  const names = view.folders.filter((x) => x.owner === owner).map((x) => x.name);
  for (const f of files) if (f.folder.startsWith('u:') && !names.includes(f.folder.slice(2))) names.push(f.folder.slice(2));
  return { recent: files.length, projects, mine: names.map((n) => ({ key: `u:${n}`, name: n, count: count(`u:${n}`) })), etc: count('etc') };
}

export function inFolder(files: LockerFile[], key: FolderKey): LockerFile[] {
  return key === 'recent' ? files : files.filter((f) => f.folder === key);
}

/** 경로 칩에 쓸 폴더 이름 */
export function crumbOf(key: FolderKey): string {
  if (key === 'recent') return tr('최근', 'Recent');
  if (key === 'etc') return tr('기타', 'Other');
  return key.slice(2);
}

/** 스페이스 화면 자리 — l:<참모 id>(최근) · l:<참모 id>#<폴더 열쇠>. 폴더도 자리에 넣어 뒤로(⌘[)가 폴더를 오간다 */
export const lockerPick = (orchId: string, folder?: FolderKey) => (folder && folder !== 'recent' ? `l:${orchId}#${folder}` : `l:${orchId}`);
export function parseLockerPick(pick: string): { orch: string; folder: FolderKey } | null {
  if (!pick.startsWith('l:')) return null;
  const rest = pick.slice(2);
  const i = rest.indexOf('#');
  return i < 0 ? { orch: rest, folder: 'recent' } : { orch: rest.slice(0, i), folder: rest.slice(i + 1) || 'recent' };
}

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg', 'bmp', 'tif', 'tiff'];
/** 맥 미리보기(QuickLook)가 첫 장을 잘 그리는 것 — 그림이 곧 내용 */
const SHOT = ['pdf', 'ppt', 'pptx', 'key', 'html', 'htm', 'mp4', 'mov', 'm4v'];

/** 카드 썸네일 — image(그림 그대로) · shot(맥이 그린 첫 장) · doc(문서 모양 + 첫 줄) */
export function cardLook(path: string): { look: 'image' | 'shot' | 'doc'; tag: string } {
  const ext = baseName(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const tag = ext ? ext.toUpperCase() : 'FILE';
  if (IMAGE.includes(ext)) return { look: 'image', tag };
  if (SHOT.includes(ext)) return { look: 'shot', tag };
  return { look: 'doc', tag };
}

/** 보관함에서 열어 둔 파일이 그 뒤 고쳐졌나 — 맥 앱(키노트·한글 등)으로 고쳐 저장한 것. md·엑셀은 스페이스 편집 고리가 따로 알린다.
 *  opened = 연 시각(경로별), told = 이미 알린 바뀐 시각(경로별, 같은 저장을 두 번 안 알린다). 알릴 것만 돌려주고 told 를 채운다 */
export function editedAfterOpen<T extends { path: string; mtime?: number | null; gone?: boolean }>(items: T[], opened: Map<string, number>, told: Map<string, number>): T[] {
  const out: T[] = [];
  for (const it of items) {
    const at = opened.get(it.path);
    if (!at || !it.mtime || it.gone || it.mtime <= at + 1000 || told.get(it.path) === it.mtime) continue;
    told.set(it.path, it.mtime);
    out.push(it);
  }
  return out;
}
