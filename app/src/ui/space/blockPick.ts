import type { BlockNoteEditor } from '@blocknote/core';

// 노션식 블록 고르기(2026-11-09 사용자) — Esc·손잡이 누르기 = 지금 블록 통째로, ↑↓ = 옆 블록으로, Shift+↑↓ = 늘리기,
// Backspace·Delete = 지우기, Enter·Esc = 다시 글 편집, 손잡이 끌기 = 고른 블록 전부 옮기기(blockDrag).
// 편집기 선택은 고른 블록들의 글 전체를 덮어 둔다 — 그래서 ⌘C·⌘X(BlockNote 블록 복사·우리 사람 글)·⌘D 복제가 그대로 돈다.
// 고른 블록은 파란 면(표 칸 선택과 같은 파랑 — 칸·블록 단위는 파랑, 글 단위는 회색), 그동안 글 선택색·커서는 숨긴다(editorTone.css)
type PMNode = BlockNoteEditor['prosemirrorState']['doc'];
type Range = { from: number; to: number };

/** 기준 블록 ~ 끝 블록(같은 줄 형제 안, 문서 순서) */
export function spanIds(ids: string[], anchor: string, head: string): string[] {
  const a = ids.indexOf(anchor);
  if (a < 0) return [];
  const h = ids.indexOf(head);
  return h < 0 ? [anchor] : ids.slice(Math.min(a, h), Math.max(a, h) + 1);
}

/** 위(-1)·아래(1) 옆 블록 — 끝에서는 그대로 */
export const moveHead = (ids: string[], head: string, d: 1 | -1) => ids[Math.min(Math.max(ids.indexOf(head) + d, 0), ids.length - 1)] ?? head;

/** 고른 블록들의 글 처음 ~ 끝(안쪽 블록까지). 글 있는 블록이 없으면 null */
export function textSpan(doc: PMNode, picked: string[]): Range | null {
  const want = new Set(picked);
  let from = -1, to = -1;
  doc.descendants((n, pos) => {
    if (n.type.name !== 'blockContainer' || !want.has(n.attrs.id as string)) return true;
    n.descendants((c, p) => {
      if (!c.isTextblock) return true;
      const s = pos + 1 + p + 1;
      if (from < 0) from = s;
      to = s + c.content.size;
      return false;
    });
    return false;
  });
  return from < 0 ? null : { from, to };
}

/** 고른 블록들의 블록 경계(첫 블록 앞 ~ 끝 블록 뒤) — 복사하면 열린 글 조각이 아니라 블록째(붙이면 문단에 안 합쳐진다) */
export function blockBounds(doc: PMNode, picked: string[]): Range | null {
  const want = new Set(picked);
  let from = -1, to = -1;
  doc.descendants((n, pos) => {
    if (n.type.name !== 'blockContainer' || !want.has(n.attrs.id as string)) return true;
    if (from < 0) from = pos;
    to = pos + n.nodeSize;
    return false;
  });
  return from < 0 ? null : { from, to };
}

const posOfId = (doc: PMNode, id: string) => {
  let at = -1;
  doc.descendants((n, pos) => { if (at < 0 && n.type.name === 'blockContainer' && n.attrs.id === id) at = pos; return at < 0; });
  return at;
};

export const HANDLE = '.bn-side-menu [draggable="true"]';
/** 떠 있는 메뉴('/' 메뉴·링크 칸·손잡이 메뉴·색 고르기) — 열려 있으면 Esc·포커스는 그쪽 몫 */
const MENUS = '.bn-suggestion-menu, .bn-link-toolbar, .bn-menu-dropdown, [role="menu"]';
/** 손잡이를 누른 줄의 블록 — 손잡이는 그 블록 첫 줄 옆에 뜬다. 자식은 빼고 블록 자기 줄(.bn-block-content)로 잰다 */
export function blockAtY(root: HTMLElement, y: number): HTMLElement | null {
  const hits = [...root.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].filter((b) => {
    const c = b.querySelector(':scope > .bn-block > .bn-block-content')?.getBoundingClientRect();
    return c && y >= c.top - 4 && y <= c.bottom + 4;
  });
  return hits[hits.length - 1] ?? null; // 겹치면 안쪽(나중) 것
}

