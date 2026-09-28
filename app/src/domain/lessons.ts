// 프로젝트 교훈 — 하위 세션이 겪어서 확인된 함정. `scripts/task lesson` 이 <데이터 폴더>/lessons/<프로젝트>.md 에 '- ' 줄로 쌓고,
// `task send` 가 그 프로젝트 지시마다 붙인다(_common.md 는 모든 프로젝트). 메모 창 '교훈' 탭에서 보고 지우고 공통으로 올린다.
// 쌓이기만 하면 지시가 무거워진다 — 끝난 할 일·중복을 사람이 걸러 낼 자리(2026-09-29)

export const COMMON = '_common';

export const parseLessons = (file: string): string[] =>
  file.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());

/** 그 교훈 줄 하나(처음 나온 것)만 뺀다. 나머지 줄은 손대지 않는다 */
export function removeLesson(file: string, lesson: string): string {
  const lines = file.split('\n');
  const i = lines.findIndex((l) => l.startsWith('- ') && l.slice(2).trim() === lesson);
  if (i < 0) return file;
  return [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
}

export function addLesson(file: string, lesson: string): string {
  if (parseLessons(file).includes(lesson)) return file;
  const base = file && !file.endsWith('\n') ? file + '\n' : file;
  return `${base}- ${lesson}\n`;
}
