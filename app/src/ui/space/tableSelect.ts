import type { BlockNoteEditor } from '@blocknote/core';

// 표 칸 고르기를 노션처럼(2026-11-09 사용자 "칸 안 글 복사가 표 밖에 안 붙는다·끌기 선택이 애매").
// 표 끌기(prosemirror-tables)는 칸 밖으로 한 번 나갔다 돌아오거나 세 번 클릭하면 '칸 하나짜리 칸 선택'을 만든다 —
// 그걸 복사하면 클립보드에 <table> 이 들어가 문단에 붙이면 1칸짜리 표가 생기고 문단이 쪼개졌다.
// 칸 안이면 글 선택, 칸을 둘 이상 걸치면 칸 선택(파란 칸) — 칸 선택 모양은 editorTone.css
type PMNode = BlockNoteEditor['prosemirrorState']['doc'];
type Pos = ReturnType<PMNode['resolve']>;
type Range = { from: number; to: number };
const CELL = new Set(['tableCell', 'tableHeader']);

/** 그 자리가 든 표 칸의 글 범위(첫 문단 글 처음 ~ 마지막 문단 글 끝). 표 밖이면 null */
export function cellRangeAt(doc: PMNode, pos: number): Range | null {
  const $p = doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    if (CELL.has($p.node(d).type.name)) return { from: $p.start(d) + 1, to: $p.end(d) - 1 };
  }
  return null;
}

/** 칸 하나만 고른 칸 선택(CellSelection)이면 그 칸 글 범위 — 빈 칸·여러 칸·글 선택이면 null.
 * prosemirror-tables 를 직접 들이지 않으려고 모양($anchorCell·$headCell)으로 본다 */
export function oneCellRange(doc: PMNode, sel: object): Range | null {
  const { $anchorCell: a, $headCell: h } = sel as { $anchorCell?: Pos; $headCell?: Pos };
  if (!a || !h || a.pos !== h.pos) return null;
  const r = cellRangeAt(doc, a.pos + 1);
  return r && r.from < r.to ? r : null;
}

/** 칸 선택(한 칸이든 여러 칸이든)인가 */
export const isCellPick = (sel: object) => '$anchorCell' in sel;

/**
 * 편집기 상자에 표 칸 고르기를 단다 — 세 번 클릭 = 그 칸 글 전체(글 선택), 칸 밖으로 끌었다 처음 칸으로 돌아오면 다시 글 선택.
 * 표 끌기는 문서(view.root)에서 mousemove 를 듣는다 — 그 뒤(창 거품 단계)에 고쳐서 같은 사건 안에서 끝난다(그리기 전)
 */
export function installTableSelect(root: HTMLElement, editor: BlockNoteEditor): () => void {
  const tip = editor._tiptapEditor;
  const at = (x: number, y: number) => tip.view.posAtCoords({ left: x, top: y })?.pos ?? null;
  const cellOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('td, th') : null);
  let start: { cell: Element; anchor: number } | null = null;
  const move = (e: MouseEvent) => {
    if (!start || !e.buttons) return;
    const { doc, selection } = tip.state;
    const r = oneCellRange(doc, selection);
    if (!r || cellOf(e.target) !== start.cell) return;
    const head = at(e.clientX, e.clientY);
    if (head == null) return;
    const clamp = (p: number) => Math.min(Math.max(p, r.from), r.to);
    tip.commands.setTextSelection({ from: clamp(start.anchor), to: clamp(head) });
  };
  const up = () => { start = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up, true); };
  const down = (e: MouseEvent) => {
    const cell = cellOf(e.target);
    if (e.button !== 0 || !cell || !tip.view.dom.contains(cell)) return;
    if (e.detail >= 3) {
      // 표 기본은 칸 통째(칸 선택) — 노션처럼 칸 글 전체를 글로 고른다. 빈 칸은 기본 그대로.
      // 네 번째부터도 — 편집기는 세 번째를 못 봐서 네 번째를 세 번 클릭으로 센다
      const p = at(e.clientX, e.clientY);
      const r = p == null ? null : cellRangeAt(tip.state.doc, p);
      if (!r || r.from >= r.to) return;
      e.preventDefault(); e.stopPropagation();
      tip.commands.setTextSelection(r);
      return;
    }
    if (e.detail !== 1 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const anchor = at(e.clientX, e.clientY);
    if (anchor == null) return;
    up();
    start = { cell, anchor };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);
  };
  root.addEventListener('mousedown', down, true);
  return () => { up(); root.removeEventListener('mousedown', down, true); };
}
