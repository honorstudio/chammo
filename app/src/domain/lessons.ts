// 프로젝트 교훈 — 하위 세션이 겪어서 확인된 함정. `scripts/task lesson` 이 <데이터 폴더>/lessons/<프로젝트>.md 에 '- ' 줄로 쌓고,
// `task send` 가 그 프로젝트 지시마다 붙인다(_common.md 는 모든 프로젝트). 메모 창 '교훈' 탭에서 보고 지우고 공통으로 올린다.
// 쌓이기만 하면 지시가 무거워진다 — 끝난 할 일·중복을 사람이 걸러 낼 자리(2026-09-29)

import { tr } from '../i18n';

export const COMMON = '_common';
/** scripts/task 의 LESSON_MAX — 넘으면 지시마다 통째로 붙어 무겁다 */
export const LESSON_MAX = 12;

/** 메모 창 [스킬로 묶기] 를 보일까 — 프로젝트 교훈이 많을 때만. 공통 칸 스킬은 2단계(전역 스킬은 사람 확인 뒤에만) */
export const shouldGroup = (project: string, n: number): boolean => project !== COMMON && n > LESSON_MAX;

/** 참모에게 보낼 부탁 — 참모가 묶음을 짜서 사람에게 안 묻고 바로 스킬로 묶고 결과 한 줄만 보고한다. 버리기만 카드(2026-10-08, docs/plans/2026-10-06-self-learning.md) */
export const groupRequest = (project: string, n: number): string =>
  tr(
    `${project} 교훈이 ${n}줄이야 — scripts/task lesson-review ${project} 로 보고 같은 주제끼리 lesson-group 으로 알아서 스킬로 묶어 줘. 나한텐 결과 한 줄만 말해. 버릴 것만 lesson-drop 카드로 물어.`,
    `${project} has ${n} lessons — look at them with scripts/task lesson-review ${project} and group lines on one topic into skills yourself with lesson-group. Tell me just one line about the result. Only ask me, with a lesson-drop card, about what to discard.`,
  );

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
