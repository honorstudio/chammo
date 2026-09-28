// 참모가 다른 세션에 시킨 일을 카드로. 참모가 `scripts/task`로 tasks.jsonl 에 이벤트를 한 줄씩 붙이고,
// 앱은 그걸 읽어 세션 상태(agents --json)와 합쳐 보여준다. 파일은 append-only — 고치지 않고 이벤트만 쌓는다.

import type { Session } from './session';

export type TaskEvent = {
  ts: string;
  /** ask = 사용자 결정을 기다림(결정 대기함에 뜸), answer = 사용자가 답함 */
  type: 'send' | 'reply' | 'done' | 'note' | 'ask' | 'answer';
  task: string;
  /** send: 대상 세션의 id 또는 이름. 그 뒤 이벤트에 있으면 대상을 그 세션으로 옮긴다(주인 잃은 일을 이어서 켰을 때) */
  target?: string;
  /** send 에만: 무엇을 시켰나 한 줄 */
  title?: string;
  note?: string;
  /** ask 에만: 답장 받을 세션(물어본 참모의 session id). 없으면 일을 받은 세션 */
  to?: string;
};

export type TaskStatus = 'sent' | 'working' | 'needsInput' | 'replied' | 'done' | 'gone';

export type TaskCard = {
  id: string;
  target: string;
  title: string;
  status: TaskStatus;
  note?: string;
  sentAt: string;
  updatedAt: string;
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
        sentAt: e.ts, updatedAt: e.ts, replied: false, finished: false,
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
export function splitCards(cards: TaskCard[], now: number): { active: TaskCard[]; orphaned: TaskCard[]; doneToday: TaskCard[]; hidden: number } {
  const d = new Date(now);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
  const active = cards.filter((c) => c.status !== 'done' && c.status !== 'gone');
  const gone = cards.filter((c) => c.status === 'gone');
  const orphaned = gone.filter((c) => now - Date.parse(c.sentAt) <= ORPHAN_DAYS * 86_400_000);
  const done = cards.filter((c) => c.status === 'done');
  const doneToday = done.filter((c) => Date.parse(c.updatedAt) >= start).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { active, orphaned, doneToday, hidden: done.length - doneToday.length + gone.length - orphaned.length };
}
