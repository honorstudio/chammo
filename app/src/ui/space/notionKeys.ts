// 노션 단축키 맞추기(11-17, 표 docs/design-drafts/editor-keys/notion-diff.md) — 판단은 domain/notionKeys.
// ⌘Enter 할 일 체크·토글 열고 닫기, ⌘⌥4~8 블록 종류, 줄 맨 앞 'a. '·'i. ' 번호 목록·'> ' 토글. 한글 조합 중엔 안 끼어든다
import { createExtension } from '@blocknote/core';
import type { BlockNoteEditor } from '@blocknote/core';
import { SHORTCUTS, TYPE_KEYS, cmdEnterAct } from '../../domain/notionKeys';

const turn = (type: string) => ({ editor }: { editor: unknown }) => {
  const ed = editor as BlockNoteEditor;
  if (ed.prosemirrorView.composing) return false;
  const b = ed.getTextCursorPosition().block;
  ed.updateBlock(b, { type, props: {} } as never);
  return true;
};

/** 스페이스 문서 편집기 확장 — 블록 자체 단축키·인용 '> ' 보다 먼저. 쓰기: extensions: [NotionKeys] */
export const NotionKeys = createExtension({
  key: 'notionKeys',
  runsBefore: ['default'],
  inputRules: SHORTCUTS.map(({ find, type }) => ({
    find,
    replace: ({ editor }: { editor: BlockNoteEditor }) => (editor.getTextCursorPosition().block.type === 'heading' ? undefined : { type, props: {} }),
  })) as never,
  keyboardShortcuts: {
    'Mod-Enter': ({ editor }) => {
      const ed = editor as BlockNoteEditor;
      if (ed.prosemirrorView.composing) return false;
      const b = ed.getTextCursorPosition().block as { id: string; type: string; props: { checked?: boolean; isToggleable?: boolean } };
      const act = cmdEnterAct(b.type, !!b.props.isToggleable);
      if (act === 'check') ed.updateBlock(b.id, { props: { checked: !b.props.checked } } as never);
      else if (act === 'fold') ed.domElement?.querySelector<HTMLButtonElement>(`.bn-block-outer[data-id="${b.id}"] .bn-toggle-button`)?.click();
      return !!act;
    },
    ...Object.fromEntries(Object.entries(TYPE_KEYS).map(([n, type]) => [`Mod-Alt-${n}`, turn(type)])),
  },
});
