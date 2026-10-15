/**
 * 스페이스 엑셀 — Rust(read_sheet_book)가 읽은 통합 문서 ↔ 표 화면(Univer) 데이터. 화면 라이브러리는 안 불러온다(시험·폰에서도 쓴다).
 * ADR 0004: 화면은 Univer, 파일은 Rust 가 원본에서 고친 칸만 바꿔 끼운다
 */

export type SheetValue = string | number | boolean;
export interface SheetCell { r: number; c: number; v?: SheetValue; f?: string; s?: number; err?: boolean }
export interface Edge { style: string; color?: string }
export interface SheetFont { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; sz?: number; color?: string; name?: string }
export interface SheetStyle {
  numFmt?: string;
  font?: SheetFont;
  fill?: string;
  border?: { l?: Edge; r?: Edge; t?: Edge; b?: Edge };
  align?: { h?: string; v?: string; wrap?: boolean };
}
export interface SheetCond { sqref: string; kind: string; op?: string; formulas: string[]; dxf?: number; priority: number; text?: string }
export interface SheetData {
  name: string;
  part: string;
  hidden: boolean;
  cells: SheetCell[];
  merges: string[];
  cols: { min: number; max: number; width?: number; hidden?: boolean }[];
  rows: { r: number; ht?: number; hidden?: boolean }[];
  freeze?: [number, number];
  cond: SheetCond[];
  valid: { sqref: string; kind: string; formula1: string }[];
  defaultColWidth?: number;
  defaultRowHeight?: number;
  charts: number;
  images: number;
}
export interface SheetBook { sheets: SheetData[]; styles: { cell: SheetStyle[]; dxf: SheetStyle[]; font: SheetFont } }

// Univer 값(열거형 숫자) — 라이브러리를 안 불러오려고 여기 적는다(@univerjs/core 1.0.4 와 같은 값)
const H_ALIGN: Record<string, number> = { left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4, fill: 1, distributed: 6 };
const V_ALIGN: Record<string, number> = { top: 1, center: 2, bottom: 3, justify: 2, distributed: 2 };
const BORDER: Record<string, number> = { thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7, medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13 };
const WRAP = 3;
/** Univer 편집기 기본 글자색(@univerjs/themes 1.0.3) */
const UNIVER_TEXT = '#1B1C1F';
const T_STRING = 1, T_BOOLEAN = 3, T_FORCE_STRING = 4;

/** 엑셀 열 너비(글자 수) → 화면 픽셀, 행 높이(pt) → 픽셀 */
export const colPx = (w: number) => Math.round(w * 7 + 5);
export const rowPx = (pt: number) => Math.round((pt * 96) / 72);

/** "B3" → [2, 1] (0부터), "A1:C4" → 범위 */
export function a1(s: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(s.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]!) c = c * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, c - 1];
}
export interface Range { startRow: number; startColumn: number; endRow: number; endColumn: number }
export function range(s: string): Range | null {
  const [x, y = x] = s.split(':');
  const p = a1(x!), q = a1(y!);
  if (!p || !q) return null;
  return { startRow: Math.min(p[0], q[0]), startColumn: Math.min(p[1], q[1]), endRow: Math.max(p[0], q[0]), endColumn: Math.max(p[1], q[1]) };
}
export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

type UStyle = Record<string, unknown>;
const rgb = (c?: string) => (c ? { rgb: c } : undefined);
const clean = (o: UStyle) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** 서식 → Univer 칸 서식 */
export function toUniverStyle(s: SheetStyle): UStyle {
  const f = s.font ?? {};
  const edge = (e?: Edge) => (e ? clean({ s: BORDER[e.style] ?? 1, cl: rgb(e.color) }) : undefined);
  const bd = s.border ? clean({ l: edge(s.border.l), r: edge(s.border.r), t: edge(s.border.t), b: edge(s.border.b) }) : undefined;
  return clean({
    bl: f.b ? 1 : undefined, it: f.i ? 1 : undefined, ul: f.u ? { s: 1 } : undefined, st: f.strike ? { s: 1 } : undefined,
    fs: f.sz, ff: f.name, cl: rgb(f.color), bg: rgb(s.fill), bd: bd && Object.keys(bd).length ? bd : undefined,
    ht: s.align?.h ? H_ALIGN[s.align.h] : undefined, vt: s.align?.v ? V_ALIGN[s.align.v] : undefined, tb: s.align?.wrap ? WRAP : undefined,
    n: s.numFmt ? { pattern: s.numFmt } : undefined,
  });
}

