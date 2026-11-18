// 문서 목록 맨 앞 Backspace·빈 항목 Enter 를 노션처럼(11-17 사용자 '새 문서 9.md') — 판단은 domain/listKeys.
// 옛 확장(다른 캔버스 편집기에서 가져온 '빈 줄 지우고 윗줄 끝으로')은 2번 항목 Backspace 에 커서가 1번 줄 끝으로 올라가서 걷어 냈다.
// BlockNote 기본 Backspace 는 목록 → 보통 글(들여쓰기 그대로) → 한 단계 바깥 순서라 하위 빈 항목이 안쪽 보통 글로 남았고,
// 기본 Enter 는 하위 빈 항목도 바로 보통 글로 바꿨다. 여기서 먼저 받아: 하위면 한 단계 바깥(Shift+Tab 과 같은 unnestBlock), 맨 바깥이면 목록 표시만 뺀다
import { createExtension } from '@blocknote/core';
import type { BlockNoteEditor } from '@blocknote/core';
import { listKeyAct } from '../../domain/listKeys';

function handle(editor: BlockNoteEditor, key: 'Backspace' | 'Enter'): boolean {
  const view = editor.prosemirrorView;
  const sel = view.state.selection as { empty: boolean; $cursor?: { parentOffset: number; parent: { content: { size: number } } } | null };
  const $c = sel.$cursor;
  const block = editor.getTextCursorPosition().block;
  const act = listKeyAct({
    key, composing: view.composing, selectionEmpty: sel.empty && !!$c, type: block.type,
    atStart: $c?.parentOffset === 0, empty: $c?.parent.content.size === 0, nested: editor.canUnnestBlock(),
  });
  if (!act) return false;
  // '1. ' 같은 단축 입력 바로 뒤 Backspace 는 단축 입력을 되돌린다 — 기본 undoInputRule 은 '-  '(공백 둘)로 되돌려서 ⌘Z 와 같은 되돌리기로
  if (key === 'Backspace' && editor._tiptapEditor.can().undoInputRule()) { editor.undo(); return true; }
  if (act === 'unnest') editor.unnestBlock();
  else editor.updateBlock(block, { type: 'paragraph', props: {} });
  return true;
}

/** 스페이스 문서 편집기 확장 — 목록 블록 자체 Enter·기본 Backspace 보다 먼저 본다. 쓰기: extensions: [ListKeys] */
export const ListKeys = createExtension({
  key: 'listKeys',
  runsBefore: ['default'],
  keyboardShortcuts: {
    Backspace: ({ editor }) => handle(editor as BlockNoteEditor, 'Backspace'),
    Enter: ({ editor }) => handle(editor as BlockNoteEditor, 'Enter'),
  },
});
