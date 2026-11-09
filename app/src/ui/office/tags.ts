// 폰 방 이름표(2026-10-23 사용자 실폰 — 세션 17개면 이름표가 겹겹이 쌓여 글이 서로 가렸다).
// 폰은 방이 좁아 사람이 볼 것만 단다: 사람 필요·물어봄·지금 고른 캐릭터. 나머지 이름은 방 아래 세션 줄에 있다.
// 남은 것끼리 겹치면 아래·위로 두 칸까지 비키고(한 칸만 보면 이웃 둘 사이에 끼어 접혔다 — 시험 17개), 그래도 자리가 없으면 겹친 이름표에 '+N' 으로 접는다
import type { Spot } from './draw';

/** 화면 px 상자 — left·top 은 방 왼쪽 위 기준, cx 는 가운데(이름표는 translate(-50%) 로 그린다) */
export type TagPos = { id: string; cx: number; left: number; top: number; w: number; h: number; /** 여기 접힌 이름표 수 */ more: number };

const FONT = 11, PAD = 7, GAP = 2;

/** 이름표 크기 어림 — room.css .office-tag(11px·굵게·좌우 7px·줄 1.5). 한글·넓은 글은 글 크기만큼, 나머지는 0.6배 */
export function tagBox(label: string): { w: number; h: number } {
  let w = 0;
  for (const ch of label) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? FONT : FONT * 0.6;
  return { w: Math.ceil(w + PAD * 2), h: Math.ceil(FONT * 1.5) };
}

const hit = (a: TagPos, b: TagPos) => a.left < b.left + b.w + GAP && b.left < a.left + a.w + GAP && a.top < b.top + b.h + GAP && b.top < a.top + a.h + GAP;
const rank = (s: Spot, picked: string | null | undefined) => (s.id === picked ? 0 : s.human !== undefined ? 1 : 2);

/** '+N' 꼬리 폭 — room.css .office-more(10px·굵게·왼쪽 4px). 접힌 이름표는 그만큼 넓어진다 */
export const MORE_W = 18;
const OFFS = [0, 1, -1, 2, -2];
const wide = (t: TagPos): TagPos => (t.more ? { ...t, left: t.cx - (t.w + MORE_W) / 2, w: t.w + MORE_W } : t);

/** 차례(want)대로 자리를 잡는다 — 겹치면 위아래로 두 칸까지 비키고, 그래도 없으면 제자리에서 가장 많이 겹친 이름표에 +N */
function lay(want: Spot[], scale: number, roomW: number): TagPos[] {
  const out: TagPos[] = [];
  const at = (s: Spot, w: number, h: number, top: number): TagPos => {
    const cx = Math.min(Math.max(s.x * scale, w / 2), Math.max(w / 2, roomW - w / 2));
    return { id: s.id, cx, left: cx - w / 2, top, w, h, more: 0 };
  };
  for (const s of want) {
    const { w, h } = tagBox(s.label);
    const y = s.y * scale;
    const free = OFFS.map((k) => at(s, w, h, y + k * (h + GAP))).find((t) => !out.some((o) => hit(wide(o), t)));
    if (free) { out.push(free); continue; }
    const home = at(s, w, h, y);
    const area = (o: TagPos) => Math.max(0, Math.min(o.left + o.w, home.left + home.w) - Math.max(o.left, home.left)) * Math.max(0, Math.min(o.top + o.h, home.top + home.h) - Math.max(o.top, home.top));
    const host = out.filter((o) => hit(o, home)).sort((a, b) => area(b) - area(a))[0] ?? out[0]!;
    host.more += 1;
  }
  // +N 이 붙어 넓어진 이름표가 이웃과 닿으면 위아래로 다시 비킨다 — 그래도 닿으면 그 이웃을 접는다
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const t of out) {
      if (!t.more) continue;
      const others = () => out.filter((o) => o !== t);
      if (!others().some((o) => hit(wide(t), wide(o)))) continue;
      const base = t.top, step = t.h + GAP, spot = want.find((s) => s.id === t.id)!;
      const y0 = spot.y * scale;
      const k = OFFS.find((k) => { t.top = y0 + k * step; return !others().some((o) => hit(wide(t), wide(o))); });
      if (k === undefined) {
        t.top = base;
        for (const o of others().filter((o) => hit(wide(t), wide(o)))) { t.more += 1 + o.more; out.splice(out.indexOf(o), 1); }
      }
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/** spots(방 좌표) → 달 이름표(화면 px). scale = 방 배율, roomW = 방 폭(px) */
export function fewTags(spots: Spot[], picked: string | null | undefined, scale: number, roomW: number): TagPos[] {
  const want = spots
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s.id === picked || s.human !== undefined || s.st === 'asks')
    .sort((a, b) => rank(a[0], picked) - rank(b[0], picked) || a[1] - b[1])
    .map(([s]) => s);
  return lay(want, scale, roomW);
}

/**
 * 데스크톱 방 — 이름표를 다 달되 서로 안 겹치게(11-09 사용자 13명 방에서 이름표끼리 겹쳐 누가 누군지 몰랐다).
 * 자리 잡는 차례: 고른 것 → 사람 필요 → 물어봄 → 지금 탭 참모가 시킨 것 → 옅은 것(dim) — 자리가 모자라면 뒤쪽부터 +N 으로 접힌다
 */
export function allTags(spots: Spot[], picked: string | null | undefined, scale: number, roomW: number, dim?: (id: string) => boolean): TagPos[] {
  const r = (s: Spot) => (s.id === picked ? 0 : s.human !== undefined ? 1 : s.st === 'asks' ? 2 : s.off ? 4 : dim?.(s.id) ? 4 : 3);
  const want = spots.map((s, i) => [s, i] as const).sort((a, b) => r(a[0]) - r(b[0]) || a[1] - b[1]).map(([s]) => s);
  return lay(want, scale, roomW);
}
