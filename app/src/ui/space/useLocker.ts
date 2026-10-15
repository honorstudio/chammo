// 파일 보관함 v4 읽기·고치기 — 참모마다 진짜 폴더(Rust locker_fs). 고친 뒤엔 LOCKER_CHANGED 로 모든 보관함 화면이 다시 읽는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { EMPTY_TREE, type LkTree } from '../../domain/lockerTree';
import type { Shot } from '../../domain/lockerShots';
import type { TrashPlan } from '../../domain/lockerTrash';

/** 보관함이 바뀌었다 — 다시 읽기 */
export const LOCKER_CHANGED = 'locker-changed';
/** 파인더에서 보관함 칸·폴더에 놓은 파일(detail = {paths, folder}) — fileDrop 이 보낸다. folder = 참모 폴더 안 자리(빈 글 = 보관함 맨 위) */
export const LOCKER_DROP = 'locker-drop';
/** 보관함 카드·폴더를 왼쪽 폴더에 끌어 놓았다(detail = {path, folder}) — dragPath 가 보낸다 */
export const LOCKER_MOVE = 'locker-move';
/** 참모 채팅에 파일을 붙였다(detail = {session, paths}) — 붙인 파일도 그 참모 보관함에 */
export const LOCKER_CHAT_ATTACH = 'locker-chat-attach';

/** 휴지통으로 보냈다(detail = {count}) — 보관함 화면이 '되돌리기' 알림을 띄운다 */
export const LOCKER_TRASHED = 'locker-trashed';

const changed = () => window.dispatchEvent(new Event(LOCKER_CHANGED));

export type LockerOwner = { id: string; name: string };

/** 그 참모 보관함 나무 — 폴더가 없으면 Rust 가 만든다(이름이 바뀌었으면 폴더도), 읽을 때마다 바뀐 집 파일은 판을 남긴다.
 *  open = 사람이 보관함을 열었다 — 보관함을 시작하기 전엔(started) 연 때만 만든다 */
export function useLockerTree(owner: LockerOwner | null, pollMs = 5000, open = false): LkTree {
  const [v, setV] = useState<LkTree>(EMPTY_TREE);
  const id = owner?.id ?? '';
  const name = owner?.name ?? '';
  // 맥 폴더 연결(새 파일이 생기면 바로 뜬다)이 있으면 더 자주 다시 읽는다
  const fast = v.entries.some((e) => e.linked);
  const every = fast ? Math.min(pollMs, 2000) : pollMs;
  useEffect(() => {
    if (!id) { setV(EMPTY_TREE); return; }
    let alive = true;
    const read = () => void invoke<LkTree>('locker_tree', { id, name, open }).then((x) => { if (alive) setV(x); }, () => {});
    read();
    const t = window.setInterval(read, every);
    window.addEventListener(LOCKER_CHANGED, read);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener(LOCKER_CHANGED, read); };
  }, [id, name, every, open]);
  return v;
}

/** 최근 스크린샷 n장 — on 이 켜질 때(# 고르기가 열릴 때)마다 새로 읽는다. 맥이 아니거나 못 읽으면 빈 목록 */
export function useRecentShots(on: boolean, n = 4): Shot[] {
  const [v, setV] = useState<Shot[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void lockerApi.recentShots(n).then((x) => { if (alive) setV(x); }, () => {});
    return () => { alive = false; };
  }, [on, n]);
  return v;
}

/** Rust locker_trash::Done — 보낸 수 + 못 보낸 것 */
type TrashDone = { moved: number; errors: string[] };
export type TrashLast = { count: number; at: number };
const trashed = (d: TrashDone) => {
  if (d.moved) window.dispatchEvent(new CustomEvent(LOCKER_TRASHED, { detail: { count: d.moved } }));
  if (d.errors.length) throw new Error(d.errors.join('\n'));
  return d;
};

