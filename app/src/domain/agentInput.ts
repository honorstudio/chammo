// 세션 브라우저 '크게 보기' 모달에서 직접 조작 — 화면 좌표·키를 CDP 입력(Rust agent_input.rs)으로 바꾼다.
// 글자(영문·한글 조합 끝·붙여넣기)는 글칸이 insertText 로 따로 보낸다. 친 글은 어디에도 안 남긴다

export type KeyEv = { kind: 'key'; type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char'; key: string; code: string; keyCode: number; text?: string; modifiers: number; commands?: string[] };
export type InputEv =
  | { kind: 'mouse'; type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel'; x: number; y: number; button?: 'none' | 'left' | 'middle' | 'right'; clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number }
  | KeyEv
  | { kind: 'text'; text: string }
  | { kind: 'nav'; action: 'reload' | 'back' | 'forward' };

type Box = { left: number; top: number; width: number; height: number };
type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** 칸에 contain 으로 그린 그림 위 좌표 → 그림 안 비율(0~1). 여백·크기 모름이면 null */
export function pointIn(cx: number, cy: number, box: Box, natW: number, natH: number): { x: number; y: number } | null {
  if (natW <= 0 || natH <= 0 || box.width <= 0 || box.height <= 0) return null;
  const s = Math.min(box.width / natW, box.height / natH);
  const w = natW * s;
  const h = natH * s;
  const x = (cx - box.left - (box.width - w) / 2) / w;
  const y = (cy - box.top - (box.height - h) / 2) / h;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 };
}

/** CDP modifiers — Alt 1·Ctrl 2·Meta 4·Shift 8 */
export const modsOf = (e: Mods) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

const SPECIAL: Record<string, string | undefined> = {
  Enter: '\r', Tab: undefined, Backspace: undefined, Delete: undefined, Escape: undefined,
  ArrowLeft: undefined, ArrowRight: undefined, ArrowUp: undefined, ArrowDown: undefined,
  Home: undefined, End: undefined, PageUp: undefined, PageDown: undefined,
};
const META_CMD: Record<string, string> = { a: 'selectAll', z: 'undo', c: 'copy', x: 'cut' };
const META_NAV: Record<string, 'reload' | 'back' | 'forward'> = { KeyR: 'reload', BracketLeft: 'back', BracketRight: 'forward' };
/** ⌘ 조합의 글자 — 한글 자판이면 e.key 가 'ㅁ' 라 키 자리(code)로 읽는다 */
const comboKey = (e: { key: string; code: string }) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.toLowerCase());

/** 글자가 아닌 키 → CDP 입력들. 보통 글자·⌘V(붙여넣기 이벤트가 맡음)·조합 키는 null */
export function keyEvents(e: Mods & { key: string; code: string; keyCode: number }): InputEv[] | null {
  if (e.keyCode === 229 || e.key === 'Process') return null;
  const modifiers = modsOf(e);
  if (e.metaKey || e.ctrlKey) {
    const key = comboKey(e);
    if (key.length === 1 || e.code in META_NAV) {
      if (key === 'v' && e.metaKey) return null;
      const nav = e.metaKey ? META_NAV[e.code] : undefined;
      if (nav) return [{ kind: 'nav', action: nav }];
      const base = { kind: 'key' as const, key, code: e.code, keyCode: e.keyCode, modifiers };
      const cmd = key === 'z' && e.shiftKey ? 'redo' : META_CMD[key];
      // 편집 명령은 commands 로, 나머지 ⌘ 조합은 페이지 단축키로 그대로(⌘F·⌘K 를 쓰는 페이지면 먹는다)
      return cmd ? [{ ...base, type: 'rawKeyDown', commands: [cmd] }, { ...base, type: 'keyUp' }] : [{ ...base, type: 'rawKeyDown' }, { ...base, type: 'keyUp' }];
    }
  }
  const base = { kind: 'key' as const, key: e.key, code: e.code, keyCode: e.keyCode, modifiers };
  if (!(e.key in SPECIAL)) return null;
  const text = SPECIAL[e.key];
  return text
    ? [{ ...base, type: 'rawKeyDown' }, { ...base, type: 'char', text }, { ...base, type: 'keyUp' }]
    : [{ ...base, type: 'rawKeyDown' }, { ...base, type: 'keyUp' }];
}

/** 마지막 커서 자리에서 멀리 떨어진 곳을 바로 누르면 사이에 이동을 끼운다 — 봇 검사가 '순간이동'으로 안 보게(도착점 빼고 n걸음) */
export function approach(from: { x: number; y: number } | null, to: { x: number; y: number }, n = 4): { x: number; y: number }[] {
  if (!from || Math.hypot(to.x - from.x, to.y - from.y) < 0.05) return [];
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return Array.from({ length: n }, (_, i) => ({ x: r(from.x + ((to.x - from.x) * (i + 1)) / (n + 1)), y: r(from.y + ((to.y - from.y) * (i + 1)) / (n + 1)) }));
}

