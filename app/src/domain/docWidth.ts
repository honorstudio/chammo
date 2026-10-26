// md 문서 폭 — 넓게(기본)/좁게(2026-10-24 사용자: 글이 가운데 좁게 모이고 좌우가 비었다).
// 스페이스 문서(DocPage)와 리더 md 가 한 값을 같이 쓴다 — 한쪽에서 바꾸면 다른 쪽도 바로 따라온다.
// 앱을 다시 켜도 남게 localStorage 에(막혀 있으면 이번 실행 메모리만)

export const DOC_WIDE_KEY = 'docWide.v1';
export const DOC_WIDE_DEFAULT = true;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 저장값 → 넓게? '0' 만 좁게, 나머지(없음·깨진 값)는 기본(넓게) */
export const parseDocWide = (raw: string | null): boolean => (raw === '0' ? false : raw === '1' ? true : DOC_WIDE_DEFAULT);

export function docWideStore(storage?: Store) {
  let wide = DOC_WIDE_DEFAULT;
  try { wide = parseDocWide(storage?.getItem(DOC_WIDE_KEY) ?? null); } catch { /* 막힌 저장소는 기본값 */ }
  const subs = new Set<() => void>();
  const set = (v: boolean) => {
    if (v === wide) return;
    wide = v;
    try { storage?.setItem(DOC_WIDE_KEY, v ? '1' : '0'); } catch { /* 이번 실행만 기억 */ }
    subs.forEach((f) => f());
  };
  return {
    get: () => wide,
    set,
    toggle: () => set(!wide),
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}