/** Univer 칸 서식 → 서식(저장할 때 바꾼 서식을 Rust 로). base = 기본 글꼴(같으면 글꼴 없음) */
export function fromUniverStyle(u: UStyle | null | undefined, base: SheetFont): SheetStyle {
  if (!u) return {};
  const pick = <T,>(m: Record<string, number>, v: unknown): T | undefined => Object.entries(m).find(([, n]) => n === v)?.[0] as T | undefined;
  const col = (x: unknown) => (x && typeof x === 'object' && 'rgb' in x ? String((x as { rgb: string }).rgb).toUpperCase() : undefined);
  // 표 편집기가 글을 칠 때 얹는 자기 기본 글자색 — 고른 색이 아니라 기본값
  const fontCol = (x: unknown) => { const c = col(x); return c === UNIVER_TEXT ? undefined : c; };
  const on = (x: unknown) => !!x && (typeof x === 'object' ? (x as { s?: number }).s === 1 : x === 1);
  const font: SheetFont = clean({ b: on(u.bl) || undefined, i: on(u.it) || undefined, u: on(u.ul) || undefined, strike: on(u.st) || undefined, sz: (u.fs as number) ?? base.sz, color: fontCol(u.cl) ?? base.color, name: (u.ff as string) ?? base.name });
  // 기본 글꼴과 같나 — 색 없음은 검정으로 본다
  const black = (c?: string) => (c ?? '#000000').toUpperCase();
  const same = !font.b && !font.i && !font.u && !font.strike && font.sz === base.sz && font.name === base.name && black(font.color) === black(base.color);
  const bd = u.bd as Record<string, { s?: number; cl?: unknown } | undefined> | undefined;
  const edge = (e?: { s?: number; cl?: unknown }): Edge | undefined => (e && e.s ? clean({ style: pick<string>(BORDER, e.s) ?? 'thin', color: col(e.cl) }) as unknown as Edge : undefined);
  const border = bd ? clean({ l: edge(bd.l), r: edge(bd.r), t: edge(bd.t), b: edge(bd.b) }) : {};
  const align = clean({ h: pick<string>({ left: 1, center: 2, right: 3, justify: 4, distributed: 6 }, u.ht), v: pick<string>({ top: 1, center: 2, bottom: 3 }, u.vt), wrap: u.tb === WRAP || undefined });
  return clean({
    numFmt: ((u.n as { pattern?: string } | undefined)?.pattern || undefined)?.replace(/^General$/i, '') || undefined,
    font: same ? undefined : font,
    fill: col(u.bg),
    border: Object.keys(border).length ? border : undefined,
    align: Object.keys(align).length ? align : undefined,
  }) as SheetStyle;
}

/** 조건부 서식 규칙 → Univer 규칙(못 그리는 종류는 뺀다 — 파일엔 그대로 남는다) */
export function toUniverCond(c: SheetCond, dxf: SheetStyle[], id: string): Record<string, unknown> | null {
  const ranges = c.sqref.split(/\s+/).map(range).filter((x): x is Range => !!x);
  if (!ranges.length) return null;
  const st = c.dxf != null ? dxf[c.dxf] : undefined;
  const style = clean({ bg: rgb(st?.fill), cl: rgb(st?.font?.color), bl: st?.font?.b ? 1 : undefined, it: st?.font?.i ? 1 : undefined });
  const base = { cfId: id, ranges, stopIfTrue: false };
  if (c.kind === 'expression' && c.formulas[0]) return { ...base, rule: { type: 'highlightCell', subType: 'formula', value: `=${c.formulas[0]}`, style } };
  if (c.kind === 'cellIs' && c.op) {
    const nums = c.formulas.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null; // 칸 참조·수식 비교는 아직 못 그린다
    const two = c.op === 'between' || c.op === 'notBetween';
    return { ...base, rule: { type: 'highlightCell', subType: 'number', operator: c.op, value: two ? [nums[0], nums[1]] : nums[0], style } };
  }
  if (c.kind === 'containsText' && c.text) return { ...base, rule: { type: 'highlightCell', subType: 'text', operator: 'containsText', value: c.text, style } };
  return null;
}

