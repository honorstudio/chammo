// 윈도우 단축키 규칙 — 맥은 ⌘ 조합을 앱이, Ctrl 조합을 터미널(Claude 입력칸)이 쓴다. 윈도우엔 ⌘ 가 없다.
// Ctrl+글자(C·D·K·W·T·B·E·A…)는 Claude·셸이 쓰니 앱은 Ctrl+Shift+글자(윈도우 터미널과 같은 관례),
// 숫자·기호는 Ctrl 하나. 예외: ⌘⇧글자(⌘⇧E 리더 크게·⌘⇧W 세션 끄기·⌘⇧T 새 세션·⌘⇧H 홈·⌘⇧L 보관함)는 Ctrl+Alt+글자 — Ctrl+Shift+글자는 ⇧ 없는 ⌘글자 자리라서, ⌘/(둘러보기) → Ctrl+Shift+/(Ctrl+/ 는 되돌리기), ⌘[ ⌘](뒤로·앞으로) → Ctrl+Shift+[ ](Ctrl+[ 는 Esc)
// 메뉴 단축키(Rust main.rs accel)도 같은 규칙이다 — 하나를 바꾸면 둘 다

type KeyLike = { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };

const mac = (key: string, m: { shift?: boolean; alt?: boolean } = {}): KeyLike => ({ key, code: undefined, metaKey: true, shiftKey: !!m.shift, altKey: !!m.alt, ctrlKey: false });

/** code 가 비어 오면(원격 입력·일부 입력기) key 로 키 자리를 짐작한다 — 영문·숫자·기호만 */
export function codeOf(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const sym: Record<string, string> = { '=': 'Equal', '+': 'Equal', '-': 'Minus', '`': 'Backquote', ',': 'Comma', '/': 'Slash', '?': 'Slash' };
  return sym[key] ?? '';
}

/** 윈도우 키 입력 → 같은 뜻의 맥 키(⌘…). 앱 단축키가 아니면 null — 그 키는 터미널·입력칸 몫 */
/** ⌘⇧글자로 쓰는 키 — 윈도우에선 Ctrl+Alt+글자 (Ctrl+Shift+글자는 ⇧ 없는 ⌘글자가 이미 차지) */
export const SHIFT_LETTERS = 'EWTHLD';

export function winToMac(e: KeyLike): KeyLike | null {
  if (!e.ctrlKey || e.metaKey) return null;
  const code = e.code || codeOf(e.key);
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (e.altKey) {
    if (e.shiftKey) return null;
    if (digit) return { ...mac(digit, { alt: true }), code };
    if (letter && SHIFT_LETTERS.includes(letter)) return mac(letter, { shift: true });
    return null;
  }
  if (e.shiftKey) {
    if (letter) return mac(letter.toLowerCase());
    // Ctrl+[ 는 터미널 Esc — 뒤로·앞으로는 Ctrl+Shift+[ ]
    if (code === 'BracketLeft' || code === 'BracketRight') return { ...mac(code === 'BracketLeft' ? '[' : ']'), code };
    if (code === 'Slash') return mac('/');
    if (code === 'Equal') return mac('+');
    if (code === 'Backquote') return { ...mac('`', { shift: true }), code }; // Ctrl+Shift+` = 창 크게(Ctrl+` 는 홈)
    return null;
  }
  if (letter) return null;
  if (digit) return mac(digit);
  // 숫자패드 + - 0 도 글자 크기(맥은 메뉴 ⌘+ 가 받지만 윈도우는 이 길뿐 — 2026-10-22 사용자 제보)
  const sym: Record<string, string> = { Equal: '=', Minus: '-', Backquote: '`', Comma: ',', NumpadAdd: '+', NumpadSubtract: '-', Numpad0: '0' };
  return sym[code] ? mac(sym[code]!) : null;
}

/** 화면에 적힌 맥 단축키(⌘M·⌥⌘2·⌘⇧E·⌘Enter·⌘클릭…) → 윈도우 표기. 맥이면 그대로 */
export function keyLabel(text: string, win: boolean): string {
  if (!win || !text.includes('⌘')) return text;
  return text.replace(/(⌥?)⌘(⇧?)(Enter|\+?클릭|[Cc]lick|.)?/g, (all, alt: string, shift: string, k: string | undefined) => {
    if (k === undefined) return 'Ctrl';
    if (shift && k.length === 1 && SHIFT_LETTERS.includes(k)) return `Ctrl+Alt+${k}`;
    if (k === 'Enter') return 'Ctrl+Enter';
    if (/클릭|[Cc]lick/.test(k)) return `Ctrl+${k.replace(/^\+/, '')}`;
    if (/^\s$/.test(k)) return `Ctrl${k}`;
    if (/^[A-Za-z]$/.test(k)) return `Ctrl+${alt ? 'Alt+' : ''}Shift+${k.toUpperCase()}`;
    if (k === '/' || k === '[' || k === ']') return `Ctrl+Shift+${k}`;
    if (k === '₩') return `Ctrl+${shift ? 'Shift+' : ''}\``;
    return `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${k}`;
  });
}

/** 화면 글 속 파인더·Finder → 윈도우 탐색기·File Explorer. 맥이면 그대로(조사는 둘 다 받침 없어 안 바뀐다) */
export function fileManagerLabel(text: string, win: boolean): string {
  if (!win) return text;
  return text.replace(/파인더/g, '탐색기').replace(/\bFinder\b/g, 'File Explorer');
}

/** 맥 ⌘ 자리 수정키(⌘Enter 끊고 보내기·⌘클릭 링크)가 눌렸나 — 윈도우는 Ctrl */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }, win: boolean): boolean => (win ? e.ctrlKey : e.metaKey);