/** 휴지통 되돌리기 — last = 마지막 묶음(앱을 다시 켜도 데이터 폴더 기록에서, 메뉴 '휴지통 되돌리기'), toast = 방금 보낸 수(잠깐 뜨는 알림) */
export function useTrashUndo(ms = 10000): { last: TrashLast | null; toast: number | null; hide: () => void } {
  const [last, setLast] = useState<TrashLast | null>(null);
  const [toast, setToast] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let t = 0;
    const read = () => void lockerApi.trashLast().then((x) => { if (alive) setLast(x); }, () => {});
    const on = (e: Event) => {
      setToast((e as CustomEvent<{ count: number }>).detail.count);
      window.clearTimeout(t);
      t = window.setTimeout(() => setToast(null), ms);
      read();
    };
    read();
    window.addEventListener(LOCKER_TRASHED, on);
    window.addEventListener(LOCKER_CHANGED, read);
    return () => { alive = false; window.clearTimeout(t); window.removeEventListener(LOCKER_TRASHED, on); window.removeEventListener(LOCKER_CHANGED, read); };
  }, [ms]);
  return { last, toast, hide: () => setToast(null) };
}

type AddResult = { added: { path: string; link: boolean }[]; errors: string[] };
export type Ver = { n: number; path: string; size: number; mtime?: number | null };
const after = <T,>(p: Promise<T>) => p.finally(changed);
/** 여러 개 한꺼번에 — 하나씩 차례로(겹치는 이름 번호가 꼬이지 않게), 실패는 모아서 한 번에, 다시 읽기는 끝에 한 번 */
async function each<T>(xs: T[], f: (x: T) => Promise<unknown>): Promise<void> {
  const errs: string[] = [];
  for (const x of xs) await f(x).catch((e: unknown) => { errs.push(String(e)); });
  changed();
  if (errs.length) throw new Error(errs.join('\n'));
}

