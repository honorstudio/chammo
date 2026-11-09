// 한글 조합 뒤 Enter 한 번에 새 줄(11-05 사용자 "한글은 엔터를 두 번 쳐야 내려간다") — 판단은 domain/imeEnter.
// 맥 앱(WKWebView)에서 ProseMirror 는 조합 끝 0.5초 안 Enter 를 일본어 '변환 확정'으로 보고 버린다. 버려진 Enter 가
// 정말 줄을 안 바꿨을 때만 편집기 Enter 를 한 번 대신 친다(블록 나누기·목록 이어 가기는 편집기 규칙 그대로)
import type { BlockNoteEditor } from '@blocknote/core';
import { hasHangul, isPlainEnter, pmSwallows, replayEnter } from '../../domain/imeEnter';

const WEBKIT = typeof navigator !== 'undefined' && /Apple Computer/.test(navigator.vendor); // prosemirror-view 의 safari 판정과 같게

/** 편집기 상자(root)에 단다 — 포착 단계라 ProseMirror 보다 먼저 Enter 를 본다 */
export function installImeEnter(root: HTMLElement, ed: BlockNoteEditor): () => void {
  // 맥 WebKit 에서만 — 버려지는 건 사파리 규칙이고, 윈도우(WebView2)는 조합 뒤 진짜 Enter 가 따라오면 두 줄 내려갈 수 있다(증거 없는 곳은 안 건드린다)
  if (!WEBKIT) return () => {};
  let composed = '';
  let endedAt = -1e9;
  let pending: { timer: number; run: () => void } | null = null; // 대신 칠 Enter — 다음 키가 먼저 오면 그 키보다 먼저 친다(빨리 이어 쳐도 제자리에서 나뉘게)
  const start = () => { composed = ''; };
  const update = (e: CompositionEvent) => { if (e.data) composed = e.data; };
  const end = (e: CompositionEvent) => { if (e.data) composed = e.data; endedAt = Date.now(); };
  const blockId = () => { try { return ed.getTextCursorPosition().block.id; } catch { return null; } };
  const count = () => root.querySelectorAll('.bn-block-outer').length;
  const key = (e: KeyboardEvent) => {
    if (pending) { window.clearTimeout(pending.timer); const p = pending; pending = null; p.run(); }
    if (!isPlainEnter(e)) return;
    const view = ed.prosemirrorView;
    const swallowed = pmSwallows({ composing: view.composing || e.isComposing, webkit: true, sinceEnd: Date.now() - endedAt });
    if (!swallowed || !hasHangul(composed)) return;
    // 조합이 이미 끝났으면 웹뷰 기본 Enter(문단 나누기)도 막는다 — ProseMirror 가 버린 Enter 를 웹뷰가 혼자 처리하면 커서 뒤 글이
    // 지워졌다(글 가운데서 '가나|다라' → '가나한' 만 남음, 고치기 전에도). 조합 중 Enter 는 확정을 막을 수 있어 그대로 둔다
    // 막은 Enter 는 ProseMirror 가 아예 안 본다(기본 동작이 막힌 keydown 은 건너뜀) — 그래서 0.5초 안 다음 Enter 도 버려지고, 그것도 여기서 대신 친다
    if (!view.composing && !e.isComposing) e.preventDefault();
    const was = { id: blockId(), n: count() };
    const run = () => {
      if (view.isDestroyed) return;
      if (!replayEnter({ hangul: true, swallowed, sameBlock: blockId() === was.id, sameCount: count() === was.n })) return;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(enter, 'keyCode', { get: () => 13 });
      view.someProp('handleKeyDown', (f) => f(view, enter));
    };
    // 조합 확정 글을 ProseMirror 가 읽은 뒤(조합 끝 20ms) 친다. 아직 조합 중이면 조금 더 기다린다
    let tries = 0;
    const later = () => {
      if (view.composing && ++tries < 10) { pending = { timer: window.setTimeout(later, 15), run }; return; }
      pending = null;
      run();
    };
    pending = { timer: window.setTimeout(later, 30), run };
  };
  root.addEventListener('compositionstart', start, true);
  root.addEventListener('compositionupdate', update, true);
  root.addEventListener('compositionend', end, true);
  root.addEventListener('keydown', key, true);
  return () => {
    if (pending) window.clearTimeout(pending.timer);
    root.removeEventListener('compositionstart', start, true);
    root.removeEventListener('compositionupdate', update, true);
    root.removeEventListener('compositionend', end, true);
    root.removeEventListener('keydown', key, true);
  };
}
