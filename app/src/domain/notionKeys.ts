// 문서 편집기 키를 노션 공식 단축키 표에 맞춘 것(11-17 사용자 "거의 유사한데 뭔가 약간 달라" — 표 docs/design-drafts/editor-keys/notion-diff.md) — 판단만 여기, 편집기 쪽은 ui/space/notionKeys

/** ⌘⌥숫자 = 블록 종류(노션 표: 4 할 일·5 점·6 번호·7 토글·8 코드). 0·1~3 은 BlockNote 기본(글·제목)이 이미 같다, 9(페이지)는 파일을 만드는 일이라 안 단다 */
export const TYPE_KEYS: Record<string, string> = { '4': 'checkListItem', '5': 'bulletListItem', '6': 'numberedListItem', '7': 'toggleListItem', '8': 'codeBlock' };

/** 줄 맨 앞 단축 입력 중 BlockNote 에 없는 것 — 'a. '·'i. ' = 번호 목록, '> ' = 토글(노션 — 인용은 '" ') */
export const SHORTCUTS: { find: RegExp; type: string }[] = [
  { find: /^\s?[ai]\.\s$/, type: 'numberedListItem' },
  { find: /^>\s$/, type: 'toggleListItem' },
];

/** ⌘Enter 가 할 일 — 체크 뒤집기 / 토글 열고 닫기 / 그 밖은 기본에 맡김 */
export const cmdEnterAct = (type: string, toggleable: boolean): 'check' | 'fold' | null =>
  type === 'checkListItem' ? 'check' : type === 'toggleListItem' || toggleable ? 'fold' : null;
