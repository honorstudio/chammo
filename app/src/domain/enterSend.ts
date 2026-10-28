/**
 * 보내기 입력칸의 Enter — 팀 메신저 '해결' 다음 '해결해결'(10-28 팀원): 한글을 치다 Enter 로 보내면 비운 입력칸에
 * 방금 보낸 글이 통째로 되살아나 다음 말에 붙어 나갔다('대화' 두 번도 같은 모양). 맥 웹뷰(WebKit)는 조합을 끝내는 Enter 를
 * compositionend 뒤에 isComposing=false·keyCode 229 로 줘서(WebKit 버그 165004) 입력기가 글을 넣는 도중에 칸을 비웠다.
 * 기본 입력기가 바꿔치기(insertReplacementText)로 넣는 macOS 26 에선 안 난다 — 조합형 입력기에서 나는 모양이라 두 겹으로 막는다
 */

export type EnterKey = { key: string; keyCode: number; isComposing: boolean; shiftKey: boolean };

/** send = 지금 보냄 · defer = 입력기가 아직 글을 넣는 중(229) — 다음 차례에 보냄 · skip = 안 보냄(조합 중·줄바꿈·다른 키) */
export function enterAction(e: EnterKey): 'send' | 'defer' | 'skip' {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return 'skip';
  return e.keyCode === 229 ? 'defer' : 'send';
}

/** 보낸 글이 되살아나는 건 보낸 직후 빈 칸에 한 번에 통째로 — 사람이 같은 말을 다시 치면 한 글자씩 자라고 시간이 걸린다 */
const ECHO_MS = 1500;

/** 칸에 들어온 글(value, 바로 앞 글 prev)이 방금 보낸 글이 되살아난 것인가. 한 글자 말은 한 번에 쳐도 같은 모양이라 안 본다 */
export function echoOfSent(value: string, prev: string, sent: { text: string; at: number } | null, now: number): boolean {
  const t = sent?.text.trim() ?? '';
  return !!sent && now - sent.at <= ECHO_MS && !prev.trim() && [...t].length >= 2 && value.trim() === t;
}
