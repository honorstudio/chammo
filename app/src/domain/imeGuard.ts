/**
 * 한글 조합 중 창 전환 막이(사용자 2026-10-02: 입력칸에 한글을 치다 Cmd+Tab 으로 나갔다 오면 방향키가 안 먹고,
 * 다음 글자가 마지막 글자를 갈아치웠다). 웹뷰가 조합 중인 글자를 붙든 채 창이 초점을 잃은 모양 —
 * 창이 초점을 잃을 때 한글을 치던 중이었으면 그 칸을 다시 잡아(blur→focus) 웹뷰가 조합을 확정하게 한다(ui/imeGuard).
 * 개발판에선 재현 못 함(웹뷰가 조합 이벤트 없이 바꿔치기로 받을 땐 저절로 확정된다) — 진단 기록(ime-debug.on)으로 확인한다
 */

export type ImeEvent = { type: string; key?: string; keyCode?: number };
/** 글칸 종류 — 터미널(xterm)은 한글 다리(domain/imeBridge)가 따로 맡는다 */
export type FieldKind = 'textarea' | 'input' | 'editor' | 'xterm' | 'other';

// 그 자체로 글자를 안 만드는 키 — Cmd+Tab 의 Cmd 가 여기라서 조합 중 표시가 그대로 남는다
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'Lang1', 'Lang2', 'HangulMode', 'Process', 'Dead']);
const NAV = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** 이벤트 하나 뒤 "조합 중일 수 있나" — 입력기 키(229)·조합 시작/갱신 = 예, 입력기를 안 거친 키·조합 끝·칸 옮김·마우스 = 아니오 */
export function nextComposing(composing: boolean, e: ImeEvent): boolean {
  switch (e.type) {
    case 'compositionstart':
    case 'compositionupdate':
      return true;
    case 'compositionend':
    case 'focusin':
    case 'focusout':
    case 'mousedown':
      return false;
    case 'keydown':
      if (e.keyCode === 229) return true;
      return MODIFIERS.has(e.key ?? '') ? composing : false;
    default:
      return composing;
  }
}

/** 창이 초점을 잃을 때 칸을 다시 잡을까 — 조합 중 + 글칸(터미널 빼고) */
export const shouldCommit = (composing: boolean, field: FieldKind) => composing && (field === 'textarea' || field === 'input' || field === 'editor');

/** 키 종류 — 진단 기록에 글자를 안 남기려고 */
export function keyKind(key: string, keyCode: number): string {
  if (keyCode === 229) return 'ime';
  if (MODIFIERS.has(key)) return 'mod';
  if (NAV.has(key)) return 'nav';
  if (key === 'Enter' || key === 'Backspace' || key === 'Tab' || key === 'Escape') return key.toLowerCase();
  return [...key].length === 1 ? 'char' : 'other';
}

/** 진단 기록 한 줄 — 종류·길이만(글자 내용은 개인정보라 안 남긴다). vl = 칸에 든 글 길이 */
export function traceOf(e: { type: string; key?: string; keyCode?: number; isComposing?: boolean; inputType?: string; data?: string | null }, field: FieldKind, vl: number) {
  return {
    type: e.type,
    field,
    ...(e.isComposing === undefined ? {} : { comp: e.isComposing }),
    ...(e.key === undefined ? {} : { kk: keyKind(e.key, e.keyCode ?? 0) }),
    ...(e.inputType ? { it: e.inputType } : {}),
    ...(e.data == null ? {} : { dl: [...e.data].length }),
    vl,
  };
}

const CTRL: Record<string, string> = { '\r': 'CR', '\n': 'LF', '\t': 'TAB', '\x7f': 'DEL', '\b': 'BS' };
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;
// CSI(ESC [ 숫자·; … 끝 글자)·SS3(ESC O 방향·기능 키) — 방향키·붙여넣기 괄호처럼 키 종류만 담는다
const ESC_SEQ = /^\x1b(\[[0-9;?]*[ -/]*[@-~]|O[A-DFHP-S])/;

/**
 * 터미널로 보낸 글의 모양 — 진단 기록에 친 글자를 안 남기려고(비밀번호도 터미널에 친다).
 * 글자는 종류×개수(a = 영문·숫자·기호, 한 = 한글, u = 그 밖), 제어 문자는 이름(DEL·CR·^C), 이스케이프 시퀀스는 그대로(ESC[A), Alt+글자는 ESC+
 */
export function seqShape(s: string): string {
  const toks: string[] = [];
  for (let i = 0; i < s.length; ) {
    if (s[i] === '\x1b') {
      const m = ESC_SEQ.exec(s.slice(i));
      if (m) { toks.push(`ESC${m[1]}`); i += m[0].length; }
      else if (i + 1 < s.length) { toks.push('ESC+'); i += 1 + [...s.slice(i + 1)][0]!.length; }
      else { toks.push('ESC'); i++; }
      continue;
    }
    const ch = [...s.slice(i, i + 2)][0]!;
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) toks.push(CTRL[ch] ?? `^${String.fromCharCode(code + 64)}`);
    else if (ch === ' ') toks.push('sp');
    else if (HANGUL.test(ch)) toks.push('한');
    else toks.push(code < 0x7f ? 'a' : 'u');
    i += ch.length;
  }
  const out: string[] = [];
  for (let i = 0; i < toks.length; ) {
    let n = 1;
    while (toks[i + n] === toks[i]) n++;
    out.push(n > 1 ? `${toks[i]}×${n}` : toks[i]!);
    i += n;
  }
  return out.join(' ');
}
