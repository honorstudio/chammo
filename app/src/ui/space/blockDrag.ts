// 문서 블록 손잡이(⋮⋮) 끌기 — BlockNote 는 웹 끌기(HTML5)로 옮기는데, 앱 창은 파일 끌어다 놓기(Tauri)가 끌기 신호를
// 다 가져가 페이지까지 안 온다(메모 순서 바꾸기도 같은 이유로 막혔다, NotePanel). 그래서 손잡이를 잡으면 마우스를 직접 따라간다.
// 5px 안 움직이면 그냥 클릭(블록 메뉴가 열린다)
import type { BlockNoteEditor } from '@blocknote/core';
import { moveSlot } from '../../domain/docBlocks';

const HANDLE = '.bn-side-menu [draggable="true"]';

/** 손잡이를 누른 줄의 블록 — 손잡이는 그 블록 첫 줄 옆에 뜬다. 자식은 빼고 블록 자기 줄(.bn-block-content)로 잰다 */
function blockAtY(root: HTMLElement, y: number): HTMLElement | null {
  const hits = [...root.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].filter((b) => {
    const c = b.querySelector(':scope > .bn-block > .bn-block-content')?.getBoundingClientRect();
    return c && y >= c.top - 4 && y <= c.bottom + 4;
  });
  return hits[hits.length - 1] ?? null; // 겹치면 안쪽(나중) 것
}

/** 편집기 상자에 손잡이 끌기를 단다. line(y|null) = 놓일 자리 가로줄(상자 기준) */
export function installBlockDrag(root: HTMLElement, editor: BlockNoteEditor, line: (y: number | null) => void): () => void {
  // 손잡이는 편집기 밖(떠 있는 층)에 그려질 수 있어 문서에서 듣고, 블록은 이 편집기 안에서만 찾는다
  const doc = root.ownerDocument;
  // 웹 끌기는 시작부터 막는다 — BlockNote 까지 안 가게(가면 끌기 미리보기 복제본이 문서에 남는다). 브라우저(시험)에서도 앱과 같은 길로
  const noNative = (e: DragEvent) => { if ((e.target as HTMLElement | null)?.closest?.(HANDLE)) { e.preventDefault(); e.stopPropagation(); } };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target as HTMLElement).closest(HANDLE)) return;
    const outer = blockAtY(root, e.clientY);
    const id = outer?.dataset.id;
    if (!outer || !id) return;
    const own = [id, ...[...outer.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].map((b) => b.dataset.id!)];
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    // 잡은 블록 흐리게 — 블록 칸의 class 는 편집기가 다시 그리며 지워서, 번호로 거는 스타일을 따로 둔다
    const lift = doc.createElement('style');
    let slot: ReturnType<typeof moveSlot> = null;
    const rects = () => [...root.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.id!, top: r.top, bottom: r.bottom };
    });
    const move = (m: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        dragging = true;
        lift.textContent = `.space-editor .bn-block-outer[data-id="${CSS.escape(id)}"] { opacity: .35; }`;
        doc.head.appendChild(lift);
        document.documentElement.classList.add('cv-block-dragging');
      }
      slot = moveSlot(rects(), id, own, m.clientY);
      line(slot ? slot.y - root.getBoundingClientRect().top : null);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      if (!dragging) return; // 그냥 클릭 — 블록 메뉴
      lift.remove();
      document.documentElement.classList.remove('cv-block-dragging');
      line(null);
      // 끌기 끝의 클릭은 삼킨다(블록 메뉴가 안 열리게)
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      const block = editor.getBlock(id);
      if (!slot || !block || !editor.getBlock(slot.id)) return;
      const to = slot;
      editor.transact(() => {
        editor.removeBlocks([id]);
        editor.insertBlocks([block], to.id, to.place);
      });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };
  doc.addEventListener('dragstart', noNative, true);
  doc.addEventListener('pointerdown', down, true);
  return () => { doc.removeEventListener('dragstart', noNative, true); doc.removeEventListener('pointerdown', down, true); };
}
