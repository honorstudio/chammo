// 채팅 판이 뒤 터미널(Claude Code) 입력칸을 다루는 셈 — 화면 읽기(promptInput)는 믿을 수 없을 때가 있다.
// Claude 는 입력칸이 길면 끝 8줄쯤만 보여 주고, 터미널 줄이 모자라면 입력칸 아래 선까지 화면 밖이라 아예 못 읽는다(null).
// 좁은 떠 있는 대화창에 긴 한글 경로를 붙이면 바로 그렇게 된다(2026-11-01 사용자 '#file1 세 번, 하나는 중간에서 잘림' — tmux 실측)

/** 입력칸을 비울 Backspace 수 — 읽은 글(잘려 보일 수 있다)과 앱이 붙여 넣은 글 중 긴 쪽 + 여유 20(그림 표시 [Image #n] 같은 것). 남는 Backspace 는 빈 칸에서 아무 일도 안 한다 */
export const clearCount = (read: string, pasted: number): number => Math.max([...read].length, pasted) + 20;

/** 입력칸이 빈 걸 연달아 본 횟수 — 다 보이고 비었을 때('')만 하나 더. 글이 보이거나 못 읽음(null)·잠깐 안 읽음(undefined)이면 0 부터 다시
 *  (그대로 두면 붙이기 전에 쌓인 횟수로 곧장 '비었다'가 됐다 — 하네스 재현) */
export const nextEmpties = (prev: number, read: string | null | undefined): number => (read === '' ? prev + 1 : 0);
