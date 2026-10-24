// 폰 종 = 알림 보기(시안 docs/design-drafts/phone-nav v1 N, 2026-10-24) — '최근' 칸.
// 폰엔 받은 알림 기록이 따로 없어서, 이 참모가 맡긴 일의 끝남·물음을 작업 기록(tasks)에서 만든다
import type { TaskEvent } from './tasks';

export type AlertRow = { key: string; task: string; kind: 'done' | 'ask'; target: string; line: string; at: number };

const DAYS = 3;
const MAX = 8;

/** 이 참모(orchId)가 맡긴 일의 끝남·물음 — 3일 안, 새것이 위, 여덟 줄까지 */
export function recentAlerts(events: TaskEvent[], orchId: string, now: number): AlertRow[] {
  const sent = new Map<string, TaskEvent>();
  for (const e of events) if (e.type === 'send' && e.from === orchId) sent.set(e.task, e);
  const rows: AlertRow[] = [];
  events.forEach((e, i) => {
    if (e.type !== 'done' && e.type !== 'ask') return;
    const s = sent.get(e.task);
    const at = Date.parse(e.ts);
    if (!s || !(now - at < DAYS * 86_400_000)) return;
    const title = s.title ?? '맡긴 일';
    const line = e.type === 'done' ? `${title} 끝남${e.note ? ` — ${e.note}` : ''}` : (e.note || title);
    rows.push({ key: `${e.task}:${e.type}:${i}`, task: e.task, kind: e.type, target: s.target ?? '', line, at });
  });
  return rows.sort((a, b) => b.at - a.at).slice(0, MAX);
}

/** 종 숫자 — 내 답을 기다리는 것(답 기다림 + 답할 카드) */
export const alertCount = (waiting: number, cards: number) => waiting + cards;