/** 통합 문서 → Univer 통합 문서 데이터. 시트 id 는 s0, s1… (ids[i] → 부품) */
export function toUniver(book: SheetBook, id = 'wb'): { data: Record<string, unknown>; ids: string[] } {
  const styles: Record<string, UStyle> = {};
  book.styles.cell.forEach((s, i) => { const u = toUniverStyle(s); if (Object.keys(u).length) styles[`x${i}`] = u; });
  const base = book.styles.font;
  const sheets: Record<string, unknown> = {};
  const cfs: Record<string, unknown[]> = {};
  const ids = book.sheets.map((_, i) => `s${i}`);
  book.sheets.forEach((s, i) => {
    const cellData: Record<number, Record<number, Record<string, unknown>>> = {};
    let maxR = 0, maxC = 0;
    for (const x of s.cells) {
      const cell: Record<string, unknown> = {};
      if (x.f) cell.f = `=${x.f}`;
      // 수식인데 계산 결과가 없으면 v 를 비워 화면이 계산하게
      if (x.v !== undefined && x.v !== null) {
        cell.v = x.v;
        if (typeof x.v === 'boolean') cell.t = T_BOOLEAN;
        else if (typeof x.v === 'string' && !x.f) cell.t = /^[+-]?\d/.test(x.v) ? T_FORCE_STRING : T_STRING;
      }
      if (x.s && styles[`x${x.s}`]) cell.s = `x${x.s}`;
      if (!Object.keys(cell).length) continue;
      (cellData[x.r] ??= {})[x.c] = cell;
      maxR = Math.max(maxR, x.r); maxC = Math.max(maxC, x.c);
    }
    const columnData: Record<number, Record<string, number>> = {};
    for (const col of s.cols) for (let c = col.min; c <= col.max && c < 16384; c++) {
      columnData[c] = clean({ w: col.width != null ? colPx(col.width) : undefined, hd: col.hidden ? 1 : undefined }) as Record<string, number>;
    }
    const rowData: Record<number, Record<string, number>> = {};
    for (const r of s.rows) rowData[r.r] = clean({ h: r.ht != null ? rowPx(r.ht) : undefined, hd: r.hidden ? 1 : undefined }) as Record<string, number>;
    const sheet: Record<string, unknown> = {
      id: ids[i], name: s.name, hidden: s.hidden ? 1 : 0, cellData, columnData, rowData,
      mergeData: s.merges.map(range).filter(Boolean),
      rowCount: Math.max(maxR + 100, 1000), columnCount: Math.max(maxC + 10, 26),
      defaultColumnWidth: colPx(s.defaultColWidth ?? 8.43), defaultRowHeight: rowPx(s.defaultRowHeight ?? 15),
      defaultStyle: clean({ ff: base.name, fs: base.sz }),
    };
    if (s.freeze && (s.freeze[0] || s.freeze[1])) sheet.freeze = { ySplit: s.freeze[0], xSplit: s.freeze[1], startRow: s.freeze[0], startColumn: s.freeze[1] };
    sheets[ids[i]!] = sheet;
    const rules = s.cond.slice().sort((a, b) => a.priority - b.priority).map((c, k) => toUniverCond(c, book.styles.dxf, `cf${i}_${k}`)).filter(Boolean) as unknown[];
    if (rules.length) cfs[ids[i]!] = rules;
  });
  const resources = Object.keys(cfs).length ? [{ name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data: JSON.stringify(cfs) }] : [];
  return { data: { id, sheetOrder: ids, sheets, styles, resources, locale: 'koKR' }, ids };
}
