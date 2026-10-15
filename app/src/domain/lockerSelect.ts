// 보관함 여러 개 고르기(2026-10-12 사용자 "골라서 지우려는데 고르는 단추가 없다" → 같은 날 "파인더처럼 늘 되게") — 따로 켜는 모드 없이
// 빈 곳에서 끌면 네모 선택(⌘끌기 = 더하고 빼기), ⌘클릭 = 하나씩 넣고 빼기, ⇧클릭 = 기준점부터 범위, ⌘A = 전부, 빈 곳 클릭·Esc = 풀기.
// 그냥 누름은 열기(고른 건 풀린다). 열쇠는 절대 경로(기록 줄·보관함 줄 공통), 순서는 화면에 보이는 순서.
// 여기는 판단만(시험: lockerSelect.test.ts), 그리기·끌기는 ui/space/LockerPage
import type { LockerMenuKey } from './lockerMenu';

export type Sel = { keys: string[]; /** ⇧클릭 범위의 시작 — 마지막으로 ⌘클릭·우클릭한 것 */ anchor: string | null };
export const NO_SEL: Sel = { keys: [], anchor: null };

export type Mods = { meta?: boolean; shift?: boolean };

/** 카드·줄 누름 — 고른 상태(null 이면 고르기가 아니라 그냥 열기) */
export function pickClick(s: Sel, order: string[], key: string, m: Mods): Sel | null {
  if (m.shift) {
    const a = s.anchor ? order.indexOf(s.anchor) : -1;
    const b = order.indexOf(key);
    if (a < 0 || b < 0) return { keys: s.keys.includes(key) ? s.keys : [...s.keys, key], anchor: key };
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { keys: [...s.keys, ...range.filter((k) => !s.keys.includes(k))], anchor: s.anchor };
  }
  if (m.meta) return { keys: s.keys.includes(key) ? s.keys.filter((x) => x !== key) : [...s.keys, key], anchor: key };
  return null;
}

/** ⌘A — 보이는 것 전부 */
export const pickAll = (order: string[]): Sel => ({ keys: [...order], anchor: order[0] ?? null });

/** 우클릭 — 고른 묶음 밖이면 그 하나만 고른다(안이면 묶음 그대로) */
export const pickOne = (s: Sel, key: string): Sel => (s.keys.includes(key) ? s : { keys: [key], anchor: key });

/** 보이는 목록이 바뀌었다(휴지통으로 갔다·다시 읽음) — 없어진 건 뺀다. 그대로면 같은 것 */
export function pickKeep(s: Sel, order: string[]): Sel {
  const keys = s.keys.filter((k) => order.includes(k));
  const anchor = s.anchor && order.includes(s.anchor) ? s.anchor : null;
  return keys.length === s.keys.length && anchor === s.anchor ? s : { keys, anchor };
}

// ── 네모 선택(러버밴드) ──

export type Box = { left: number; top: number; right: number; bottom: number };

/** 누른 곳·지금 곳 → 네모(어느 쪽으로 끌어도) */
export const bandBox = (x0: number, y0: number, x1: number, y1: number): Box => ({ left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) });

/** 네모에 걸린 것 — 조금이라도 겹치면(화면 순서대로) */
export function bandHits(band: Box, items: { key: string; box: Box }[]): string[] {
  return items.filter(({ box: b }) => b.left < band.right && b.right > band.left && b.top < band.bottom && b.bottom > band.top).map((x) => x.key);
}

/** 끌기 중 고른 것 — 시작할 때 고른 것(base)에서: 그냥 끌기 = 걸린 것만, ⌘끌기 = 걸린 것을 넣고 빼기(이미 고른 건 빠진다) */
export function pickBand(base: Sel, hits: string[], toggle: boolean): Sel {
  const keys = toggle ? [...base.keys.filter((k) => !hits.includes(k)), ...hits.filter((k) => !base.keys.includes(k))] : hits;
  return { keys, anchor: hits[0] ?? base.anchor };
}

/** 끌다가 칸 위·아래 끝에 닿으면 저절로 스크롤 — 끝에서 zone 안이면 가까울수록 빠르게(한 번에 max 까지), 밖이면 0 */
export function edgeScroll(y: number, top: number, bottom: number, zone = 40, max = 18): number {
  if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - (bottom - zone)) / zone));
  return 0;
}

// ── 묶음 동작 ──

/** 고른 한 줄의 모양 — 파일·폴더, 보관함 줄인가(기록의 보여 준 파일은 아님), 연결 폴더 자체(linked)·그 안쪽(ro)·원본 없음 */
export type PickedLook = { kind: 'file' | 'folder'; inLocker: boolean; linked?: boolean; ro?: boolean; gone?: boolean };
export type BatchKey = Extract<LockerMenuKey, 'send' | 'alias' | 'move' | 'trash'>;

/** 고른 묶음에 되는 동작 — 묶음 전부에 되는 것만. 기록 목록은 바로가기·보내기만(기록 줄은 안 지운다),
 *  연결 폴더 안쪽은 휴지통(맥 휴지통)만 열려 있고 옮기기는 없다, 폰은 연결 폴더 안 휴지통도 막는다 */
export function batchActs(xs: PickedLook[], at: { where: 'dir' | 'log'; folders: number; phone?: boolean }): BatchKey[] {
  if (xs.length === 0) return [];
  const files = xs.every((x) => x.kind === 'file');
  const out: BatchKey[] = [];
  if (files && xs.every((x) => !x.gone)) out.push('send');
  if (files && at.folders > 0) out.push('alias');
  if (at.where === 'log') return out;
  if (xs.every((x) => x.inLocker && !x.ro)) out.push('move');
  if (xs.every((x) => x.inLocker && !x.linked && !(x.ro && at.phone))) out.push('trash');
  return out;
}

/** 고른 채 Backspace·Delete·⌘⌫ — Finder 처럼 휴지통(2026-10-15 사용자). 파일 하나 = 바로(우클릭 휴지통과 같게, 되돌리기 알림),
 *  여럿·폴더 = 묶음 흐름(규모 확인·폴더 섞이면 묻기). 연결 폴더 자체는 안 된다(연결 풀기로). 입력칸·이름 칸·한글 조합 중·보관함 밖 포커스·묻는 중엔 아무 일 없음 */
export function trashKey(e: { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; inBox: boolean; composing: boolean; editable: boolean; asking: boolean }, xs: PickedLook[], where: 'dir' | 'log'): 'one' | 'many' | null {
  if ((e.key !== 'Backspace' && e.key !== 'Delete') || e.ctrl || e.alt || !e.inBox || e.composing || e.editable || e.asking || xs.length === 0) return null;
  if (xs.length === 1 && xs[0]!.kind === 'file') return xs[0]!.inLocker ? 'one' : null;
  return batchActs(xs, { where, folders: 0 }).includes('trash') ? 'many' : null;
}

/** 여럿 고른 채 오른쪽 클릭 — 보내기 / 바로가기·옮기기 / 휴지통 */
export function batchMenu(acts: BatchKey[]): BatchKey[][] {
  return [['send'], ['alias', 'move'], ['trash']].map((g) => g.filter((k) => acts.includes(k as BatchKey)) as BatchKey[]).filter((g) => g.length > 0);
}
