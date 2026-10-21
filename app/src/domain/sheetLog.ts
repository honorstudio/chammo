/**
 * 스페이스 엑셀 — 표 화면(Univer)의 변경(mutation) → 저장 조작 목록(Rust write_sheet 의 Op). 화면 라이브러리는 안 불러온다.
 * 칸 고침은 그 순간 칸의 최종 상태를 읽어 남기고(뒤 행 끼우기에 자리가 밀려도 순서대로 맞다), 행·열·시트 조작은 그대로 순서에 끼운다.
 * 저장이 못 따라가는 조작(행 끌어 옮기기·정렬·숨기기·시트 복사)은 blocked 로 — 화면이 '되돌려 줘' 띠를 띄운다
 */
import { cellName, type SheetFont, type SheetStyle, type SheetValue, fromUniverStyle } from './sheetBook';

export interface CellState { v?: SheetValue | null; f?: string | null; style?: SheetStyle }
export type LogEntry =
  | { k: 'cell'; sheet: string; name: string; r: number; c: number; now: CellState; styled: boolean; before?: CellState; calc?: boolean; agent?: boolean }
  | { k: 'op'; op: Record<string, unknown>; name?: string }
  | { k: 'blocked'; what: string };

interface IRangeLike { startRow: number; endRow: number; startColumn: number; endColumn: number }
type Matrix<T> = Record<string | number, Record<string | number, T>>;

/** 화면에서 읽는 것 — 시트 열쇠(불러온 시트 = 부품 경로, 새 시트 = 이름 — 화면이 아니라 renamed 로 기억한 이름이어야
 *  이름 바꾸기 기록이 옛 이름을 가리킨다), 시트 이름, 칸 지금 상태 */
export interface LogCtx {
  key: (sheetId: string) => string;
  name: (sheetId: string) => string;
  cell: (sheetId: string, r: number, c: number) => CellState;
  /** 새로 만든 시트 이름 기억(열쇠가 이름이라) */
  renamed?: (sheetId: string, name: string) => void;
  /** 칸의 수식(= 없이) — 계산 결과를 쓸 때 수식도 같이 */
  formula?: (sheetId: string, r: number, c: number) => string | null;
}

const BLOCKED: Record<string, string> = {
  'sheet.mutation.move-rows': '행 끌어 옮기기', 'sheet.mutation.move-columns': '열 끌어 옮기기', 'sheet.mutation.reorder-range': '정렬',
  'sheet.mutation.set-row-hidden': '행 숨기기', 'sheet.mutation.set-row-visible': '행 숨김 풀기', 'sheet.mutation.set-col-hidden': '열 숨기기',
  'sheet.mutation.set-col-visible': '열 숨김 풀기', 'sheet.mutation.set-worksheet-order': '시트 순서 바꾸기', 'sheet.mutation.set-worksheet-hidden': '시트 숨기기',
  'sheet.mutation.copy-worksheet-end': '시트 복사',
};

const rangeA1 = (g: IRangeLike) => (g.startRow === g.endRow && g.startColumn === g.endColumn ? cellName(g.startRow, g.startColumn) : `${cellName(g.startRow, g.startColumn)}:${cellName(g.endRow, g.endColumn)}`);
const cellsOf = (m?: Matrix<unknown>) => Object.entries(m ?? {}).flatMap(([r, row]) => Object.keys(row ?? {}).map((c) => [Number(r), Number(c)] as const));

/** 변경 하나 → 기록 줄들. before = 그 변경 직전 칸 상태(요약에 '10→12' 를 쓰려고, 없어도 된다) */
export function fromMutation(id: string, p: Record<string, unknown>, ctx: LogCtx, before?: Map<string, CellState>): LogEntry[] {
  if (BLOCKED[id]) return [{ k: 'blocked', what: BLOCKED[id]! }];
  // 행열·시트 조작엔 그때 시트 이름을 붙인다(보낼 것 요약이 '월별합계: 4행 앞에 1행' 으로 쓴다)
  const sheetName = p.subUnitId ? ctx.name(p.subUnitId as string) : undefined;
  return raw(id, p, ctx, before).map((e) => (e.k === 'op' && sheetName ? { ...e, name: sheetName } : e));
}

