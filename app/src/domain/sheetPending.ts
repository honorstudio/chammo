/**
 * 스페이스 엑셀 — 저장한 고침을 '보낼 것'으로 모은다. 칸마다 처음 값(보낸 뒤 첫 고침 직전) → 지금 값, 수식·서식 바뀜,
 * 행열·시트 조작은 메모로. 행을 끼우거나 지우면 앞서 모은 칸 주소도 같이 민다(보낼 때 지금 자리로 말하게)
 */
import { cellName, type SheetValue } from './sheetBook';
import type { CellState, LogEntry } from './sheetLog';

export interface Brief { v?: SheetValue | null; f?: string | null }
export interface SheetEdit { sheet: string; name: string; r: number; c: number; before: Brief; after: Brief; styled: boolean }
export interface SheetPending { cells: SheetEdit[]; notes: string[] }
export const EMPTY: SheetPending = { cells: [], notes: [] };

const brief = (s?: CellState): Brief => ({ v: s?.v ?? null, f: s?.f ?? null });
const same = (a: Brief, b: Brief) => (a.v ?? null) === (b.v ?? null) && (a.f ?? null) === (b.f ?? null);

/** 행열 조작 하나로 칸 자리 옮기기 — 지워진 칸이면 null */
function shift(e: SheetEdit, op: Record<string, unknown>): SheetEdit | null {
  const at = Number(op.at), n = Number(op.n);
  const kind = String(op.op);
  const row = kind.endsWith('Rows');
  const v = row ? e.r : e.c;
  let nv = v;
  if (kind.startsWith('insert')) nv = v >= at ? v + n : v;
  else if (kind.startsWith('delete')) { if (v >= at && v < at + n) return null; nv = v >= at + n ? v - n : v; }
  return row ? { ...e, r: nv } : { ...e, c: nv };
}

function note(op: Record<string, unknown>, name: string): string | null {
  const at = Number(op.at), n = Number(op.n);
  const col = (i: number) => cellName(0, i).replace(/\d+$/, '');
  switch (op.op) {
    case 'insertRows': return `${name}: ${at + 1}행 앞에 ${n}행 끼움`;
    case 'deleteRows': return n === 1 ? `${name}: ${at + 1}행 지움` : `${name}: ${at + 1}~${at + n}행 지움`;
    case 'insertCols': return `${name}: ${col(at)}열 앞에 ${n}열 끼움`;
    case 'deleteCols': return n === 1 ? `${name}: ${col(at)}열 지움` : `${name}: ${col(at)}~${col(at + n - 1)}열 지움`;
    case 'addSheet': return `시트 '${op.name}' 추가`;
    case 'renameSheet': return `시트 '${name}' → '${op.name}' 이름 바꿈`;
    case 'deleteSheet': return `시트 '${name}' 지움`;
    case 'merge': return `${name}!${op.range} 병합`;
    case 'unmerge': return `${name}!${op.range} 병합 풀기`;
    default: return null; // 열 너비·행 높이는 메모로 안 남긴다(잦고 사소)
  }
}

/** 저장한 기록 → 보낼 것에 더하기. 수식 다시 계산 칸(calc)은 사용자가 고친 게 아니라 뺀다 */
export function addLog(p: SheetPending, log: LogEntry[]): SheetPending {
  let cells = p.cells.slice();
  const notes = p.notes.slice();
  for (const e of log) {
    if (e.k === 'blocked') continue;
    if (e.k === 'op') {
      const part = String(e.op.part ?? '');
      const name = e.name ?? part;
      if (/Rows|Cols/.test(String(e.op.op))) cells = cells.map((x) => (x.sheet === part ? shift(x, e.op) : x)).filter((x): x is SheetEdit => !!x);
      if (e.op.op === 'renameSheet') cells = cells.map((x) => (x.sheet === part ? { ...x, name: String(e.op.name) } : x));
      if (e.op.op === 'deleteSheet') cells = cells.filter((x) => x.sheet !== part);
      const t = note(e.op, name);
      if (t) notes.push(t);
      continue;
    }
    if (e.calc) continue;
    const i = cells.findIndex((x) => x.sheet === e.sheet && x.r === e.r && x.c === e.c);
    const after = brief(e.now);
    if (i >= 0) {
      const x = { ...cells[i]!, after, styled: cells[i]!.styled || e.styled, name: e.name };
      if (same(x.before, x.after) && !x.styled) cells.splice(i, 1); else cells[i] = x;
    } else {
      const before = brief(e.before);
      if (!same(before, after) || e.styled) cells.push({ sheet: e.sheet, name: e.name, r: e.r, c: e.c, before, after, styled: e.styled });
    }
  }
  return { cells, notes };
}

