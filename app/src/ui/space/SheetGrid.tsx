// 스페이스 엑셀 표 — Univer(오픈소스 판, ADR 0004). 엑셀을 열 때만 불러온다(SheetPage 가 lazy 로).
// 고친 것은 변경(mutation)마다 기록해 두었다가 1초 모아 Rust(write_sheet)로 — 원본 xlsx 에서 그 칸만 바뀐다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsKo from '@univerjs/preset-sheets-core/locales/ko-KR';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import cfKo from '@univerjs/preset-sheets-conditional-formatting/locales/ko-KR';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import { toUniver, type SheetBook } from '../../domain/sheetBook';
import { blockedOf, cellState, compile, fromCalc, fromMutation, type CellState, type LogCtx, type LogEntry } from '../../domain/sheetLog';
import { conflicts } from '../../domain/sheetPending';
import { cellChanges, plan, skipOf, typed, type Put } from '../../domain/sheetPlay';
import { onSheetPlay } from './sheetPlayBus';
import { OrchAvatar } from '../avatar/OrchAvatar';

export type SheetStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'gone' | 'blocked' | 'error';
/** 다시 열 때 이어 볼 자리 — 시트 순서·고른 칸 */
export interface SheetView { sheet: number; cell?: string }
/** 칸 쓰기를 보여 줄 참모 — 이름(프사 찾기)·색 */
export interface SheetWho { name: string; color: string }
interface Box { x: number; y: number; w: number; h: number }
interface Cursor extends Box { text: string; who: SheetWho | null; on: boolean; ms: number }
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
/** 페이지가 표에 시키는 것 — 충돌 띠의 '내 판으로 저장' */
export interface SheetControl { keepMine: () => Promise<void> }

/** 내가 한 고침만(표가 스스로 한 칸 쓰기·수식 다시 계산 결과는 뺀다) */
const mineOnly = (log: LogEntry[]) => log.filter((e) => !(e.k === 'cell' && e.calc));

/** 밖에서 고쳤나 보는 주기 — md 문서(docSync)와 같다 */
const WATCH_MS = 1500;

/** 저장 모아 두는 시간 — 칸마다 쓰지 않는다(md 키마다 저장해서 느려졌던 것, 2026-10-11) */
const SAVE_AFTER = 1000;

