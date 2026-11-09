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