export type BlockPick = { ids: () => string[]; /** 이 블록들(같은 줄 형제, 순서대로)을 고른다 */ pickIds: (list: string[]) => void; off: () => void };

export function installBlockPick(root: HTMLElement, editor: BlockNoteEditor): BlockPick {
  const tip = editor._tiptapEditor;
  const doc = root.ownerDocument;
  // 블록 칸의 class 는 편집기가 다시 그리며 지워서, 번호로 거는 스타일을 따로 둔다(blockDrag 와 같은 방법)
  const style = doc.createElement('style');
  let pick: { anchor: string; head: string } | null = null;
  let want: Range | number | null = null; // 우리가 건 선택(글 범위, 글 없는 블록이면 그 블록 자리)
  let quiet = false; // 복사하는 동안 선택을 잠깐 바꾼다 — 그동안 고르기를 안 푼다
  const sibs = (id: string) => (editor.getParentBlock(id)?.children ?? editor.document).map((b) => b.id);
  const ids = () => (pick ? spanIds(sibs(pick.anchor), pick.anchor, pick.head) : []);
  const paint = () => {
    const list = ids();
    if (!list.length) { style.remove(); delete root.dataset.bp; return; }
    root.dataset.bp = '';
    // 덮어 둔 글 선택에 뜨는 글 서식 막대도 숨긴다(블록 단위 일엔 안 맞는다 — 떠 있는 층이라 편집기 밖에 그려질 수 있어 문서 전체로)
    style.textContent = `${list.map((id) => `.space-editor .bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block`).join(', ')} { background: var(--bp-bg); border-radius: 4px; }\n.bn-formatting-toolbar { display: none !important; }`;
    if (!style.isConnected) doc.head.appendChild(style);
  };
  const select = () => {
    const list = ids();
    if (!list.length) { pick = null; paint(); return; }
    const span = textSpan(tip.state.doc, list);
    if (span) { want = span; tip.commands.setTextSelection(span); }
    else { want = posOfId(tip.state.doc, list[0]!); tip.commands.setNodeSelection(want); }
    paint();
  };
  const set = (anchor: string, head: string) => { pick = { anchor, head }; select(); };
  const clear = (caretAt?: string) => {
    pick = null; want = null; paint();
    if (caretAt) try { editor.setTextCursorPosition(caretAt, 'end'); } catch { /* 글 칸 없는 블록 */ }
  };
  // 사람이 다른 데를 누르거나 편집기가 선택을 옮기면(⌘D 뒤 커서 등) 고르기를 푼다
  const offSel = editor.onSelectionChange(() => {
    if (!pick || want == null || quiet) return;
    const s = tip.state.selection;
    if (typeof want === 'number' ? s.from !== want : s.from !== want.from || s.to !== want.to) clear();
  }, true);

  const key = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Escape' && plain && !e.shiftKey) {
      // '/' 메뉴·링크 칸·손잡이 메뉴가 열려 있으면 그쪽 Esc 가 먼저(메뉴만 닫고 고른 건 그대로)
      if (doc.querySelector(MENUS)) return;
      if (pick) { e.preventDefault(); e.stopPropagation(); clear(pick.head); return; }
      const sel = editor.getSelection()?.blocks;
      const first = sel?.[0] ?? editor.getTextCursorPosition().block;
      const row = sibs(first.id);
      const last = [...(sel ?? [])].reverse().find((b) => row.includes(b.id)) ?? first;
      e.preventDefault(); e.stopPropagation();
      set(first.id, last.id);
      return;
    }
    if (!pick) return;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain) {
      e.preventDefault(); e.stopPropagation();
      const h = moveHead(sibs(pick.anchor), pick.head, e.key === 'ArrowUp' ? -1 : 1);
      set(e.shiftKey ? pick.anchor : h, h);
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && plain) {
      e.preventDefault(); e.stopPropagation();
      const list = ids();
      const before = editor.getPrevBlock(list[0]!), after = editor.getNextBlock(list[list.length - 1]!);
      clear();
      editor.removeBlocks(list);
      try {
        if (before) editor.setTextCursorPosition(before.id, 'end');
        else if (after) editor.setTextCursorPosition(after.id, 'start');
      } catch { /* 글 칸 없는 블록 */ }
      return;
    }
    if (e.key === 'Enter' && plain && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); clear(pick.head); return; }
    // ⌘C·⌘X·⌘D·Tab 같은 단축키는 덮어 둔 선택으로 그대로. 그 밖 글자는 고른 블록 끝에 이어 친다(덮어 둔 글을 지우지 않게 먼저 접는다)
    if (!plain || ['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Tab'].includes(e.key)) return;
    clear(pick.head);
  };
  // 글을 누르면 고르기를 푼다(손잡이·떠 있는 메뉴는 빼고)
  const down = (e: MouseEvent) => {
    if (pick && !(e.target as Element).closest?.(`.bn-side-menu, ${MENUS}`)) clear();
  };
  // 손잡이 누르기 = 그 블록 고르기(Shift 면 늘리기) — 메뉴는 그대로 뜬다
  const click = (e: MouseEvent) => {
    if (!(e.target as Element).closest?.(HANDLE)) return;
    const id = blockAtY(root, e.clientY)?.dataset.id;
    if (!id) return;
    if (e.shiftKey && pick && sibs(pick.anchor).includes(id)) set(pick.anchor, id);
    else set(id, id);
  };
  // 메뉴가 닫히면 포커스가 손잡이로 돌아간다 — 편집기로 돌려야 ⌘C·화살표가 고른 블록에 간다
  // (메뉴가 떠 있는 동안은 메뉴 몫 — 닫히는 움직임이 끝난 뒤 본다)
  const focus = (e: FocusEvent) => {
    if (!pick || !(e.target as Element).closest?.('.bn-side-menu')) return;
    window.setTimeout(() => {
      if (!pick || doc.querySelector(MENUS) || !doc.activeElement?.closest('.bn-side-menu')) return;
      quiet = true; tip.view.focus(); quiet = false;
      select();
    }, 150);
  };
  // keydown 없이 들어오는 글(받아쓰기·이모지 창 등)이 덮어 둔 고른 글을 지우지 않게 — 그 입력은 버리고 고른 블록 끝으로
  const input = (e: InputEvent) => {
    if (!pick || !e.inputType.startsWith('insert')) return;
    e.preventDefault();
    clear(pick.head);
  };
  // 복사·잘라내기는 그 순간만 블록 경계로 — 덮어 둔 글 범위로 복사하면 열린 글 조각이라 붙일 때 첫 블록이 그 줄에 합쳐졌다.
  // 같은 클래스(TextSelection)를 지금 선택에서 빌린다(prosemirror-state 를 따로 들이지 않게). 복사는 끝나면 되돌리고, 잘라내기는 블록째 지워진다
  let back: typeof tip.state.selection | null = null;
  const clipIn = (e: ClipboardEvent) => {
    const list = ids();
    const b = list.length ? blockBounds(tip.state.doc, list) : null;
    const sel = tip.state.selection as unknown as { constructor: { create?: (d: PMNode, a: number, b: number) => typeof tip.state.selection } };
    if (!b || !sel.constructor.create) return;
    quiet = true;
    if (e.type === 'copy') back = tip.state.selection;
    tip.view.dispatch(tip.state.tr.setSelection(sel.constructor.create(tip.state.doc, b.from, b.to)));
  };
  const clipOut = (e: ClipboardEvent) => {
    if (!quiet) return;
    if (back) try { tip.view.dispatch(tip.state.tr.setSelection(back)); } catch { /* 문서가 바뀌었으면 그대로 */ }
    quiet = false; back = null;
    if (e.type === 'cut') clear();
  };
  root.addEventListener('keydown', key, true);
  root.addEventListener('beforeinput', input, true);
  root.addEventListener('mousedown', down, true);
  for (const t of ['copy', 'cut'] as const) { root.addEventListener(t, clipIn, true); root.addEventListener(t, clipOut); }
  doc.addEventListener('click', click, true);
  doc.addEventListener('focusin', focus, true);
  return {
    ids,
    pickIds: (list) => { if (!list.length) return; set(list[0]!, list[list.length - 1]!); tip.view.focus(); },
    off: () => {
      offSel(); clear();
      root.removeEventListener('keydown', key, true);
      root.removeEventListener('beforeinput', input, true);
      root.removeEventListener('mousedown', down, true);
      for (const t of ['copy', 'cut'] as const) { root.removeEventListener(t, clipIn, true); root.removeEventListener(t, clipOut); }
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('focusin', focus, true);
    },
  };
}
