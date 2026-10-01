// Claude Code 는 마우스 추적 모드를 켜서 드래그를 직접 받고, 선택을 끝내면 OSC 52
// (`ESC ] 52 ; c ; <base64> BEL`)로 "이 글자를 클립보드에 넣어라"를 보낸다.
// xterm.js 는 이걸 기본으로 처리하지 않아서 복사가 안 됐다. 여기서 풀고, ⌘C 를 어떻게 다룰지 정한다.
import { codeOf } from './keys';

/** OSC 52 본문(`<선택 대상>;<base64>`)에서 클립보드에 넣을 글자. 읽기 요청·빈 값·깨진 값은 null */
export function parseOsc52(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi < 0) return null;
  const payload = data.slice(semi + 1);
  // '?' 는 클립보드 읽기 요청 — 세션이 사용자 클립보드를 읽어가게 두지 않는다
  if (payload === '' || payload === '?') return null;
  try {
    const bin = atob(payload);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

type KeyLike = { key: string; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean };

/**
 * ⌘C 를 어떻게 할지. copySelection = xterm 선택(⌥+드래그)을 복사, swallow = 아무것도 안 하고 삼킨다.
 * 삼키는 이유: 드래그 복사는 OSC 52 로 이미 끝났는데, 편집 메뉴로 넘기면 복사할 게 없어서 삑 소리가 난다
 */
export function copyKeyAction(e: KeyLike, hasSelection: boolean): 'copySelection' | 'swallow' | null {
  if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return null;
  if (e.key !== 'c' && e.key !== 'ㅊ') return null; // 한글 입력 상태에선 ㅊ 으로 들어온다
  return hasSelection ? 'copySelection' : 'swallow';
}

/**
 * 윈도우 터미널의 복사·붙여넣기(윈도우 터미널 앱 관례). copy = 선택 복사, swallow = 삼킨다, paste = xterm 은 건너뛰고
 * 웹뷰가 붙여넣게 둔다(xterm 이 paste 이벤트로 받는다). Ctrl+C 는 선택이 없으면 null — 터미널로 가 Claude 를 멈춘다.
 * 한글 입력 상태에서도 되게 키 자리(code)로 본다. 그림 붙여넣기는 Claude 의 윈도우 키 Alt+V 라 건드리지 않는다
 */
export function winTermKey(e: KeyLike & { code?: string }, hasSelection: boolean): 'copy' | 'swallow' | 'paste' | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const code = e.code || codeOf(e.key);
  if (code === 'KeyC') return hasSelection ? 'copy' : e.shiftKey ? 'swallow' : null;
  if (code === 'KeyV') return 'paste';
  return null;
}
