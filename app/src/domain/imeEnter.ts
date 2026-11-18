// 한글 조합 뒤 Enter 한 번에 새 줄(11-05 사용자 "두 번 쳐야 내려간다") — 판단만 여기, 편집기 쪽은 ui/space/imeEnter
// ProseMirror 는 사파리(맥 앱 WKWebView 도 사파리로 잡힌다)에서 조합이 끝나고 0.5초 안에 온 Enter 를 버린다 — 일본어 입력기는 Enter 가
// '변환 확정'이라서. 한글은 Enter 가 확정 + 새 줄이라 첫 Enter 가 확정으로만 먹혔다. 그래서 Enter 가 실제로 아무 일도 안 했을 때만 한 번 대신 친다

/** 한글 자모·완성형이 들었나(첫가끝 자모·호환 자모·완성형·확장 자모) */
export const hasHangul = (s: string | null | undefined): boolean => !!s && /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7A3\uD7B0-\uD7FF]/.test(s);

/** 맨 Enter — ⇧·⌘·⌥·⌃ 가 섞이면 다른 뜻(줄 안 바꿈·보내기 등)이라 손대지 않는다 */
export const isPlainEnter = (e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'altKey' | 'ctrlKey'>): boolean =>
  e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey;

/** ProseMirror 가 그 Enter keydown 을 버리나 — 조합 중이거나, WebKit 에서 조합이 끝나고 500ms 안(prosemirror-view inOrNearComposition 과 같은 규칙) */
export const pmSwallows = (s: { composing: boolean; webkit: boolean; sinceEnd: number }): boolean => s.composing || (s.webkit && s.sinceEnd < 500);

/** 대신 칠까 — 한글 조합에 붙어 버려진 Enter 인데 커서 블록도 블록 수도 그대로(= 줄이 안 바뀜)일 때만. 이미 바뀌었으면 두 줄 내려가지 않게 안 친다 */
export function replayEnter(s: { hangul: boolean; swallowed: boolean; sameBlock: boolean; sameCount: boolean }): boolean {
  return s.hangul && s.swallowed && s.sameBlock && s.sameCount;
}

/**
 * 조합 확정 때 ProseMirror 가 지어낸 Enter 인가(11-17 사용자 "번호 목록 새 항목에서 한글 첫 글자가 따로 한 항목으로 떨어진다").
 * 맥 WebKit 은 하위 블록의 유일한 글이 조합 글이면 확정 직전 deleteCompositionText 로 그 블록 DIV 를 통째로 빼고 <br> 을 넣는다.
 * ProseMirror 는 그 DOM 바뀜을 'Enter 를 누른 것 같다'(looksLikeEnter)로 읽어 가짜 Enter 를 치고 항목이 갈린다 — 확정 글은 새 항목에 다시 들어간다.
 * 조합 중이고, 방금(150ms) 진짜 Enter 키가 없었고, 그 줄 글이 조합 글 그대로일 때만 가짜로 본다 — 진짜 Enter 는 키 사건이 먼저 온다
 */
export function fakeCompositionEnter(s: { composing: boolean; sinceRealEnter: number; blockText: string; composed: string }): boolean {
  return s.composing && s.sinceRealEnter > 150 && s.composed !== '' && s.blockText === s.composed;
}

/**
 * 한글 확정 직후 Tab·Shift+Tab 을 대신 칠까 — 같은 사파리 규칙이 0.5초 안 모든 키를 버려서, 목록 Enter 뒤 바로 Tab 을 치면 들여쓰기 대신
 * 웹뷰 기본 Tab(초점 옮기기)이 돌아 커서가 편집기 밖으로 나갔다. 조합 중이 아니고 그 0.5초 안일 때만(그 밖은 ProseMirror 가 받는다)
 */
export const replayTab = (s: { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; composing: boolean; hangul: boolean; sinceEnd: number }): boolean =>
  s.key === 'Tab' && !s.altKey && !s.metaKey && !s.ctrlKey && !s.composing && s.hangul && s.sinceEnd < 500;
