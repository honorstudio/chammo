// 캐릭터·물건 도트 — 다마고치 도트(한 색 + 스킨)와 새 컬러 도트(artSprites.gen, 자기 색). 사무실·뽑기 아이콘이 같이 쓴다
import { ART_SPR, type ArtSprite } from '../gacha/packs/artSprites.gen';
import { SPR } from '../tama/sprites';
import type { Skin } from './skins';

type Pt = [number, number];
type R = { rect: (x: number, y: number, w: number, h: number, c: string) => void };

/** 컬러 도트 — 가로로 이어진 칸을 묶어 칠한다(매 프레임 부르니까) */
type Run = [number, number, number, string];
const RUNS = new WeakMap<ArtSprite, Run[]>();
function runsOf(a: ArtSprite): Run[] {
  let out = RUNS.get(a);
  if (out) return out;
  out = [];
  a.rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const ch = row[x]!;
      if (ch === '.') { x++; continue; }
      let e = x + 1;
      while (e < row.length && row[e] === ch) e++;
      out!.push([x, y, e - x, a.pal[parseInt(ch, 36)]!]);
      x = e;
    }
  });
  RUNS.set(a, out);
  return out;
}
export function drawArt(b: R, a: ArtSprite, x: number, y: number, flip = false) {
  for (const [rx, ry, len, c] of runsOf(a)) b.rect(flip ? x + a.w - rx - len : x + rx, y + ry, len, 1, c);
}

// 다마고치 도트: '#' 외곽 · e 눈 · m 입 · p 무늬 · 갇힌 '.' 몸통 · 바깥 '.' 투명
const MASK = new Map<string, Set<number>>();
/**
 * 투명(바깥) 칸 — 테두리에서 물을 부어 닿는 '.' 중, 위·아래·왼쪽·오른쪽 네 방향 모두에 선이 있는 칸은 뺀다.
 * 외곽선에 틈이 있는 도트는 물이 새어 몸통까지 투명해졌다(2026-09-27 project-b 캐릭터)
 */
const CLEAR = new Map<string, Set<number>>();
const transparent = (name: string) => { let c = CLEAR.get(name); if (!c) { c = transparentCells(name); CLEAR.set(name, c); } return c; };
export function transparentCells(name: string): Set<number> {
  const flood = outside(name), rows = SPR[name]!, w = rows[0]!.length, h = rows.length;
  const solid = (y: number, x: number) => rows[y]![x] !== '.';
  const out = new Set<number>();
  for (const k of flood) {
    const y = Math.floor(k / w), x = k % w;
    let l = false, r = false, u = false, d = false;
    for (let i = 0; i < x && !l; i++) l = solid(y, i);
    for (let i = x + 1; i < w && !r; i++) r = solid(y, i);
    for (let i = 0; i < y && !u; i++) u = solid(i, x);
    for (let i = y + 1; i < h && !d; i++) d = solid(i, x);
    if (!(l && r && u && d)) out.add(k);
  }
  capSlits(rows, out);
  return out;
}
/**
 * 배에 난 세로 틈 메우기 — 다리 사이로 들어온 물이 네 방향 판정에서 '아래가 뚫림'으로 남아 몸통에 투명 줄을 팠다(2026-10-21 사용자 '도트 구멍').
 * 한 줄에서 이어진 투명 칸 덩어리가 양 끝이 막혔고, 바로 위가 전부 막혔고, 한쪽 끝이라도 외곽선(#)이 아닌 몸통·무늬면 몸통으로 — 위에서 아래로 되풀이.
 * 양 끝이 다 외곽선인 칸(다리 사이·체크무늬 다리)은 안 번진다
 */
function capSlits(rows: string[], out: Set<number>) {
  const h = rows.length, w = rows[0]!.length;
  const clear = (y: number, x: number) => rows[y]![x] === '.' && out.has(y * w + x);
  const wall = (y: number, x: number) => y >= 0 && x >= 0 && y < h && x < w && !clear(y, x);
  const inner = (y: number, x: number) => wall(y, x) && rows[y]![x] !== '#';
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w;) {
        if (!clear(y, x)) { x++; continue; }
        let j = x;
        while (j < w && clear(y, j)) j++;
        const ups = Array.from({ length: j - x }, (_, k) => x + k);
        if (x > 0 && j < w && wall(y, x - 1) && wall(y, j) && ups.every((c) => wall(y - 1, c)) && (inner(y, x - 1) || inner(y, j))) {
          for (const c of ups) out.delete(y * w + c);
          changed = true;
        }
        x = j;
      }
    }
  }
}
function outside(name: string): Set<number> {
  const hit = MASK.get(name);
  if (hit) return hit;
  const rows = SPR[name]!, h = rows.length, w = rows[0]!.length, out = new Set<number>(), st: Pt[] = [];
  for (let y = 0; y < h; y++) st.push([y, 0], [y, w - 1]);
  for (let x = 0; x < w; x++) st.push([0, x], [h - 1, x]);
  while (st.length) {
    const [y, x] = st.pop()!;
    if (y < 0 || x < 0 || y >= h || x >= w || out.has(y * w + x) || rows[y]![x] !== '.') continue;
    out.add(y * w + x); st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  MASK.set(name, out);
  return out;
}
export function pet(b: R, sk: Skin, name: string, x: number, y: number, fill: string, o: { shut?: boolean; flip?: boolean } = {}) {
  const art = ART_SPR[name];
  if (art) { drawArt(b, art, x + 8 - (art.w >> 1), y + 16 - art.h, o.flip); return; } // 16칸 자리 기준 아래 가운데 — 새 캐릭터는 머리가 더 크다
  const rows = SPR[name] ?? SPR.egg;
  if (!rows) return;
  const key = SPR[name] ? name : 'egg';
  const out = transparent(key), w = rows[0]!.length;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '.' && out.has(r * w + c)) return;
    let col = fill;
    if (ch === '#' || ch === 'm') col = sk.line;
    else if (ch === 'e') col = o.shut ? fill : sk.line;
    else if (ch === 'p') col = sk.pat;
    b.rect(x + (o.flip ? w - 1 - c : c), y + r, 1, 1, col);
  }));
}
/** 머리 꼭대기 줄 — 모자를 종마다 머리에 맞춰 씌운다(곰은 1). 작은 종에 모자가 허공에 떠 있었다(2026-10-21) */
export const headTop = (name: string) => { const art = ART_SPR[name]; return art ? 16 - art.h : Math.max(0, (SPR[name] ?? SPR.egg!).findIndex((r) => /[^.]/.test(r))); };
