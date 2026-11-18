// 문서 목록 지우기·빠져나오기를 노션처럼(11-17 사용자 '새 문서 9.md' — 2번 항목 Backspace 에 1번 줄 끝으로 올라감, 하위 빈 항목을 못 빠져나옴) — 판단만 여기, 편집기 쪽은 ui/space/listBackspace
// 목록 항목 맨 앞 Backspace·빈 항목 Enter: 하위면 한 단계 바깥(Shift+Tab 과 같다), 맨 바깥이면 목록 표시만 빼고 보통 글 줄 — 커서는 그 줄에 그대로.
// 보통 글 줄이 된 뒤 Backspace 는 편집기 기본(윗줄과 합치기). 한글 조합 중엔 끼어들지 않는다(조합 글 지우기는 입력기 몫)

export const LIST_TYPES = new Set(['numberedListItem', 'bulletListItem', 'checkListItem', 'toggleListItem']);

export type ListKeyAct = 'unnest' | 'toParagraph' | null;

export function listKeyAct(s: { key: 'Backspace' | 'Enter'; composing: boolean; selectionEmpty: boolean; type: string; atStart: boolean; empty: boolean; nested: boolean }): ListKeyAct {
  if (s.composing || !s.selectionEmpty || !LIST_TYPES.has(s.type)) return null;
  if (s.key === 'Backspace' ? !s.atStart : !s.empty) return null; // 글 가운데 Backspace·글 있는 줄 Enter 는 기본(글자 지우기·항목 나누기)
  return s.nested ? 'unnest' : 'toParagraph';
}
