import { invoke } from '@tauri-apps/api/core';
import { kindOf } from '../domain/reader';
import { selectAllTarget } from '../domain/readerZoom';
import { selectAllTerminalAt } from './TerminalPane';

/** 스페이스 문서 편집기마다 ⌘A 동작 — 편집기 상자(.space-editor) → 한 단계 넓히기. SpaceEditor 가 등록한다 */
export const docSelectAll = new WeakMap<Element, () => void>();

/** 글을 칠 수 있는 칸인가 — xterm 의 숨은 입력칸은 빼고(그건 터미널로 친다) */
function editable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el) return false;
  if (el.classList.contains('xterm-helper-textarea')) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return /^(text|search|url|email|password|number|tel|)$/.test(el.type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * ⌘A — 보고 있는 곳 안에서만 전체 선택(사용자 2026-09-29: 앱 화면 전체가 잡혔다).
 * reader = 리더를 보고 있나, root = 그 리더 면(메인 창 리더 패널 또는 떼어 낸 창)
 */
export function selectAllHere(reader: boolean, root: ParentNode | null) {
  const active = document.activeElement;
  const body = root?.querySelector<HTMLElement>('.rd-body[data-path]');
  const kind = body ? kindOf(body.dataset.path!) : null;
  const target = selectAllTarget({ editable: editable(active), terminal: !!active?.closest('.xterm'), reader, kind });
  if (target === 'input') {
    // 문서 편집기(BlockNote) — execCommand 전체 선택은 ProseMirror 가 받지 않아 0자로 남았다(2026-10-02 실측). 편집기가 칸 → 문서로 넓힌다
    // 편집 영역 자체일 때만 — 편집기 상자 안의 다른 입력칸(링크 주소 칸 등)은 그 칸 전체 선택
    const step = active instanceof HTMLElement && active.isContentEditable ? active.closest('.space-editor') : null;
    if (step && docSelectAll.has(step)) { docSelectAll.get(step)!(); return; }
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.select();
    else document.execCommand('selectAll');
  } else if (target === 'terminal') {
    selectAllTerminalAt(active);
  } else if (target === 'readerText') {
    const doc = body?.querySelector('.rd-md main, .rd-text');
    if (!doc) return;
    const range = document.createRange();
    range.selectNodeContents(doc);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else if (target === 'readerFrame') {
    // 웹뷰 전체 선택은 포커스가 있는 프레임에서 돈다 — 프레임이 아니면 앱 화면 전체가 잡히니 먼저 프레임으로
    const frame = body?.querySelector('iframe');
    if (!frame) return;
    if (document.activeElement !== frame) frame.focus();
    void invoke('reader_select_all').catch(() => {});
  }
}