export const lockerApi = {
  put: (o: LockerOwner, paths: string[], folder = '') => after(invoke<AddResult>('locker_put', { id: o.id, name: o.name, paths, folder })),
  choose: (o: LockerOwner, folder = '') => after(invoke<AddResult>('locker_choose', { id: o.id, name: o.name, folder })),
  mkdir: (o: LockerOwner, parent: string, folder: string) => after(invoke<string>('locker_mkdir', { id: o.id, name: o.name, parent, folder })),
  rename: (o: LockerOwner, rel: string, to: string) => after(invoke<string>('locker_rename_at', { id: o.id, name: o.name, rel, to })),
  move: (o: LockerOwner, rel: string, to: string) => after(invoke<string>('locker_move_to', { id: o.id, name: o.name, rel, to })),
  trash: (o: LockerOwner, rel: string) => after(invoke<TrashDone>('locker_trash', { id: o.id, name: o.name, rel }).then(trashed)),
  /** 고른 묶음(2026-10-12) — 휴지통(연결 폴더 안은 맥 휴지통). 안에 든 것이 있는 폴더는 foldersOk(화면이 따로 확인받음)일 때만 Rust 가 받는다 */
  trashMany: (o: LockerOwner, rels: string[], foldersOk = false) => after(invoke<TrashDone>('locker_trash_many', { id: o.id, name: o.name, rels, foldersOk }).then(trashed)),
  /** 폴더 안의 것은 꺼내고(to = null 이면 위 폴더) 또는 to 폴더로 옮기고 폴더만 휴지통(파일은 그냥 휴지통) */
  emptyOut: (o: LockerOwner, rels: string[], to: string | null) => after(invoke<TrashDone>('locker_trash_empty_out', { id: o.id, name: o.name, rels, to }).then(trashed)),
  /** 휴지통 확인 재료 — 파일·폴더·안에 든 항목 수, 못 지우는 것 */
  trashPlan: (o: LockerOwner, rels: string[]) => invoke<TrashPlan>('locker_trash_plan', { id: o.id, name: o.name, rels }),
  /** 마지막 휴지통 묶음(앱을 다시 켜도) / 원래 자리로 */
  trashLast: () => invoke<TrashLast | null>('locker_trash_last'),
  trashUndo: () => after(invoke<{ restored: number; errors: string[] }>('locker_trash_undo')),
  moveMany: (o: LockerOwner, rels: string[], to: string) => each(rels, (rel) => invoke('locker_move_to', { id: o.id, name: o.name, rel, to })),
  aliasMany: (o: LockerOwner, paths: string[], folder: string) => each(paths, (path) => invoke('locker_alias', { id: o.id, name: o.name, path, folder })),
  versions: (path: string) => invoke<Ver[]>('locker_versions', { path }),
  restore: (path: string, n: number) => after(invoke('locker_restore', { path, n })),
  back: (path: string) => after(invoke('locker_back', { path })),
  reveal: (path: string) => invoke('locker_reveal', { path }),
  /** '다시 찾기' 후보(같은 이름) / 끊긴 바로가기를 새 자리로 */
  find: (path: string) => invoke<string[]>('locker_find', { path }),
  relink: (path: string, target: string) => after(invoke('locker_relink', { path, target })),
  /** iCloud 로 빠진 파일이면 내려받기(열기·붙이기 직전) */
  fetch: (path: string) => invoke<boolean>('locker_fetch', { path }),
  migrate: (owners: { key: string; id: string; name: string }[]) => after(invoke<{ moved: number; inbox: number; pages: number; shots: boolean; gone: number; skipped: number; errors: string[] }>('locker_migrate', { owners })),
  /** 맥 폴더 연결 — 앱 파일 창으로 폴더를 골라 보관함 folder(빈 글 = 맨 위) 안에 바로가기 폴더로. 취소면 null */
  connect: (o: LockerOwner, folder = '') => after(invoke<string | null>('locker_connect_choose', { id: o.id, name: o.name, folder })),
  /** 연결 풀기 — 링크만 지운다(원본은 그대로) */
  disconnect: (o: LockerOwner, rel: string) => after(invoke<void>('locker_disconnect', { id: o.id, name: o.name, rel })),
  /** 끊긴 연결을 파일 창으로 새로 골라 다시 잇기. 취소면 false */
  reconnect: (o: LockerOwner, rel: string) => after(invoke<boolean>('locker_reconnect_choose', { id: o.id, name: o.name, rel })),
  /** 최근 스크린샷 n장(최신 먼저) — 입력칸 # 고르기·채팅 첨부 단추 맨 위에 */
  recentShots: (n = 6) => invoke<Shot[]>('locker_recent_shots', { n }),
  /** 기록 카드를 내 폴더에 — 바로가기만(기록·집은 그대로, 홈·모드 ⑤) */
  alias: (o: LockerOwner, path: string, folder: string) => after(invoke<string>('locker_alias', { id: o.id, name: o.name, path, folder })),
  /** 새 문서(md)·새 엑셀(xlsx) — 만든 파일 경로(홈·모드 ⑦) */
  newDoc: (o: LockerOwner, folder: string, kind: 'md' | 'xlsx', title = '') => after(invoke<string>('locker_new_doc', { id: o.id, name: o.name, folder, kind, title })),
};

// 카드 첫 줄 — 한 번 읽은 건 기억(파일이 바뀌면 mtime 이 열쇠에 들어 다시 읽는다)
const peeks = new Map<string, Promise<string | null>>();
export function usePeek(path: string, on: boolean, ver = 0): string {
  const [t, setT] = useState('');
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const k = `${path}:${ver}`;
    if (!peeks.has(k)) peeks.set(k, invoke<string | null>('locker_peek', { path }).catch(() => null));
    void peeks.get(k)!.then((s) => { if (alive) setT(s ?? ''); });
    return () => { alive = false; };
  }, [path, on, ver]);
  return t;
}
