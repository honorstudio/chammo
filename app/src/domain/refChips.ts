// 입력칸 참조 넓히기(2026-10-23 사용자 폰) — #task1 = 진행 칸의 일 하나, #goal1 = 목표 줄 전체, 폰 말풍선도 #chat1.
// 일·목표는 이름표 뒤 따옴표 안에 참모가 바로 찾을 글(task id·세션·상태)로 풀려 간다 — 풀기는 chat.ts withRefs
import { tr } from '../i18n';
import type { ChatRef } from './chat';

export type RefKind = 'chat' | 'task' | 'goal';
export type RefJob = { title: string; task: string; target: string; state: string };

const GOAL_JOBS = 6;

/** 그 종류 다음 이름표 — 남은 것 중 가장 큰 번호 + 1(floor = 지금까지 매긴 번호, 지웠다 다시 넣어도 겹치지 않게) */
export function nextRefLabel(refs: ChatRef[], kind: RefKind, floor = 0): string {
  const re = new RegExp(`^[#@]${kind}(\\d+)$`);
  const top = Math.max(floor, ...refs.map((r) => Number(r.label.match(re)?.[1] ?? 0)));
  return `#${kind}${top + 1}`;
}

/** 일 하나 — 제목 (task id, 세션, 상태) */
export const taskRefText = (j: RefJob) => `${j.title} (task ${j.task}, ${j.target}, ${j.state})`;

/** 목표 줄 전체 — 이름 (목표 끝/전체 — 일마다 제목 task id 세션 상태; …), 일은 6개까지 */
export function goalRefText(g: { name: string; done: number; total: number; jobs: RefJob[] }): string {
  const jobs = g.jobs.slice(0, GOAL_JOBS).map((j) => `${j.title} task ${j.task} ${j.target} ${j.state}`).join('; ');
  const more = g.jobs.length > GOAL_JOBS ? tr(` 외 ${g.jobs.length - GOAL_JOBS}`, ` +${g.jobs.length - GOAL_JOBS} more`) : '';
  return `${g.name} (${tr('목표', 'goal')} ${g.done}/${g.total} ${tr('끝', 'done')}${jobs ? ` — ${jobs}` : ''}${more})`;
}

/** 말풍선 참조 이름 — 내 말 / 답 + 시각(데스크톱·폰 같은 이름) */
export function bubbleWho(mine: boolean, ts: string): string {
  const d = new Date(ts);
  const at = Number.isNaN(d.getTime()) ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return mine ? tr(`내 말${at}`, `Me${at}`) : tr(`답${at}`, `Reply${at}`);
}
