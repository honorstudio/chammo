// 사람이 앱을 보고 있나(판단은 domain/attention) — 안 보면 문서 맨 위에 oa-paused 를 달고 구독자(깜빡임·말하는 빛·오피스)에게 알린다.
// 앱이 맨 앞인지는 맥 앱에선 Rust 가 창 포커스가 바뀔 때마다 window.__appFocus(앱 창 중 하나라도 앞) 로 알려 준다 —
// 메인 웹뷰의 blur 만 보면 앱 안 리더 창으로 옮겨도 '맨 앞 아님'이 된다. 폰·브라우저는 창 focus/blur 그대로.
// 덮개 닫힘도 Rust(lid.rs)가 바뀔 때 window.__lidClosed 로 알린다 — 붙기 전에 온 값은 __lidClosedNow 에 남아 있다
import { attended, idleLeft } from '../domain/attention';

let bound = false;
let tauri = false;
let focused = true;
let lidClosed = false;
let lastInput = Date.now();
let on = true;
let timer = 0;
const subs = new Set<(on: boolean) => void>();

function update() {
  const now = Date.now();
  const next = attended({ hidden: document.hidden, focused, lidClosed, lastInput, now });
  window.clearTimeout(timer);
  // 보는 동안은 2분이 차는 때 한 번만 깬다 — 그 사이 입력이 있었으면 남은 만큼 다시 건다
  timer = next ? window.setTimeout(update, idleLeft(lastInput, now) + 50) : 0;
  if (next === on) return;
  on = next;
  document.documentElement.classList.toggle('oa-paused', !on);
  subs.forEach((f) => f(on));
}

function input() {
  lastInput = Date.now();
  if (!tauri) focused = true; // 폰·브라우저는 첫 hasFocus 가 false 로 올 수 있다 — 만지면 앞에 있는 것
  if (!on) update(); // 멈춰 있을 때만 바로 — 보는 중엔 타이머가 알아서 잰다(움직일 때마다 타이머를 다시 걸지 않게)
}

export function bindAttention() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  tauri = '__TAURI_INTERNALS__' in window;
  focused = document.hasFocus();
  const w = window as unknown as { __appFocus?: (v: boolean) => void; __lidClosed?: (v: boolean) => void; __lidClosedNow?: boolean };
  // 앞으로 온 것도 사람이 한 일 — 2분 넘게 쉬다 ⌘Tab 으로 돌아와도 바로 움직인다
  const front = (v: boolean) => { focused = v; if (v) lastInput = Date.now(); update(); };
  w.__appFocus = front;
  // 덮개를 연 것도 사람이 한 일 — 닫혀 있던 2분 넘게가 입력 없음으로 남지 않게
  lidClosed = w.__lidClosedNow === true;
  w.__lidClosed = (v: boolean) => { lidClosed = v; if (!v) lastInput = Date.now(); update(); };
  window.addEventListener('focus', () => front(true));
  if (!tauri) window.addEventListener('blur', () => front(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastInput = Date.now(); update(); });
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, input, { capture: true, passive: true });
  }
  update();
}

export const isAttended = () => { bindAttention(); return on; };

/** 보고 있음이 바뀔 때마다 */
export function onAttention(f: (on: boolean) => void): () => void {
  bindAttention();
  subs.add(f);
  return () => subs.delete(f);
}
