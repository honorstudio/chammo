// xterm.js는 ⌘ 조합을 브라우저 몫으로 보고 버린다. Terminal.app·iTerm2가 보내는 것과
// 같은 시퀀스로 옮겨서 Claude 입력칸의 readline이 알아듣게 한다. (트러블슈팅 #100)

export type KeyLike = {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

const MODIFIERS = ['metaKey', 'altKey', 'ctrlKey', 'shiftKey'] as const;

// ⌘: 줄 단위 — Ctrl+U(줄 처음까지 지움) · Ctrl+A(줄 처음) · Ctrl+E(줄 끝)
const META: Record<string, string> = { Backspace: '\x15', ArrowLeft: '\x01', ArrowRight: '\x05' };
// ⌥: 단어 단위 — ESC DEL(단어 지움) · ESC b(단어 뒤로) · ESC f(단어 앞으로)
const ALT: Record<string, string> = { Backspace: '\x1b\x7f', ArrowLeft: '\x1bb', ArrowRight: '\x1bf', Enter: '\x1b\r' };
// Shift+Enter: 줄바꿈 — xterm 은 그냥 Enter(보내기)로 보낸다. ESC CR 은 Claude Code 입력칸에서 줄바꿈(⌥Enter 와 같음)
const SHIFT: Record<string, string> = { Enter: '\x1b\r' };

/** 옮길 시퀀스. null이면 xterm이 원래대로 처리한다 */
export function macKeySequence(e: KeyLike): string | null {
  const only = (m: (typeof MODIFIERS)[number]) => MODIFIERS.every((k) => e[k] === (k === m));
  if (only('metaKey')) return META[e.key] ?? null;
  if (only('altKey')) return ALT[e.key] ?? null;
  if (only('shiftKey')) return SHIFT[e.key] ?? null;
  return null;
}

/**
 * Ctrl+글자 → 제어 문자(Ctrl+X = 0x18). 물리 키 자리(code)로 계산한다 — 한글 입력기가 조합 중이면 keydown 이
 * key 'Process'·keyCode 229 로 와서 xterm 이 버렸다(사용자 "ctrl+x ctrl+s 가 안 된다", 2026-09-28). Ctrl 단독만
 */
export function ctrlLetter(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? String.fromCharCode(m[1]!.charCodeAt(0) - 64) : null;
}
