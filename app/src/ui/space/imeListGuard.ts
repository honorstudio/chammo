// 하위 목록 새 항목에서 한글 첫 글자가 따로 한 항목으로 떨어지던 것(11-17 사용자 '새 문서 8.md' — '1. 이 / 2. 이렇게', 'ㅇ / ㅇㅇㅇ…') — 판단은 domain/imeEnter.
// 맥 WebKit 은 하위 블록의 유일한 글이 조합 글이면, 확정 직전 deleteCompositionText 로 그 블록 DIV 를 통째로 빼고 <br> 을 넣는다.
// ProseMirror 는 그걸 'Enter 를 누른 것 같다'로 읽어 가짜 Enter 를 치고(키 사건 없음), 항목이 갈린 뒤 확정 글이 새 항목에 다시 들어갔다.
// 그 가짜 Enter 만 받아서 가르지 않고, WebKit 이 DOM 에서 지운 조합 글을 상태에서도 지운다 — 바로 뒤 확정 글이 같은 항목에 한 번 들어간다
import { createExtension } from '@blocknote/core';
import { fakeCompositionEnter } from '../../domain/imeEnter';

const WEBKIT = typeof navigator !== 'undefined' && /Apple Computer/.test(navigator.vendor); // imeEnter 와 같은 판정 — 증거 없는 곳(WebView2·안드로이드)은 안 건드린다

/** 스페이스 문서 편집기 확장 — 목록·문단 Enter 처리보다 먼저 본다(runsBefore default). 쓰기: extensions: [ImeListGuard()] */
export const ImeListGuard = createExtension(() => {
  let composed = '';
  let enterAt = -1e9; // 진짜 Enter 키 — 조합 중 Enter 로 새 줄(WebKit 이 문단을 나누고 ProseMirror 가 Enter 로 바꾼다)은 그대로 둔다
  return {
    key: 'imeListGuard',
    runsBefore: ['default'],
    mount: ({ dom, signal }) => {
      const o = { capture: true, signal };
      dom.addEventListener('compositionstart', () => { composed = ''; }, o);
      dom.addEventListener('compositionupdate', (e) => { if ((e as CompositionEvent).data) composed = (e as CompositionEvent).data; }, o);
      dom.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') enterAt = Date.now(); }, o);
    },
    keyboardShortcuts: {
      Enter: ({ editor }) => {
        if (!WEBKIT) return false;
        const view = editor.prosemirrorView;
        const $c = (view.state.selection as { $cursor?: { parent: { textContent: string }; start(): number; end(): number } | null }).$cursor;
        if (!$c || !fakeCompositionEnter({ composing: view.composing, sinceRealEnter: Date.now() - enterAt, blockText: $c.parent.textContent, composed })) return false;
        view.dispatch(view.state.tr.delete($c.start(), $c.end()));
        return true;
      },
    },
  };
});
