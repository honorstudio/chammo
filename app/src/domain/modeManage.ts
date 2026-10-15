// 모드 관리(10/12 사용자) — 고르기 시트 '관리'. 기본 모드(맛보기·예시)·Claude 플러그인은 숨기기, 내가 등록한 것·데이터 폴더 모드는 진짜 제거.
// 원본 폴더는 고른 때만 맥 휴지통(Rust modes_host::remove). 이 파일은 글 없는 셈만 — 글은 화면(데스크톱 tr·폰 한글)이 붙인다
import type { ModeRow } from './modeTree';

/** mode_manage 한 줄(Rust modes_host::ManageRow) — way: hide(기본·플러그인) | remove(사용자 모드), size: 앱 쪽 데이터 바이트 */
export type ManageRow = Pick<ModeRow, 'name' | 'title' | 'source' | 'dir' | 'on' | 'where' | 'alive' | 'pid' | 'dash' | 'shared'> & { hidden: boolean; way: 'hide' | 'remove'; size: number;
  /** 안 보여서 재웠다(보이면 깨어난다) */ asleep?: boolean; /** 깨어 있는 호스트 메모리 KB(못 읽으면 0) */ memKb?: number };

/** mode_remove 답 — trashed = 원본을 보낸 휴지통 자리 */
export type Removed = { kind: 'hidden' | 'removed'; trashed: string | null; undo: boolean };

/** 한 목록(사용자 모드 위·이름 순, 기본 모드 아래·목록 순) + 맨 아래 '숨긴 기본 모드' */
export function manageGroups<T extends Pick<ManageRow, 'title' | 'source' | 'hidden'>>(rows: readonly T[]): { list: T[]; hidden: T[] } {
  const shown = rows.filter((r) => !r.hidden);
  const own = shown.filter((r) => r.source !== 'example').sort((a, b) => a.title.localeCompare(b.title));
  return { list: [...own, ...shown.filter((r) => r.source === 'example')], hidden: rows.filter((r) => r.hidden) };
}

/** 원본 폴더 휴지통 체크 — 내가 등록한 것 = 고를 수 있음, 데이터 폴더 모드 = 그 폴더가 원본이라 늘 켜짐, 기본·플러그인 = 없음 */
export function trashChoice(source: ManageRow['source']): 'optional' | 'required' | 'none' {
  return source === 'added' ? 'optional' : source === 'folder' ? 'required' : 'none';
}

/** 되돌리기 토스트를 띄울까 — 숨기기와 원본을 안 보낸 제거만(등록·사본만 되살리면 된다) */
export const removeUndo = (r: Removed) => r.undo && !r.trashed;

export function sizeText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v : Number(v.toFixed(v < 10 ? 1 : 0))} ${units[i]}`;
}

/** 폰 지우기 단추 — 폰은 원본 휴지통을 못 고른다. 데이터 폴더 모드는 그 폴더가 원본이라(휴지통 필수) 단추 없음 → null */
export function phoneRemove(source: string): 'hide' | 'remove' | null {
  return source === 'folder' ? null : source === 'added' ? 'remove' : 'hide';
}

/** 호스트 상태 — 깨어 있음(+메모리) · 잠듦 · 꺼짐(null). keepAlive 를 안 적은 모드는 안 보인 지 5분이면 잔다(10/12) */
export function hostState(r: Pick<ManageRow, 'alive' | 'asleep' | 'memKb' | 'shared'>): { kind: 'awake'; mem: string | null; shared: boolean } | { kind: 'asleep' } | null {
  // shared = 가벼운 모드끼리 같이 쓰는 호스트(ADR 0006) — 메모리는 그 호스트 하나 것이라 같이 쓰는 줄마다 같은 값
  if (r.alive) return { kind: 'awake', mem: r.memKb ? sizeText(r.memKb * 1024) : null, shared: !!r.shared };
  return r.asleep ? { kind: 'asleep' } : null;
}
