// 글 파일(.txt) 편집 — 열어 둔 사이 바깥(참모·세션·다른 앱)이 파일을 고쳤을 때 어떻게 할지.
// md 편집기(docSync)처럼 모르는 판을 덮지 않는다 — 다만 글 파일은 블록이 없어서 블록 합치기 없이 통째로 고른다.
//   same     바깥 판 = 내가 아는 판 (할 일 없음)
//   take     내가 안 고쳤다 → 바깥 판을 편집칸에 그대로 받는다
//   adopt    내가 고친 것과 바깥 판이 같아졌다 → 아는 판만 바꾼다
//   conflict 둘 다 다르게 고쳤다 → 저장을 멈추고 사람이 고른다(진 판은 history 에)
export type OutsideStep = 'same' | 'take' | 'adopt' | 'conflict';

export function outsideStep(base: string, mine: string, theirs: string): OutsideStep {
  if (theirs === base) return 'same';
  if (mine === base) return 'take';
  if (mine === theirs) return 'adopt';
  return 'conflict';
}

/** 편집칸(textarea)은 줄바꿈을 LF 로 맞춰 준다 — CRLF 파일이면 칸엔 LF 로 보이고 저장할 때 다시 CRLF 로 */
export function splitEol(file: string): { text: string; crlf: boolean } {
  const crlf = file.includes('\r\n');
  return { text: crlf ? file.replace(/\r\n/g, '\n') : file, crlf };
}
export const joinEol = (text: string, crlf: boolean) => (crlf ? text.replace(/\n/g, '\r\n') : text);
