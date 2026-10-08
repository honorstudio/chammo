// 참모가 다른 세션에 시킨 일을 카드로. 참모가 `scripts/task`로 tasks.jsonl 에 이벤트를 한 줄씩 붙이고,
// 앱은 그걸 읽어 세션 상태(agents --json)와 합쳐 보여준다. 파일은 append-only — 고치지 않고 이벤트만 쌓는다.

import { tr } from '../i18n';
import type { Session } from './session';

export type TaskEvent = {
  ts: string;
  /** ask = 사용자 결정을 기다림(결정 대기함에 뜸), answer = 사용자가 답함 */
  /** own = 누가 시켰는지 안 남은 옛 일에 사용자가 주인 참모를 붙임(채팅 뷰 대시보드, from 에 그 참모) */
  type: 'send' | 'reply' | 'done' | 'note' | 'ask' | 'answer' | 'own';
  task: string;
  /** send: 대상 세션의 id 또는 이름. 그 뒤 이벤트에 있으면 대상을 그 세션으로 옮긴다(주인 잃은 일을 이어서 켰을 때) */
  target?: string;
  /** send 에만: 시킨 참모(백그라운드 세션 id) — 채팅 뷰 스페이스가 참모별로 가른다(2026-09-30~, 옛 기록엔 없음) */
  from?: string;
  /** send·own: 시킨 참모의 기본 이름(참모-3) — 되살리면 id 가 바뀌어서(2026-10-04~, 옛 기록엔 없음) */
  fromName?: string;
  /** send 에만: 대상 세션의 프로젝트(dev 아래 폴더) — 맡은 일 자동 추론용(2026-10-04~, 옛 기록엔 없음) */
  project?: string;
  /** send 에만: 무엇을 시켰나 한 줄 */
  title?: string;
  note?: string;
  /** ask 에만: 답장 받을 세션(물어본 참모의 session id). 없으면 일을 받은 세션 */
  to?: string;
  /** send 에만: 검증 강도 — scripts/task 가 지시 내용으로 정한다(2026-09-29~, 옛 기록엔 없음) */
  effort?: Effort;
  /** answer 에만: 어디서 답했나 — phone = 폰 결정 카드(/api/task-answer, 2026-10-06~). 데스크톱 답엔 없음 */
  by?: 'phone';
  /** note 에만: task retry 로 되돌려 보낸 몇 번째인지 */
  retry?: number;
};

export type Effort = 'high' | 'medium' | 'low';

export type TaskStatus = 'sent' | 'working' | 'needsInput' | 'replied' | 'done' | 'gone';

export type TaskCard = {
  id: string;
  target: string;
  title: string;
  status: TaskStatus;
  note?: string;
  sentAt: string;
  updatedAt: string;
  effort?: Effort;
  /** 되돌려 보낸 횟수 — 세 번이면 계획이 틀린 것(Loops and Graphs) */
  retries?: number;
};

/** 깨진 줄은 건너뛴다 — 참모가 쓰는 도중에 앱이 읽을 수 있다 */
export function parseTaskLog(text: string): TaskEvent[] {
  const out: TaskEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as TaskEvent;
      if (e && typeof e.task === 'string' && typeof e.type === 'string') out.push(e);
    } catch {
      // 쓰는 중인 마지막 줄 — 다음 폴링에서 다시 읽힌다
    }
  }
  return out;
}

