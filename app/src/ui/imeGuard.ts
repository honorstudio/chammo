import { nextComposing, shouldCommit, traceOf, type FieldKind } from '../domain/imeGuard';
import { imeTrace } from './imeTrace';

/** 그 칸이 어떤 글칸인가 — 터미널(xterm 숨은 입력칸)은 따로 */
function fieldOf(el: Element | null): FieldKind {
  if (!(el instanceof HTMLElement)) return 'other';
  if (el.closest('.xterm')) return 'xterm';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement) return /^(text|search|url|email|password|number|tel|)$/.test(el.type) ? 'input' : 'other';
  return el.isContentEditable ? 'editor' : 'other';
}
const valueLen = (el: Element | null) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.length : (el?.textContent ?? '').length);

/** 칸을 놓았다 다시 잡는다 — 웹뷰가 조합 중인 글자를 확정한다. 커서·선택은 되살린다 */
function recommit(el: HTMLElement) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const { selectionStart: s, selectionEnd: e, selectionDirection: d } = el;
    el.blur();
    el.focus({ preventScroll: true });
    if (s != null && e != null) el.setSelectionRange(s, e, d ?? undefined);
    return;
  }
  const sel = window.getSelection();
  const ranges = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i).cloneRange()) : [];
  el.blur();
  el.focus({ preventScroll: true });
  if (sel && ranges.length) { sel.removeAllRanges(); ranges.forEach((r) => sel.addRange(r)); }
}

/**
 * 한글 조합 중 창 전환 막이(domain/imeGuard) — 창마다 한 번(main.tsx). 조합 중인지 늘 따라가다,
 * 창이 초점을 잃을 때 글칸에서 한글을 치던 중이었으면 그 칸을 다시 잡는다. 진단이 켜져 있으면(ime-debug.on) 종류·길이만 남긴다
 */
export function installImeGuard() {
  let composing = false;
  const watch = (ev: Event) => {
    const e = ev as KeyboardEvent & InputEvent;
    composing = nextComposing(composing, { type: e.type, key: e.key, keyCode: e.keyCode });
    if (imeTrace) {
      const field = fieldOf(e.target as Element);
      if (field !== 'xterm' && field !== 'other') imeTrace('field', traceOf({ type: e.type, key: e.key, keyCode: e.keyCode, isComposing: e.isComposing, inputType: e.inputType, data: e.data }, field, valueLen(e.target as Element)));
    }
  };
  for (const t of ['keydown', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'focusin', 'focusout', 'mousedown']) document.addEventListener(t, watch, true);
  window.addEventListener('blur', () => {
    const el = document.activeElement;
    const field = fieldOf(el);
    const act = shouldCommit(composing, field);
    imeTrace?.('window', { ev: 'blur', field, composing, guard: act });
    if (!act) return;
    composing = false;
    recommit(el as HTMLElement);
  });
  window.addEventListener('focus', () => imeTrace?.('window', { ev: 'focus', field: fieldOf(document.activeElement) }));
  document.addEventListener('visibilitychange', () => imeTrace?.('window', { ev: 'visibility', state: document.visibilityState }));
}
