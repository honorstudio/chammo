// 목록 정렬 — 팀 보관함·참모 보관함이 같이 쓴다(정렬 단추 ui/kit/SortButton). 이름·올린(고친) 날짜·크기·올린 사람, 오름/내림
import { tr } from '../i18n';

export type SortKey = 'name' | 'at' | 'size' | 'by';
export type SortState<K extends SortKey = SortKey> = { key: K; desc: boolean };
/** 정렬에 쓰는 값 — by 가 없으면 이름 */
export type SortVals = { name: string; at: number; size: number; by?: string };

export const sortName = (k: SortKey) => ({ name: tr('이름', 'Name'), at: tr('날짜', 'Date'), size: tr('크기', 'Size'), by: tr('올린 사람', 'Added by') })[k];
/** 기준을 바꿀 때 처음 방향 — 날짜·크기는 큰 것 먼저, 글은 가나다 */
export const firstDesc = (k: SortKey) => k === 'at' || k === 'size';

/** 기억한 정렬 — 모르는 값·막힌 저장소면 날짜 새것 먼저 */
export function readSortOf<K extends SortKey>(get: () => string | null, keys: readonly K[]): SortState<K> {
  const fallback = { key: 'at', desc: true } as SortState<K>;
  try {
    const v = JSON.parse(get() ?? 'null') as Partial<SortState<K>> | null;
    return v && keys.includes(v.key as K) && typeof v.desc === 'boolean' ? { key: v.key as K, desc: v.desc } : fallback;
  } catch { return fallback; }
}

const coll = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
/** 정렬 — 같은 값이면 새것 먼저 */
export function sortList<T>(items: T[], s: SortState, val: (x: T) => SortVals): T[] {
  const cmp = (a: SortVals, b: SortVals) => (s.key === 'name' ? coll.compare(a.name, b.name) : s.key === 'by' ? coll.compare(a.by ?? a.name, b.by ?? b.name) : s.key === 'size' ? a.size - b.size : a.at - b.at);
  return items.map((x) => ({ x, v: val(x) })).sort((a, b) => (s.desc ? -cmp(a.v, b.v) : cmp(a.v, b.v)) || b.v.at - a.v.at).map((p) => p.x);
}
