// 파일 보관함 v4 — 진짜 폴더(~/Documents/Chammo/<참모>/, Rust locker_fs). 파일마다 집은 하나, 나머지는 바로가기(별칭).
// 화면은 Rust 가 준 줄(rel·별칭·끊김·판 수)을 나무·카드로 그린다. 여기는 그 판단만(시험: lockerTree.test.ts)
import type { ActivityStatus } from './status';

/** 새 참모 폴더에 처음 한 번 깔리는 폴더(Rust locker_fs::BASE_FOLDER) — '받은 것'은 없앴다(홈·모드 ④): 새 파일은 보관함 맨 위 */
export const BASE_FOLDER = '자료';

/** Rust locker_fs::Entry */
export type LkEntry = {
  rel: string; name: string; dir: boolean; link?: string | null; gone: boolean; size?: number | null; mtime?: number | null; vers: number;
  /** 맥 폴더 연결(locker_link) — 바로가기 폴더 자체. dir 이기도 하고 link 는 가리키는 곳, 원본이 없으면 gone */
  linked?: boolean;
  /** 연결 폴더 안쪽 — 읽기만(이름 바꾸기·옮기기·지우기·넣기 안 됨) */
  ro?: boolean;
};
/** started = 보관함을 시작했나(한 번 열었거나 전부터 쓰던 사람) — 그 전엔 dir 이 빈 글(Rust 가 문서 폴더를 안 건드린다) */
export type LkTree = { dir: string; entries: LkEntry[]; started?: boolean };
export const EMPTY_TREE: LkTree = { dir: '', entries: [] };

type Project = { name: string; root: string };

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** 그 자리 바로 아래(폴더 먼저 — Rust 가 이미 그 순서로 준다) */
export function kidsOf(entries: LkEntry[], rel: string): LkEntry[] {
  return entries.filter((e) => parentOf(e.rel) === rel);
}

/** 왼쪽 나무의 내 폴더 — 보관함 맨 위 아래로, 여러 층은 깊이로 */
export function userFolders(entries: LkEntry[]): { rel: string; name: string; depth: number }[] {
  // 연결 폴더와 그 안쪽은 읽기 전용이라 바로가기·옮기기 목적지가 못 된다
  return entries.filter((e) => e.dir && !e.linked && !e.ro).map((e) => ({ rel: e.rel, name: e.name, depth: e.rel.split('/').length - 1 }));
}

/** 그 자리가 읽기 전용인가 — 연결 폴더 자체거나 그 안쪽(새 폴더·넣기·끌어놓기를 막는다) */
export function readOnlyAt(entries: LkEntry[], rel: string): boolean {
  const e = entries.find((x) => x.rel === rel);
  return !!e && (!!e.linked || !!e.ro);
}

/** 연결 폴더 줄 상태 — 끊겼으면 'gone', 아니면 'ok', 연결이 아니면 undefined */
export function linkState(e: LkEntry): 'ok' | 'gone' | undefined {
  return e.linked ? (e.gone ? 'gone' : 'ok') : undefined;
}

/** 경로 칩 — 폴더 자리를 한 단계씩 */
export function crumbsOf(rel: string): { rel: string; name: string }[] {
  if (!rel) return [];
  const parts = rel.split('/');
  return parts.map((name, i) => ({ rel: parts.slice(0, i + 1).join('/'), name }));
}

const under = (p: string, root: string) => p.startsWith(`${root.replace(/\/$/, '')}/`);

/** 카드의 집 표시 — 별칭이면 가리키는 프로젝트 이름(가장 긴 뿌리), 프로젝트 밖이면 'outside'. 집 파일·끊긴 별칭은 null */
export function homeMark(e: LkEntry, projects: Project[]): string | null {
  if (!e.link || e.gone) return null;
  const p = projects.filter((x) => under(e.link!, x.root)).sort((a, b) => b.root.length - a.root.length)[0];
  return p ? p.name : 'outside';
}

/** 이사 간 파일(<프로젝트>/assets/보관함/)을 가리키는 별칭 — '보관함으로 되돌리기'가 뜬다 */
export function givenBack(e: LkEntry): boolean {
  return !!e.link && /\/assets\/보관함\/[^/]+$/.test(e.link);
}

/** 스페이스 화면 자리 — l:<참모>(보관함 맨 위 = 내 폴더 + 전체 기록) · l:<참모>#p:<뿌리>(진행 중 칩 = 그 프로젝트 기록) · l:<참모>#d:<자리>(내 폴더) · l:<참모>#h(홈) */
export type LkPlace = { kind: 'root'; project?: string } | { kind: 'dir'; rel: string } | { kind: 'home' };
export function lkPick(orch: string, place?: LkPlace): string {
  if (place?.kind === 'home') return `l:${orch}#h`;
  if (!place || place.kind === 'root') return place?.project ? `l:${orch}#p:${place.project}` : `l:${orch}`;
  return `l:${orch}#d:${place.rel}`;
}
/** 사람이 보관함을 연 자리인가 — 홈(#h)은 아니다. 처음 연 순간에만 Rust 가 ~/Documents/Chammo 를 만든다(0.3.0) */
export function isLockerOpen(l: { place: LkPlace } | null | undefined): boolean {
  return !!l && l.place.kind !== 'home';
}
export function parseLkPick(pick: string): { orch: string; place: LkPlace } | null {
  if (!pick.startsWith('l:')) return null;
  const rest = pick.slice(2);
  const i = rest.indexOf('#');
  if (i < 0) return { orch: rest, place: { kind: 'root' } };
  const orch = rest.slice(0, i);
  const tail = rest.slice(i + 1);
  if (tail === 'h') return { orch, place: { kind: 'home' } };
  if (tail.startsWith('d:') && tail.length > 2) return { orch, place: { kind: 'dir', rel: tail.slice(2) } };
  if (tail.startsWith('p:') && tail.length > 2) return { orch, place: { kind: 'root', project: tail.slice(2) } };
  return { orch, place: { kind: 'root' } };
}

/** 활동 줄 순서 — 사람 필요(답 기다림·막힘) 맨 앞, 일하는 중, 쉬는 것. 같은 무리는 원래 순서 */
export function activityOrder<T extends { status: 'run' | 'ask' | 'wait'; st?: ActivityStatus }>(lines: T[]): T[] {
  const rank = (l: T) => (l.status === 'ask' || l.st === 'asks' || l.st === 'blocked' || l.st === 'login' ? 0 : l.status === 'run' || l.st === 'working' ? 1 : 2);
  return lines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}
