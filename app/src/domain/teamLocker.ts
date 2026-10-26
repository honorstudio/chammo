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
export type LockerUpload = { local: string; team: string; room: string; name: string; done: number; total: number; error: string };

/** fileDrop 이 팀 보관함 칸([data-team-locker])에 놓인 파일을 넘기는 사건 — detail {paths, team} */
export const TEAM_LOCKER_DROP = 'team-locker-drop';
/** 팀 보관함 파일을 폴더 칩에 끌어 놓음(ui/space/dragPath) — detail {team, ids, folder('' = 맨 위)} */
export const TEAM_LOCKER_MOVE = 'team-locker-move';
/** 팀 보관함 파일을 채팅 칸에 끌어 놓음 — detail {team, ids, chat(세션 id)}. TeamLocker 가 풀어서 그 채팅에 붙인다 */
export const TEAM_LOCKER_OUT = 'team-locker-out';

/** 대화 파일 묶음(채팅에 붙인 파일) — Rust team_locker::CHAT_FOLDER 와 같은 글 */
export const CHAT = '대화 파일';

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

const shown = (i: LockerItem) => i.kind === 'file' && !i.dir;

/** 폴더 칩 — 전체(빈 글)·폴더(가나다)·대화 파일. 휴지통·프로필 사진은 안 센다. 빈 폴더(표시 줄)는 0개로 */
export function chips(items: LockerItem[]): { key: string; n: number }[] {
  const live = items.filter((i) => shown(i) && i.state === 'live');
  const by = new Map<string, number>();
  for (const i of items) if (i.dir && i.kind === 'file' && i.state === 'live' && !i.room && i.folder && !by.has(i.folder)) by.set(i.folder, 0);
  for (const i of live) if (!i.room && i.folder) by.set(i.folder, (by.get(i.folder) ?? 0) + 1);
  const chat = live.filter((i) => i.room).length;
  return [{ key: '', n: live.length }, ...[...by.keys()].sort((a, b) => a.localeCompare(b, 'ko')).map((k) => ({ key: k, n: by.get(k)! })), ...(chat ? [{ key: CHAT, n: chat }] : [])];
}

/** 한 자리 줄 — 전체·폴더·대화 파일, trash 면 휴지통. 새것 먼저 */
export function inPlace(items: LockerItem[], place: string, trash = false): LockerItem[] {
  return items
    .filter((i) => shown(i) && (trash ? i.state === 'trash' : i.state === 'live' && (place === '' || (place === CHAT ? !!i.room : !i.room && i.folder === place))))
    .sort((a, b) => b.at - a.at);
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
