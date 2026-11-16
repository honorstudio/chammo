// 윈도우 터미널 한글 두 번(공개 이슈 #13, 0.4.13 부터) — 채팅 ↔ 터미널 보기를 한 번 오가면 WebView2 입력기가 조합(composition) 이벤트 없이
// 글자를 확정할 때 keydown(229) 뒤 keypress 로 넘긴다(WM_CHAR 길). xterm 6 은 그 글자를 두 번 보낸다:
//   ① keypress → CoreBrowserTerminal._keyPress 가 보냄(기본 동작은 안 막아서 웹뷰가 입력칸에도 넣는다)
//   ② keydown 229 → CompositionHelper._handleAnyTextareaChanges 가 0ms 뒤 입력칸 글을 비교해 늘어난 글자를 또 보냄
// 글자가 타이머보다 먼저 오면 두 번, 늦게 오면 한 번이라 '가끔 한 번'처럼 보였다.
// 고침: 229 keydown 다음의 keypress 는 xterm 이 보내게 두고 입력칸에 넣는 기본 동작만 막는다 — ②의 비교에 늘어난 게 없다.

/** 키 사건 하나 → 이 keypress 의 기본 동작(입력칸에 글자 넣기)을 막을지. 터미널 하나에 하나씩 만든다 */
export function imeKeypressGuard(): (e: { type: string; keyCode: number }) => boolean {
  let imeKey = false; // 마지막 keydown 이 입력기가 먹은 키(229)였나
  return (e) => {
    if (e.type === 'keydown') {
      imeKey = e.keyCode === 229;
      return false;
    }
    return e.type === 'keypress' && imeKey;
  };
}