export default function SheetGrid({ path, book, stamp, onStatus, onSaved, onReload, start, control, whoOf }: {
  path: string;
  book: SheetBook;
  stamp: string;
  onStatus: (s: SheetStatus, detail?: string) => void;
  /** 저장한 조작(⑤ 보낼 것 요약이 쓴다) */
  onSaved?: (log: LogEntry[]) => void;
  /** 밖에서 고친 판을 다시 읽어 달라 — 보던 자리(view)를 이어서 */
  onReload: (view: SheetView) => void;
  start?: SheetView;
  control?: { current: SheetControl | null };
  /** scripts/sheet 의 by(세션 id) → 그 참모(프사·색). 모르면 null(중립) */
  whoOf?: (by: string) => SheetWho | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  // 참모가 칸을 쓰는 걸 보여 주는 커서(프사 + 테두리 + 타자)
  const [cursor, setCursor] = useState<Cursor | null>(null);
  // 밖이 바꾼 칸 — 잠깐 반짝(누가 고쳤는지 몰라 중립 색)
  const [flashes, setFlashes] = useState<Box[]>([]);
  const whoRef = useRef(whoOf);
  whoRef.current = whoOf;
  useEffect(() => {
    if (!el.current) return;
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.KO_KR,
      locales: { [LocaleType.KO_KR]: mergeLocales(sheetsKo, cfKo) },
      darkMode: dark,
      presets: [UniverSheetsCorePreset({ container: el.current }), UniverSheetsConditionalFormattingPreset()],
    });
    const { data, ids } = toUniver(book);
    const fwb = univerAPI.createWorkbook(data as never);
    const wb = fwb.getWorkbook();
    // 다시 연 거면 보던 시트·칸으로
    if (start?.sheet) { const sh = fwb.getSheets()[start.sheet]; if (sh) fwb.setActiveSheet(sh); }
    if (start?.cell) { try { fwb.getActiveSheet().getRange(start.cell).activate(); } catch { /* 칸이 없어졌으면 처음 자리 */ } }
    // 시트 열쇠 — 불러온 시트는 부품 경로(이름이 바뀌어도 그대로), 새로 만든 시트는 기록상 이름
    const parts = new Map(ids.map((id, i) => [id, book.sheets[i]!.part]));
    const names = new Map(ids.map((id, i) => [id, book.sheets[i]!.name]));
    const styleOf = (id: string) => wb.getStyles().get(id) as unknown;
    const read = (sid: string, r: number, c: number): CellState => {
      // 칸 원래 데이터(getCell 은 숫자 서식을 입힌 '보이는 글'을 줘서 숫자가 글로 저장될 뻔했다). 수식 칸 계산 결과는 fromCalc 가 따로
      const raw = wb.getSheetBySheetId(sid)?.getCellRaw(r, c) as Record<string, unknown> | null | undefined;
      return cellState(raw, styleOf, book.styles.font);
    };
    const ctx: LogCtx = {
      key: (sid) => parts.get(sid) ?? names.get(sid) ?? wb.getSheetBySheetId(sid)?.getName() ?? sid,
      name: (sid) => wb.getSheetBySheetId(sid)?.getName() ?? names.get(sid) ?? sid,
      cell: read,
      renamed: (sid, n) => { names.set(sid, n); },
      formula: (sid, r, c) => { const f = wb.getSheetBySheetId(sid)?.getCellRaw(r, c)?.f; return typeof f === 'string' ? f.replace(/^=/, '') : null; },
    };
    // 수식 칸마다 마지막으로 아는 값 — 처음엔 파일의 계산 결과(열 때 도는 첫 계산은 저장 안 함)
    const known = new Map<string, unknown>();
    book.sheets.forEach((s, i) => { for (const x of s.cells) if (x.f) known.set(`${ids[i]}!${x.r}!${x.c}`, x.v ?? null); });
    let log: LogEntry[] = [];
    let cur = stamp;
    let timer = 0;
    let recalc = 0;
    let state: SheetStatus = 'saved';
    const set = (s: SheetStatus, d?: string) => { state = s; onStatus(s, d); };
    const before = new Map<string, CellState>();
    const save = async () => {
      timer = 0;
      if (state === 'conflict' || state === 'blocked' || state === 'gone' || !log.length) return;
      const sent = log;
      const ops = compile(sent);
      log = [];
      if (!ops.length) return; // 막힌 조작만 있던 기록 — 쓸 게 없다
      set('saving');
      try {
        cur = await invoke<string>('write_sheet', { path, ops, expected: cur });
        onSaved?.(sent);
        set(log.length ? 'dirty' : 'saved');
        if (log.length && !timer) timer = window.setTimeout(save, SAVE_AFTER);
      } catch (e) {
        log = [...sent, ...log]; // 못 쓴 건 다음에 다시
        const msg = String(e);
        if (msg.includes('CHANGED_OUTSIDE')) void outside(); else set('error', msg);
      }
    };
    const view = (): SheetView => {
      const sh = fwb.getActiveSheet();
      let cell: string | undefined;
      try { cell = sh.getSelection()?.getActiveRange()?.getA1Notation(); } catch { /* 고른 칸 없음 */ }
      return { sheet: Math.max(0, fwb.getSheets().findIndex((x) => x.getSheetId() === sh.getSheetId())), cell };
    };
    let closed = false;
    let merging = false;
    let agent = false; // 참모 칸 쓰기 재생 중 — 그 칸 쓰기는 '사용자가 고친 것'이 아니다
    let applying = false; // 밖이 바꾼 칸을 표에 얹는 중 — 파일에 이미 있는 값이라 기록·저장 안 함

    /** 칸의 화면 자리(표 칸 기준) — getCellRect 는 스크롤과 무관한 시트 좌표라 고정 틀·스크롤 자리를 뺀다 */
    const cellBox = (sh: ReturnType<typeof fwb.getActiveSheet>, r: number, c: number): Box | null => {
      const host = el.current;
      const canvas = [...(host?.querySelectorAll('canvas') ?? [])].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!host || !canvas) return null;
      const rect = (rr: number, cc: number) => sh.getRange(rr, cc).getCellRect();
      const fz = sh.getFreeze();
      const st = fwb.getScrollStateBySheetId(sh.getSheetId()) ?? { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 };
      const me = rect(r, c);
      // 스크롤 시작 칸 번호는 고정 틀을 뺀 상대 번호다(고정 1행이면 20행으로 스크롤해 19, 하네스 실측)
      const sc = st.sheetViewStartColumn + fz.xSplit, sr = st.sheetViewStartRow + fz.ySplit;
      const x = c < fz.xSplit ? me.left : me.left - rect(0, sc).left + rect(0, fz.xSplit).left - (st.offsetX ?? 0);
      const y = r < fz.ySplit ? me.top : me.top - rect(sr, 0).top + rect(fz.ySplit, 0).top - (st.offsetY ?? 0);
      const hb = host.getBoundingClientRect(), cb = canvas.getBoundingClientRect();
      return { x: cb.left - hb.left + x, y: cb.top - hb.top + y, w: me.width, h: me.height };
    };
    /** 칸이 화면 밖이면 그 칸이 보이게 스크롤 */
    const reveal = async (sh: ReturnType<typeof fwb.getActiveSheet>, r: number, c: number) => {
      const b = cellBox(sh, r, c);
      const host = el.current?.getBoundingClientRect();
      if (!b || !host || (b.x >= 40 && b.y >= 20 && b.x + b.w <= host.width - 10 && b.y + b.h <= host.height - 40)) return;
      // 스크롤하는 동안 앞 칸 커서가 엉뚱한 자리에 남지 않게 잠깐 숨긴다
      setCursor((cu) => (cu ? { ...cu, text: '', on: false, ms: 100 } : cu));
      const fz = sh.getFreeze();
      sh.scrollToCell(Math.max(fz.ySplit, r - 3), Math.max(fz.xSplit, c - 2));
      await sleep(180);
    };
    let playing: Promise<void> = Promise.resolve();
    /** 참모 칸 쓰기(scripts/sheet set) — 칸마다 프사 커서가 가서 테두리·타자, 다 넣으면 저장하고 답한다. 사용자가 안 저장한 칸·편집 중인 칸은 건너뛴다 */
    const play = (pl: { id: string; puts: Put[]; by?: string }) => {
      playing = playing.then(async () => {
        const reply = (a: Record<string, unknown>) => invoke('sheet_play_done', { id: pl.id, answerJson: JSON.stringify(a) }).catch(() => {});
        if (state === 'conflict' || state === 'blocked' || state === 'gone') { await reply({ ok: false, error: '사용자 화면에서 이 표가 충돌·막힘 띠를 띄운 상태라 지금은 못 써' }); return; }
        const hidden = document.hidden;
        const sheets = fwb.getSheets();
        const sheetOf = (p: Put) => (p.sheet ? fwb.getSheetByName(p.sheet) : sheets[0]) ?? null;
        const steps = plan(pl.puts, sheets[0]!.getSheetName(), hidden);
        const keyOf = (p: Put) => { const sh = sheetOf(p); return sh ? `${ctx.key(sh.getSheetId())}!${p.r}!${p.c}` : ''; };
        const mine = new Set(log.filter((e) => e.k === 'cell' && !e.calc).map((e) => (e.k === 'cell' ? `${e.sheet}!${e.r}!${e.c}` : '')));
        let editing: string | null = null;
        if (fwb.isCellEditing()) {
          const a = fwb.getActiveSheet();
          const g = a.getSelection()?.getActiveRange();
          if (g) editing = `${ctx.key(a.getSheetId())}!${g.getRow()}!${g.getColumn()}`;
        }
        const skip = skipOf(steps, keyOf, mine, editing);
        const who = pl.by ? whoRef.current?.(pl.by) ?? null : null;
        const missing: string[] = [];
        let written = 0;
        agent = true;
        try {
          for (const s of steps) {
            if (closed) break;
            if (skip.has(s.label)) continue;
            const sh = sheetOf(s.put);
            if (!sh) { missing.push(s.label); continue; }
            if (!hidden) {
              if (fwb.getActiveSheet().getSheetId() !== sh.getSheetId()) { fwb.setActiveSheet(sh); await sleep(150); }
              await reveal(sh, s.put.r, s.put.c);
              const b = cellBox(sh, s.put.r, s.put.c);
              if (b) {
                setCursor({ ...b, text: '', who, on: true, ms: s.move });
                await sleep(s.move);
                const n = Math.max(1, Math.min([...s.text].length, Math.round(s.type / 40)));
                for (let i = 1; i <= n; i++) { setCursor((cu) => (cu ? { ...cu, text: typed(s.text, i / n), ms: 0 } : cu)); await sleep(s.type / n); }
              }
            }
            const range = sh.getRange(s.put.r, s.put.c);
            if (s.put.f) range.setFormula(`=${s.put.f}`);
            else if (s.put.v == null || s.put.v === '') range.clearContent();
            else range.setValue(s.put.v);
            written++;
            if (!hidden) await sleep(s.hold);
          }
        } finally {
          agent = false;
          setCursor((cu) => (cu ? { ...cu, on: false, ms: 300 } : cu));
        }
        // 다 넣었으면 바로 저장(1초 모으기 없이) — 저장까지 끝나야 '했다'고 답한다
        window.clearTimeout(timer); timer = 0;
        if (log.length) await save();
        const ok = (state as SheetStatus) === 'saved' || (state as SheetStatus) === 'dirty';
        await reply({ ok, written, shown: !hidden, skipped: [...skip], missing, ...(ok ? {} : { error: `저장 못 했어(${state})` }) });
        window.setTimeout(() => setCursor(null), 400);
      });
    };
    // 받자마자 '받았어'(sheet_play_ack) — 안 하면 Rust 가 3초 뒤 파일에 바로 써 버린다
    const unlisten = onSheetPlay(path, (p) => { void invoke('sheet_play_ack', { id: p.id }).catch(() => {}); play(p); });
    void invoke('sheet_open', { path, on: true }).catch(() => {});
    /** 밖(참모·세션)이 파일을 고쳤다 — 안 쓴 내 고침이 없으면 그대로 다시 읽고, 있으면 바깥 판 위에 내 칸만 얹는다.
     *  내가 고친 칸을 밖에서도 고쳤으면 충돌 띠(사용자 것도 바깥 것도 덮지 않는다 — 고르는 건 사용자) */
    const outside = async () => {
      if (merging || closed) return;
      merging = true;
      try {
        if (!log.length && state !== 'blocked') {
          // 안 고친 채 — 통째로 다시 그리지 말고 바뀐 칸만 얹는다(깜빡임 없이). 시트 구성이 바뀌었거나 너무 많으면 그때만 다시 읽기
          const next = await invoke<{ book: SheetBook; stamp: string }>('read_sheet_book', { path });
          const sheets = fwb.getSheets();
          const model = new Map<string, { v?: unknown; f?: string | null }>();
          sheets.forEach((sh, i) => sh.getSheet().getCellMatrix().forValue((r, c, x) => {
            if (x && (x.v != null || x.f)) model.set(`${i}!${r}!${c}`, { v: x.v, f: typeof x.f === 'string' ? x.f.replace(/^=/, '') : null });
          }));
          const d = cellChanges(model, sheets.map((sh) => sh.getSheetName()), next.book);
          if (d.whole) { onReload(view()); return; }
          applying = true;
          try {
            for (const ch of d.changes) {
              const range = sheets[ch.sheet]!.getRange(ch.r, ch.c);
              if (ch.f) range.setFormula(`=${ch.f}`); else if (ch.v == null) range.clearContent(); else range.setValue(ch.v);
            }
          } finally { applying = false; }
          cur = next.stamp;
          // 파일의 계산 결과를 아는 값으로 — 표가 다시 계산해 같으면 저장 안 함, 다르면(밖이 계산을 안 했으면) 맞는 값을 쓴다
          next.book.sheets.forEach((sh, i) => { const sid = sheets[i]?.getSheetId(); if (sid) for (const x of sh.cells) if (x.f) known.set(`${sid}!${x.r}!${x.c}`, x.v ?? null); });
          if (!document.hidden) {
            const act = fwb.getActiveSheet();
            const ai = sheets.findIndex((sh) => sh.getSheetId() === act.getSheetId());
            const boxes = d.changes.filter((ch) => ch.sheet === ai).slice(0, 40).map((ch) => cellBox(act, ch.r, ch.c)).filter((b): b is Box => !!b);
            setFlashes(boxes);
            window.setTimeout(() => setFlashes([]), 1500);
          }
          return;
        }
        window.clearTimeout(timer); timer = 0;
        const next = await invoke<{ book: SheetBook; stamp: string }>('read_sheet_book', { path });
        const clash = state === 'blocked' ? ['저장 못 하는 조작'] : conflicts(log, next.book);
        if (clash.length) { set('conflict', clash.slice(0, 5).join(', ') + (clash.length > 5 ? ` 외 ${clash.length - 5}칸` : '')); return; }
        const sent = log;
        log = [];
        // 바깥 판 위엔 내가 고친 것만 — 수식 다시 계산 결과는 다시 읽은 뒤 표가 새로 계산해 저장한다(밖이 고친 수식을 덮지 않게)
        const ops = compile(mineOnly(sent));
        if (ops.length) { cur = await invoke<string>('write_sheet', { path, ops, expected: next.stamp }); onSaved?.(sent); }
        onReload(view());
      } catch (e) {
        set('error', String(e));
      } finally {
        merging = false;
      }
    };
    if (control) control.current = {
      // 충돌에서 '내 판으로 저장' — 지금 파일 위에 내 고침을 쓴다(덮이는 바깥 판은 저장 전 history 에 남는다)
      keepMine: async () => {
        const now = await invoke<string>('doc_stamp', { path });
        const sent = log;
        log = [];
        try {
          const ops = compile(mineOnly(sent));
          if (ops.length) { cur = await invoke<string>('write_sheet', { path, ops, expected: now }); onSaved?.(sent); }
          onReload(view());
        } catch (e) { log = [...sent, ...log]; set('error', String(e)); }
      },
    };
    const watch = async () => {
      if (closed || document.hidden || state === 'saving' || state === 'conflict' || merging) return;
      try {
        const now = await invoke<string>('doc_stamp', { path });
        if (now !== cur && (state as SheetStatus) !== 'saving') void outside(); // 기다리는 새 저장이 시작됐을 수 있다
      } catch {
        set('gone');
      }
    };
    const watchTimer = window.setInterval(() => void watch(), WATCH_MS);
    const onFocus = () => void watch();
    window.addEventListener('focus', onFocus);
    const offBefore = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (ev) => {
      if (ev.id !== 'sheet.mutation.set-range-values') return;
      const p = ev.params as { subUnitId: string; cellValue?: Record<number, Record<number, unknown>> };
      for (const [r, row] of Object.entries(p.cellValue ?? {})) for (const c of Object.keys(row ?? {})) {
        const k = `${p.subUnitId}!${r}!${c}`;
        if (!before.has(k)) before.set(k, read(p.subUnitId, Number(r), Number(c)));
      }
    });
    const offAfter = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (ev) => {
      const p = (ev.params ?? {}) as Record<string, unknown>;
      const calc = ev.id === 'formula.mutation.set-formula-calculation-result';
      if (applying && !calc) return; // 밖이 바꾼 칸을 얹는 중 — 파일에 이미 있는 값
      const opts = ev.options as { fromCollab?: boolean; fromFormula?: boolean; applyFormulaCalculationResult?: boolean } | undefined;
      // 수식 결과를 칸에 얹는 쓰기는 건너뛴다 — 다시 계산한 칸 전부(값이 같은 칸까지)가 와서, 바뀐 칸만 남기는 fromCalc 가 맡는다
      if ((!calc && !ev.id.startsWith('sheet.mutation.')) || opts?.fromCollab || opts?.applyFormulaCalculationResult) return;
      // 표가 스스로 하는 칸 쓰기 — 수식 글 고쳐 쓰기(행 끼운 뒤 참조 밀기·덮인 수식 지우기)와 새 행·열에 서식 옮겨 붙이기.
      // 저장엔 넣되 '사용자가 고친 것'에선 뺀다(calc). 직전 값(before)도 지우지 않는다 — 바로 뒤 사용자의 칸 쓰기가 쓴다
      const quiet = !calc && (agent || opts?.fromFormula || /insert-(row|col)|remove-(row|col)/.test(String(p.trigger ?? '')));
      const got = calc ? fromCalc(p, ctx, known) : fromMutation(ev.id, p, ctx, before);
      const add = quiet ? got.map((e) => (e.k === 'cell' ? { ...e, calc: true } : e)) : got;
      if (!add.length) return;
      if (!calc && !quiet) before.clear();
      log.push(...add);
      if (add.some((e) => e.k === 'op')) {
        known.clear(); // 자리가 바뀌었으니 그 뒤 계산 결과는 다 남긴다
        // Univer 1.0.3 은 행을 끼운 뒤 다른 시트를 보는 수식(SUMIFS)에 기댄 합계를 틀리게 다시 계산한다(SUM 이 그 칸을 빼먹음,
        // 하네스 실측) — 전체를 다시 계산시키면 맞는다. 그 결과가 fromCalc 로 들어와 저장된다
        window.clearTimeout(recalc);
        recalc = window.setTimeout(() => univerAPI.getFormula().executeCalculation(), 50);
      }
      const blocked = blockedOf(add);
      if (blocked.length) { set('blocked', blocked.join(', ')); return; }
      if (state === 'saved') set('dirty');
      if (state === 'conflict') return; // 충돌을 고를 때까지 저장 안 함(고친 건 모아 둔다)
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_AFTER);
    });
    (window as unknown as { __sheet?: unknown }).__sheet = { univerAPI, fwb, save: () => save(), log: () => log, play };
    return () => {
      closed = true;
      unlisten();
      void invoke('sheet_open', { path, on: false }).catch(() => {});
      offBefore.dispose(); offAfter.dispose();
      window.clearInterval(watchTimer);
      window.removeEventListener('focus', onFocus);
      if (control) control.current = null;
      window.clearTimeout(recalc);
      // 남은 고침은 지금 보낸다 — save 는 await 앞에서 칸을 다 읽으니 바로 치워도 된다
      if (timer) { window.clearTimeout(timer); void save(); }
      delete (window as unknown as { __sheet?: unknown }).__sheet;
      // 바로 치운다(늦게 치우면 StrictMode 가 다시 띄운 표까지 지워 흰 화면이 됐다)
      univer.dispose();
    };
  }, [path, book]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sheet-grid" ref={el}>
      {flashes.map((b, i) => <div key={i} className="sheet-flash" aria-hidden style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />)}
      {cursor && (
        <div className={`sheet-cursor ${cursor.on ? 'on' : ''}`} aria-hidden
          style={{ left: cursor.x, top: cursor.y, width: cursor.w, height: cursor.h, transitionDuration: `${cursor.ms}ms`, ['--who' as string]: cursor.who?.color ?? 'var(--text-3)' }}>
          {cursor.text && <span className="sheet-cursor-text">{cursor.text}</span>}
          {cursor.who && <span className="sheet-cursor-who"><OrchAvatar name={cursor.who.name} size={22} state="work" color={cursor.who.color} /></span>}
        </div>
      )}
    </div>
  );
}
