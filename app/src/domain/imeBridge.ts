// WKWebView는 한글 입력기를 composition 이벤트 없이 "텍스트칸 글자 바꿔치기"로 처리한다
// (ㅇ→아→앙→아+아). xterm.js는 composition을 기다리다 첫 자모만 보내고 나머지를 놓친다.
// 그래서 한글이 섞인 입력은 xterm에 맡기지 않고, 이벤트 전후 텍스트를 비교해
// "지운 만큼 DEL + 새로 생긴 글자"로 pty에 직접 보낸다. (트러블슈팅 #99)

export type InputDiff = { del: number; ins: string };

const NON_ASCII = /[^\x00-\x7f]/;

export const hasNonAscii = (s: string): boolean => NON_ASCII.test(s);

/** 웹뷰가 끝 공백을 NBSP로 넣었다가 나중에 일반 공백으로 바꾼다 — 비교 전에 같게 만든다 */
export const normalizeInput = (v: string): string => v.replace(/ /g, ' ');

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** prev → now 로 바뀌었을 때 pty에 보낼 삭제 수(코드포인트 단위)와 새 글자 */
export function diffInput(prev: string, now: string): InputDiff {
  let i = 0;
  while (i < prev.length && i < now.length && prev[i] === now[i]) i++;
  // 공통 접두가 서로게이트 쌍 한가운데서 끊기면 그 글자 전체를 다시 보낸다
  if (i > 0 && isHighSurrogate(prev.charCodeAt(i - 1))) i--;
  return { del: [...prev.slice(i)].length, ins: now.slice(i) };
}

export const toSequence = ({ del, ins }: InputDiff): string => '\x7f'.repeat(del) + ins;

// 수식키·입력기 전환키는 그 자체로 글자를 만들지 않는다. 이걸 "xterm 몫"으로 치면 조합이 끊긴다
// (실사용 버그 2026-09-26: Shift+ㅅ=ㅆ 받침을 치려는 순간 Shift keydown이 조합을 끊어 "있"이 "이ㅆ"가 됐다)
const NON_TEXT_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'Lang1', 'Lang2', 'HangulMode', 'Process', 'Dead']);

/** 이 keydown 뒤의 입력을 xterm에 넘길지. false면 한글 다리가 계속 맡는다(조합 유지) */
export function yieldsToXterm(e: { key: string; keyCode: number }): boolean {
  if (e.keyCode === 229) return false; // 입력기 조합 중
  return !NON_TEXT_KEYS.has(e.key);
}