function raw(id: string, p: Record<string, unknown>, ctx: LogCtx, before?: Map<string, CellState>): LogEntry[] {
  const sid = p.subUnitId as string;
  const key = () => ctx.key(sid);
  const cell = (s: string, r: number, c: number, styled: boolean): LogEntry => ({ k: 'cell', sheet: ctx.key(s), name: ctx.name(s), r, c, now: ctx.cell(s, r, c), styled, before: before?.get(`${s}!${r}!${c}`) });
  const g = p.range as IRangeLike | undefined;
  switch (id) {
    case 'sheet.mutation.set-range-values': {
      const m = p.cellValue as Matrix<Record<string, unknown> | null> | undefined;
      return cellsOf(m).map(([r, c]) => {
        const x = m?.[r]?.[c];
        const e = cell(sid, r, c, x == null || 's' in x) as Extract<LogEntry, { k: 'cell' }>;
        // 글만 쳐도 표가 서식(s)을 같이 실어 보낸다 — 직전 서식을 알면 실제로 바뀐 때만 서식 바뀜
        if (e.styled && e.before && JSON.stringify(e.before.style ?? {}) === JSON.stringify(e.now.style ?? {})) e.styled = false;
        return e;
      });
    }
    case 'sheet.mutation.move-range': {
      const from = p.from as { subUnitId: string; value: Matrix<unknown> }, to = p.to as { subUnitId: string; value: Matrix<unknown> };
      return [...cellsOf(from.value).map(([r, c]) => cell(from.subUnitId, r, c, true)), ...cellsOf(to.value).map(([r, c]) => cell(to.subUnitId, r, c, true))];
    }
    case 'sheet.mutation.insert-row': return g ? [{ k: 'op', op: { op: 'insertRows', part: key(), at: g.startRow, n: g.endRow - g.startRow + 1 } }] : [];
    case 'sheet.mutation.remove-rows': return g ? [{ k: 'op', op: { op: 'deleteRows', part: key(), at: g.startRow, n: g.endRow - g.startRow + 1 } }] : [];
    case 'sheet.mutation.insert-col': return g ? [{ k: 'op', op: { op: 'insertCols', part: key(), at: g.startColumn, n: g.endColumn - g.startColumn + 1 } }] : [];
    case 'sheet.mutation.remove-col': return g ? [{ k: 'op', op: { op: 'deleteCols', part: key(), at: g.startColumn, n: g.endColumn - g.startColumn + 1 } }] : [];
    case 'sheet.mutation.insert-sheet': {
      const sh = p.sheet as { id: string; name: string; cellData?: Matrix<unknown> };
      if (cellsOf(sh.cellData).length) return [{ k: 'blocked', what: '내용 있는 시트 만들기' }];
      ctx.renamed?.(sh.id, sh.name);
      return [{ k: 'op', op: { op: 'addSheet', name: sh.name } }];
    }
    case 'sheet.mutation.remove-sheet': return [{ k: 'op', op: { op: 'deleteSheet', part: key() } }];
    case 'sheet.mutation.set-worksheet-name': {
      const op = { op: 'renameSheet', part: key(), name: p.name as string };
      ctx.renamed?.(sid, p.name as string);
      return [{ k: 'op', op }];
    }
    case 'sheet.mutation.add-worksheet-merge':
    case 'sheet.mutation.remove-worksheet-merge':
      return ((p.ranges as IRangeLike[]) ?? []).map((x) => ({ k: 'op', op: { op: id.includes('add') ? 'merge' : 'unmerge', part: key(), range: rangeA1(x) } }));
    case 'sheet.mutation.set-worksheet-col-width':
    case 'sheet.mutation.set-worksheet-row-height': {
      const col = id.includes('col');
      const size = (col ? p.colWidth : p.rowHeight) as number | Record<string, number | null>;
      const out: LogEntry[] = [];
      for (const x of (p.ranges as IRangeLike[]) ?? []) {
        const [a, b] = col ? [x.startColumn, x.endColumn] : [x.startRow, x.endRow];
        for (let i = a; i <= b; i++) {
          const px = typeof size === 'number' ? size : size?.[i - a] ?? size?.[i];
          if (px == null) continue;
          out.push({ k: 'op', op: col ? { op: 'colWidth', part: key(), at: i, n: 1, width: Math.max(0, Math.round(((px - 5) / 7) * 100) / 100) } : { op: 'rowHeight', part: key(), at: i, n: 1, height: Math.round(((px * 72) / 96) * 100) / 100 } });
        }
      }
      return out;
    }
    default: return [];
  }
}

/** 같은 값인가 — 파일엔 15자리까지만 적혀 있어(3944666.66666667) 계산 결과(…6665)와 끝자리만 다른 건 같다고 본다 */
const same = (a: unknown, b: unknown) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

/**
 * 수식 엔진 계산 결과(formula.mutation.set-formula-calculation-result) → 다시 계산된 수식 칸 기록.
 * known = 칸마다 마지막으로 아는 값(처음엔 파일의 계산 결과) — 같으면 안 남긴다(열 때 도는 첫 계산이 저장을 일으키지 않게)
 */