export const countOf = (p: SheetPending) => p.cells.length + p.notes.length;

const show = (b: Brief) => {
  const cut = (s: string) => ([...s].length > 40 ? `${[...s].slice(0, 40).join('')}…` : s);
  const v = b.v == null || b.v === '' ? '(빈 칸)' : typeof b.v === 'number' ? b.v.toLocaleString('ko-KR', { maximumFractionDigits: 6 }) : typeof b.v === 'boolean' ? (b.v ? 'TRUE' : 'FALSE') : `"${cut(String(b.v))}"`;
  return b.f ? `${v}(=${cut(b.f)})` : v;
};

const MAX = 40;

/** 보낼 글의 한 파일 부분 — 칸 '시트!B3 10 → 12', 수식만 바뀌면 '수식 바뀜', 서식만이면 '서식 바뀜' */
export function sheetLines(path: string, p: SheetPending): string[] {
  if (!countOf(p)) return [];
  const rows = p.cells.slice().sort((a, b) => a.name.localeCompare(b.name) || a.r - b.r || a.c - b.c).map((x) => {
    const at = `${x.name}!${cellName(x.r, x.c)}`;
    const valueSame = same(x.before, x.after);
    const formulaOnly = (x.before.v ?? null) === (x.after.v ?? null) && x.before.f !== x.after.f;
    const tail = x.styled ? (valueSame ? ' 서식 바뀜' : ' (서식도)') : '';
    if (valueSame) return `· ${at}${tail}`;
    if (formulaOnly) return `· ${at} 수식 바뀜 ${show(x.before)} → ${show(x.after)}${tail}`;
    return `· ${at} ${show(x.before)} → ${show(x.after)}${tail}`;
  });
  const out = [`■ ${path.split('/').pop()} (${path})`, ...rows.slice(0, MAX)];
  if (rows.length > MAX) out.push(`… 칸 ${rows.length - MAX}개 더 — 파일에서 보기`);
  out.push(...p.notes.map((t) => `· ${t}`));
  return out;
}

/**
 * 밖(참모·세션)이 파일을 고쳤을 때, 아직 안 쓴 내 고침을 바깥 판 위에 그대로 얹어도 되나 — 내가 고친 칸을 밖에서도 고쳤으면 충돌.
 * 행열·시트 조작이 섞여 있으면 자리가 달라 판정할 수 없어 충돌로 본다. 돌려주는 값 = 충돌 칸 이름들(빈 배열 = 얹어도 된다)
 */
export function conflicts(log: LogEntry[], outside: { sheets: { name: string; part: string; cells: { r: number; c: number; v?: SheetValue; f?: string }[] }[] }): string[] {
  if (log.some((e) => e.k === 'op')) return ['행·열·시트 조작'];
  // 내가 고친 칸만(수식 다시 계산 칸은 다시 읽은 뒤 표가 다시 계산한다)
  const mine = addLog(EMPTY, log.map((e) => (e.k === 'cell' && !e.calc ? { ...e, styled: false } : e)));
  const out: string[] = [];
  for (const x of mine.cells) {
    const sh = outside.sheets.find((s) => s.part === x.sheet || s.name === x.sheet);
    if (!sh) { out.push(`${x.name} 시트`); continue; }
    const now = sh.cells.find((c) => c.r === x.r && c.c === x.c);
    const theirs: Brief = { v: now?.v ?? null, f: now?.f ?? null };
    const num = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
    const sameV = (theirs.v ?? null) === (x.before.v ?? null) || num(theirs.v, x.before.v);
    // 수식 칸은 계산 결과가 달라져도(밖에서 다른 칸을 고쳐) 수식이 같으면 같은 칸으로 본다
    const ok = x.before.f ? theirs.f === x.before.f : sameV && !theirs.f;
    if (!ok) out.push(`${x.name}!${cellName(x.r, x.c)}`);
  }
  return out;
}