export type KeyRoute = 'browser' | 'app' | 'close' | 'none';
/** 모달 글칸에 포커스가 있어도 앱이 갖는 ⌘ 키 — 닫기(⌘Q)·가리기(⌘H)·설정(⌘,) */
const APP_KEYS = new Set(['KeyQ', 'KeyH', 'Comma']);
/** 아무 데도 안 보내는 ⌘ 키 — 주소창이 없고(⌘L), 확대는 앱 글자 크기를 바꾸면 안 된다(⌘+ ⌘− ⌘0) */
const NONE_KEYS = new Set(['KeyL', 'Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0']);

/**
 * 키는 누구 것인가(2026-10-03 사용자 "브라우저에 포커스된 상태에선 브라우저 단축키가 작동하게") — focus = 모달 글칸에 포커스.
 * ⌘W 는 모달 닫기(세션 브라우저 탭을 사람이 실수로 닫지 않게). Esc 는 'browser' — 두 번이면 닫기는 escClose
 */
export function keyTarget(e: Mods & { key: string; code: string }, focus: boolean): KeyRoute {
  if (!focus) return 'app';
  if (e.metaKey && e.altKey) return 'app'; // ⌥⌘1~4 화면 이동·⌥⌘Q
  if (e.metaKey && !e.ctrlKey) {
    if (e.code === 'KeyW') return 'close';
    if (APP_KEYS.has(e.code)) return 'app';
    if (NONE_KEYS.has(e.code)) return 'none';
  }
  return 'browser';
}

/** 글칸에 포커스가 없는 모달(저절로 뜬 것·대화상자 입력칸)의 키 — Esc·⌘W 는 모달 닫기. 안 잡으면 ⌘W 가 앱으로 가서 뒤 세션을 껐다(리뷰) */
export const unfocusedKey = (e: Mods & { key: string; code: string }): 'close' | 'pass' => (e.key === 'Escape' || keyTarget(e, true) === 'close' ? 'close' : 'pass');

/** 브라우저가 키를 가진 동안 온 메뉴바 항목(같은 누름이 키·메뉴 두 갈래로 온다) — 키 쪽이 이미 보냈으니 대부분 버린다 */
export function menuRoute(id: string): 'close' | 'app' | 'none' {
  if (id === 'close_pane') return 'close';
  // 설정(⌘,)·완전 종료(⌥⌘Q)·화면 이동(⌥⌘1~4)은 keyTarget 도 앱 몫 — 두 갈래가 와도 App 의 run 이 한 번만 돌린다
  if (id === 'settings' || id === 'app_quit_all' || id.startsWith('goto_')) return 'app';
  return 'none';
}

/** 페이지 대화상자가 떠 있으면 Esc 는 그 대화상자 취소 — 모달은 안 닫는다(크롬에서 Esc 가 대화상자를 닫는 것과 같게, QA N7) */
export const escCancelsDialog = (e: { key: string }, dialogUp: boolean) => dialogUp && e.key === 'Escape';

/** Esc — 한 번은 페이지로(페이지 팝업 닫기 등), 0.5초 안에 또 누르면 모달 닫기 */
export const escClose = (prevAt: number, now: number) => prevAt > 0 && now - prevAt <= 500;

/** 손가락을 이만큼(px) 넘게 움직이면 누르기가 아니라 밀기(스크롤) */
export const TAP_SLOP = 10;

/**
 * 폰 개입(2026-10-06 사용자 ⑥) — 그림 위 손가락 한 번 → 브라우저 입력. 거의 안 움직였으면 그 자리 누르기,
 * 움직였으면 그 자리에서 스크롤(손가락 반대 방향, scale = 페이지 px / 화면 px)
 */
export function phoneGesture(p: { x: number; y: number }, dx: number, dy: number, scale: number): InputEv[] {
  if (Math.hypot(dx, dy) < TAP_SLOP) {
    return [
      { kind: 'mouse', type: 'mouseMoved', x: p.x, y: p.y, button: 'none', modifiers: 0 },
      { kind: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: 0 },
      { kind: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: 0 },
    ];
  }
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return [{ kind: 'mouse', type: 'mouseWheel', x: p.x, y: p.y, deltaX: Math.round(-dx * k) || 0, deltaY: Math.round(-dy * k) || 0, modifiers: 0 }];
}

/** 폰 키 버튼(Enter·지우기) — 데스크톱 키와 같은 모양 */
export function phoneKey(key: 'Enter' | 'Backspace'): InputEv[] {
  const code = { Enter: 13, Backspace: 8 }[key];
  return keyEvents({ key, code: key, keyCode: code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }) ?? [];
}