export function fromCalc(p: Record<string, unknown>, ctx: LogCtx, known: Map<string, unknown>): LogEntry[] {
  const out: LogEntry[] = [];
  for (const unit of Object.values((p.unitData ?? {}) as Record<string, Record<string, Matrix<{ v?: unknown } | null>> | null>)) {
    for (const [sid, m] of Object.entries(unit ?? {})) {
      for (const [r, c] of cellsOf(m)) {
        const v = m[r]?.[c]?.v ?? null;
        const k = `${sid}!${r}!${c}`;
        if (known.has(k) && same(known.get(k), v)) continue;
        known.set(k, v);
        out.push({ k: 'cell', sheet: ctx.key(sid), name: ctx.name(sid), r, c, now: { v: v as SheetValue | null, f: ctx.formula?.(sid, r, c) ?? null }, styled: false, calc: true });
      }
    }
  }
  return out;
}

/** 칸의 Univer 데이터 → 칸 상태(저장용). styleOf = 통합 문서 서식표에서 id 로 찾기(s 가 id 일 때) */
export function cellState(d: Record<string, unknown> | null | undefined, styleOf: (id: string) => unknown, base: SheetFont): CellState {
  if (!d) return { v: null, f: null };
  const f = typeof d.f === 'string' && d.f.startsWith('=') ? d.f.slice(1) : null;
  let v = d.v as SheetValue | null | undefined;
  if (d.t === 3 && typeof v === 'number') v = v === 1;
  const s = typeof d.s === 'string' ? styleOf(d.s) : d.s;
  return { v: v ?? null, f, style: fromUniverStyle(s as Record<string, unknown> | null, base) };
}

/** 기록 → 저장 조작 목록. 행열 조작 사이에서 같은 칸을 여러 번 고쳤으면 마지막 것만 */
export function compile(log: LogEntry[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let run = new Map<string, Extract<LogEntry, { k: 'cell' }>>();
  const flush = () => {
    for (const e of run.values()) {
      const op: Record<string, unknown> = { op: 'cell', part: e.sheet, r: e.r, c: e.c, v: e.now.v ?? null, f: e.now.f ?? null };
      if (e.styled) op.style = e.now.style ?? {};
      out.push(op);
    }
    run = new Map();
  };
  for (const e of log) {
    if (e.k === 'blocked') continue;
    if (e.k === 'op') { flush(); out.push(e.op); continue; }
    const id = `${e.sheet}!${e.r}!${e.c}`;
    const prev = run.get(id);
    run.delete(id); // 순서는 마지막 고친 때로
    run.set(id, { ...e, styled: e.styled || !!prev?.styled, before: prev?.before ?? e.before });
  }
  flush();
  return out;
}

export const blockedOf = (log: LogEntry[]) => [...new Set(log.filter((e) => e.k === 'blocked').map((e) => (e as { what: string }).what))];

/** 지금 저장을 시작하면 안 되나 — 충돌·막힘·없어짐이거나 고친 게 없거나, 앞 저장이 아직 도는 중.
 *  도는 중에 또 보내면 같은 옛 expected 로 두 쓰기가 같이 돌아 앞 고침이 파일에서 빠졌다(2026-10-21 리뷰) — 끝나면 남은 기록으로 다시 건다 */
export const saveHeld = (state: string, logLen: number) => state === 'conflict' || state === 'blocked' || state === 'gone' || state === 'saving' || !logLen;
/** 닫을 때 안 쓴 고침이 그대로 버려지나 — 충돌·막힘·없어짐이면 save 가 안 돌아 기록 없이 사라졌다(md 문서는 history 에 내 판을 남기는데).
 *  그럴 땐 닫으면서 고친 칸 기록을 history 에 남긴다(2026-10-21 리뷰 ⑦-7). 저장 중이면 그 저장이 마저 쓴다 */
export const strandedOnClose = (state: string, logLen: number) => logLen > 0 && (state === 'conflict' || state === 'blocked' || state === 'gone' || state === 'error');

/** 바깥 판 위에 다시 얹을 고침 — 표가 스스로 한 것(수식 다시 계산·참조 밀기, calc)은 빼고 사람 고침과 참모 칸 쓰기(agent)는 남긴다.
 *  참모 쓰기도 calc 로만 표시해서 바깥 변경과 겹치면 합치기에서 빠져 파일에도 표에도 없었다(2026-10-21 리뷰 ⑦-11) */
export const keptOnMerge = (log: LogEntry[]) => log.filter((e) => !(e.k === 'cell' && e.calc && !e.agent));
