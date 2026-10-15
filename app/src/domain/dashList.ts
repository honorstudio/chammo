// 폰 대시보드 위 칸 = 한 칸 목록(시안 docs/design-drafts/phone-tabs v2 A, 2026-10-11 사용자 고름). 탭 숫자 '일 6 · 할 일 6 · 결정 2'는
// 뜻을 몰랐다 — 일 6 이 전부 끝난 일이었다. 숫자 대신 사용자가 묻는 순서로 내용을: 나한테 필요 → 지금 도는 일 → 오늘 끝남 → 다음 할 일(문서 줄)
import { needsAnswer, type DirectCard } from './directAsk';
import type { FoldCard, Waiting } from './mobile';
import type { TaskEvent } from './tasks';

/** sub = 하위 세션 물음, decide = 참모가 사용자에게 묻는 일(task ask), direct = 직접 답하기 카드(결정 대기함) */
export type NeedRow = { key: string; kind: 'sub' | 'decide' | 'direct'; name: string; line: string; target?: string };
/** dot — 일함(st-work) · 쉼(st-done, 빈 고리 — 폰 홈·보관함 v1 8 점 넷) */
export type RunRow = { key: string; name: string; line: string; dot: 'st-work' | 'st-done'; target: string };
export type DashList = { need: NeedRow[]; run: RunRow[]; more: number; done: { n: number; names: string[] } };

export const RUN_MAX = 3;
const LINE_MAX = 40;

/** 줄 글 — 회신 요약 첫마디(첫 줄, ' — '·문장 끝 앞까지), 없으면 제목을 같은 식으로 한 줄. 길면 … */
export function oneLine(note?: string, title?: string): string {
  const first = (s?: string) => {
    const line = (s ?? '').split('\n').map((x) => x.trim()).find(Boolean) ?? '';
    return line.split(/ — |\. /)[0]!.replace(/[.。]$/, '').trim();
  };
  const s = first(note) || first(title);
  return s.length > LINE_MAX ? `${s.slice(0, LINE_MAX)}…` : s;
}

/** g = orchTasks(판단 넣은 것), waiting = waitingList, direct = 그 참모 몫 직접 답하기 카드(usePhoneDirect) */
export function dashList(g: { ask: FoldCard[]; doing: FoldCard[]; done: FoldCard[] }, waiting: Waiting[], direct: DirectCard[], events: TaskEvent[], orchId: string, nameOf: (id: string) => string): DashList {
  const targetOf = new Map(events.filter((e) => e.type === 'send' && e.target).map((e) => [e.task, e.target!]));
  const decides = waiting.filter((w) => w.orch === orchId && w.kind === 'decide');
  const asked = new Set(decides.map((w) => w.taskId));
  const need: NeedRow[] = [
    // 참모가 이미 사용자에게 물은 일(task ask)이면 그 줄 하나만 — 세션 물음은 참모가 대신 정리했다
    ...g.ask.filter((c) => !asked.has(c.id)).map((c): NeedRow => ({ key: `t:${c.id}`, kind: 'sub', name: c.target, line: oneLine(c.note, c.title), target: c.target })),
    // 참모 답 끝 질문(ask)은 바로 아래 채팅에 있고, 확인창 멈춤(blocked)은 맥에서 고를 일이라 뺀다 — 사용자가 답할 일(task ask)만
    ...decides.map((w): NeedRow => {
      const target = w.taskId ? targetOf.get(w.taskId) : undefined;
      return { key: `w:${w.taskId ?? w.ts}`, kind: 'decide', name: target ?? w.name, line: oneLine(w.q), ...(target ? { target } : {}) };
    }),
    ...direct.filter(needsAnswer).map((c): NeedRow => ({ key: `d:${c.id}`, kind: 'direct', name: nameOf(c.from), line: oneLine(c.q) })),
  ];
  const run = g.doing.map((c): RunRow => ({
    key: `t:${c.id}`, name: c.target, line: oneLine(c.note, c.title), target: c.target,
    dot: (c.live ? c.live === 'working' : c.status === 'working') ? 'st-work' : 'st-done',
  }));
  return { need, run: run.slice(0, RUN_MAX), more: Math.max(0, run.length - RUN_MAX), done: { n: g.done.length, names: g.done.slice(0, 2).map((c) => c.target) } };
}