export function foldTasks(events: TaskEvent[], sessions: Session[]): TaskCard[] {
  type Acc = TaskCard & { replied: boolean; finished: boolean };
  const byId = new Map<string, Acc>();
  for (const e of events) {
    if (e.type === 'send') {
      byId.set(e.task, {
        id: e.task, target: e.target ?? '', title: e.title ?? '', status: 'sent',
        sentAt: e.ts, updatedAt: e.ts, replied: false, finished: false, retries: 0,
        ...(e.effort ? { effort: e.effort } : {}),
      });
      continue;
    }
    const c = byId.get(e.task);
    if (!c) continue;
    c.updatedAt = e.ts;
    if (e.note) c.note = e.note;
    if (e.target) c.target = e.target;
    if (e.type === 'reply') c.replied = true;
    if (e.type === 'done') c.finished = true;
    if (e.retry) c.retries = Math.max(c.retries ?? 0, e.retry);
  }

  const cards = [...byId.values()].map(({ replied, finished, ...c }): TaskCard => {
    const s = sessions.find((x) => x.id === c.target || x.name === c.target);
    let status: TaskStatus;
    if (finished) status = 'done';
    else if (!s) status = 'gone';
    else if (s.state === 'working') status = 'working';
    else if (s.state === 'blocked') status = 'needsInput';
    else status = replied ? 'replied' : 'sent';
    return { ...c, status };
  });
  return cards.sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
}

/** 주인 잃은 일을 보여 주는 기간 — 그보다 오래된 건 숨긴다 */
const ORPHAN_DAYS = 7;

/**
 * 작업 패널 나누기 — 진행 중(안 끝남) / 주인 잃은 일(세션이 사라졌는데 안 끝남, 7일 안) /
 * 오늘 끝난 일(새벽 5시부터, 최근 위) / 그보다 오래된 건 패널에서 뺀다(hidden 개수만).
 * 끝난 카드가 끝없이 쌓여 급한 게 안 보이던 것(2026-09-27 사용자). 세션 없음을 끝난 일에 섞었더니
 * 재시작으로 죽은 일 3건이 묻혔다(2026-09-27) — 그래서 따로 뺀다
 */
export function splitCards(cards: TaskCard[], now: number): { active: TaskCard[]; superseded: TaskCard[]; orphaned: TaskCard[]; doneToday: TaskCard[]; hidden: number } {
  const d = new Date(now);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
  const open = cards.filter((c) => c.status !== 'done' && c.status !== 'gone');
  // 세션은 한 번에 한 가지 — 같은 세션에 더 새 일이 갔으면 앞의 안 닫힌 일은 '끝 기록 없는 일'(2026-09-29 사용자: 계속 쌓이기만)
  const newest = new Map<string, string>();
  for (const c of cards) if ((newest.get(c.target) ?? '') < c.sentAt) newest.set(c.target, c.sentAt);
  const superseded = open.filter((c) => c.sentAt < newest.get(c.target)!);
  const active = open.filter((c) => !superseded.includes(c));
  const gone = cards.filter((c) => c.status === 'gone');
  const orphaned = gone.filter((c) => now - Date.parse(c.sentAt) <= ORPHAN_DAYS * 86_400_000);
  const done = cards.filter((c) => c.status === 'done');
  const doneToday = done.filter((c) => Date.parse(c.updatedAt) >= start).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { active, superseded, orphaned, doneToday, hidden: done.length - doneToday.length + gone.length - orphaned.length };
}

/**
 * 줄 옆 작은 태그 — 꼼꼼히(검증 세게)·빠르게(스케치). 보통은 기본이라 안 단다(잡음).
 * 되돌림은 두 번부터 보이고 세 번이면 급함: 네 번째를 보내지 말고 계획을 다시 볼 때
 */
export function taskTags(c: TaskCard): { text: string; hot: boolean }[] {
  const out: { text: string; hot: boolean }[] = [];
  if (c.effort === 'high') out.push({ text: tr('꼼꼼히', 'Careful'), hot: false });
  if (c.effort === 'low') out.push({ text: tr('빠르게', 'Quick'), hot: false });
  const n = c.retries ?? 0;
  if (n >= 3) out.push({ text: tr(`되돌림 ${n} · 계획 다시`, `Sent back ${n} · rethink`), hot: true });
  else if (n >= 2) out.push({ text: tr(`되돌림 ${n}`, `Sent back ${n}`), hot: false });
  return out;
}
