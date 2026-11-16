// 문서 선택 막대 끝 '물어보기'(2026-11-13 사용자) — 편집기(SpaceEditor, 열 때 불러옴)만 부른다. 나르는 길은 askOrch.ts
import { invoke } from '@tauri-apps/api/core';
import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import { selRef } from '../../domain/askPick';
import { orchVars } from '../../domain/orchTheme';
import { tr } from '../../i18n';
import { IconChatSend } from '../Icons';
import { askLabel, useAskOrch } from './askOrch';

/**
 * 문서 선택 막대(BlockNote 서식 막대) 끝의 '물어보기' — 고른 글 + 원본 파일 줄·제목을 #sel 칩으로.
 * 줄은 디스크의 원본으로 센다(참모가 읽는 것도 그 파일). 글을 안 골랐거나(커서만) 받을 참모가 없으면 안 보인다
 */
export function AskSelButton({ docPath }: { docPath: string }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const orch = useAskOrch();
  const has = useEditorState({ editor, selector: ({ editor: ed }) => { const { from, to } = ed.prosemirrorState.selection; return to > from && !!ed.prosemirrorState.doc.textBetween(from, to, '\n').trim(); } });
  if (!orch || !has) return null;
  const label = askLabel(orch.to);
  const go = () => {
    const { doc, selection } = editor.prosemirrorState;
    // 블록 사이·문단 안 줄바꿈(hard break) 둘 다 \n — 문단 안 줄바꿈을 빼면 두 줄을 골라도 한 줄로 읽혀 끝 줄을 못 찾았다(하네스 실측)
    const picked = doc.textBetween(selection.from, selection.to, '\n', '\n');
    const before = doc.textBetween(0, selection.from, '\n', '\n');
    // 선택을 끝으로 접어 막대를 닫는다 — 막대가 떠 있으면 그 포커스 관리자가 입력칸으로 보낸 커서를 첫 단추('본문')로 되가져갔다(하네스 실측)
    (editor as unknown as { _tiptapEditor: { commands: { setTextSelection: (pos: number) => void } } })._tiptapEditor.commands.setTextSelection(selection.to);
    // 원본을 못 읽으면(지워짐 등) 줄 없이 경로·글만
    void invoke<string>('read_doc_text', { path: docPath }).catch(() => '').then((src) => orch.ask([selRef(docPath, src, picked, before)]));
  };
  return (
    <Components.FormattingToolbar.Button className="bn-button doc-ask" label={label} mainTooltip={label}
      icon={<span className="doc-ask-ico" style={orch.to ? (orchVars(orch.to.color) as React.CSSProperties) : undefined}><IconChatSend /></span>} onClick={go} />
  );
}
