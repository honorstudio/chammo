// 문서 여백 누르기·끌기(DocPage — 스페이스 문서와 내 메모가 같이 쓴다). 판단은 domain/marginPick
// 끌면 누른 줄부터 커서 줄까지 글을 고른다(노션처럼) · 그냥 누르면 글 아래 빈 곳은 맨 끝 캐럿(빈 줄 하나 더), 줄 옆 여백은 그 줄 가까운 자리
import type { BlockNoteEditor } from '@blocknote/core';
import { clickKind, intoBox, isDrag } from '../../domain/marginPick';
import { lostRelease } from './dragEnd';

/** 여백(글 칸 .bn-editor 밖) mousedown 에서 부른다 — 부른 쪽이 기본 동작을 막는다(막지 않으면 웹뷰가 여백 글자 없는 곳을 고르려 한다) */
export function marginPick(ed: BlockNoteEditor, root: HTMLElement, x0: number, y0: number): void {
  const view = ed.prosemirrorView;
  const tip = ed._tiptapEditor;
  // 글 칸 안 가장 가까운 자리 — 끄는 동안 칸이 굴러갈 수 있어 매번 다시 잰다
  const posAt = (x: number, y: number): number | null => {
    const p = intoBox(root.getBoundingClientRect(), x, y);
    return view.posAtCoords({ left: p.x, top: p.y })?.pos ?? null;
  };
  const anchor = posAt(x0, y0);
  let dragging = false;
  const done = () => {
    lost.stop();
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', done, true);
  };
  // 창 밖에서 놓아 뗌이 안 오면 그 자리에서 끝낸다(다음 아무 클릭이 '여백 클릭'으로 먹지 않게, dragEnd)
  const lost = lostRelease(done);
  const move = (m: PointerEvent) => {
    lost.move(m.buttons);
    if (!dragging && !isDrag(x0, y0, m.clientX, m.clientY)) return;
    if (!dragging) { dragging = true; view.focus(); }
    m.preventDefault();
    const head = posAt(m.clientX, m.clientY);
    if (anchor !== null && head !== null) tip.commands.setTextSelection({ from: anchor, to: head });
  };
  const up = () => {
    done();
    if (dragging) return;
    const outers = root.querySelectorAll<HTMLElement>('.bn-block-outer');
    const lastBottom = outers.length ? outers[outers.length - 1]!.getBoundingClientRect().bottom : -Infinity;
    if (clickKind(lastBottom, y0) === 'near' && anchor !== null) {
      tip.commands.setTextSelection(anchor);
      view.focus();
      return;
    }
    // 글 아래 빈 곳 — 노션처럼 맨 끝 캐럿, 마지막 줄이 비어 있지 않으면 빈 줄을 하나 더(2026-09-30 사용자)
    const blocks = ed.document;
    const last = blocks[blocks.length - 1];
    const empty = last && last.type === 'paragraph' && Array.isArray(last.content) && last.content.length === 0;
    if (last && !empty) ed.insertBlocks([{ type: 'paragraph' }], last, 'after');
    const end = ed.document[ed.document.length - 1];
    if (end) ed.setTextCursorPosition(end, 'end');
    ed.focus();
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', done, true);
}
