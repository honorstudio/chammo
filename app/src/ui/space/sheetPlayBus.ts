import type { Put } from '../../domain/sheetPlay';

/**
 * 참모 칸 쓰기(scripts/sheet set) 받는 자리 — Rust 가 window.__sheetPlay(…) 를 eval 로 부른다.
 * 이 앱은 capabilities 가 없어 이벤트 listen 이 막혀 있다(Craft 의 __craftSpace 와 같은 길, 2026-10-21 실측)
 */
export interface SheetPlay { id: string; path: string; puts: Put[]; by?: string }

const subs = new Map<string, Set<(p: SheetPlay) => void>>();

/** 그 파일 표가 받기 — 끄는 함수를 돌려준다 */
export function onSheetPlay(path: string, fn: (p: SheetPlay) => void): () => void {
  const set = subs.get(path) ?? new Set();
  set.add(fn);
  subs.set(path, set);
  return () => {
    set.delete(fn);
    if (!set.size) subs.delete(path);
  };
}

/** window 에 받는 자리를 단다 — 받은 표가 있으면 true(없으면 Rust 가 3초 뒤 파일 패치로 물러난다) */
export function installSheetPlay(w: { __sheetPlay?: (p: SheetPlay) => boolean }) {
  w.__sheetPlay = (p) => {
    const set = subs.get(p.path);
    set?.forEach((fn) => fn(p));
    return !!set?.size;
  };
}

if (typeof window !== 'undefined') installSheetPlay(window as unknown as { __sheetPlay?: (p: SheetPlay) => boolean }); // 시험(노드)엔 window 가 없다
