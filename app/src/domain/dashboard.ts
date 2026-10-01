// 채팅 뷰 대시보드 — 사용자가 참모에게 시킨 일(과 그 아래 맡긴 세션), 주고받은 파일(2026-09-30 사용자: v5)
import type { ShowAt } from './showAt';
import type { ChatItem } from './chat';
import { asksUser } from './status';
import { shownFiles } from './spaceNav';
import type { TaskEvent } from './tasks';

export type DashSub = { target: string; title: string; done: boolean };
export type DashRequest = { id: string; ts: string; text: string; status: 'doing' | 'ask' | 'done'; subs: DashSub[] };

/** 사용자 요청(사람 말풍선)마다 — 다음 요청 전까지의 참모 답·맡긴 일로 상태를 매긴다. 최근 것이 위로 */
export function dashRequests(items: ChatItem[], events: TaskEvent[], orchId: string, max = 20): DashRequest[] {
  const done = new Set(events.filter((e) => e.type === 'done').map((e) => e.task));
  const users = items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === 'user');
  const out: DashRequest[] = [];
  users.forEach(({ it, i }, k) => {
    const u = it as Extract<ChatItem, { kind: 'user' }>;
    const endIdx = users[k + 1]?.i ?? items.length;
    const until = users[k + 1] ? (users[k + 1]!.it as { ts: string }).ts : '￿';
    const replies = items.slice(i + 1, endIdx).filter((x): x is Extract<ChatItem, { kind: 'assistant' }> => x.kind === 'assistant');
    const last = replies[replies.length - 1];
    const subs = events
      .filter((e) => e.type === 'send' && e.target && (!e.from || e.from === orchId) && e.ts >= u.ts && e.ts < until)
      .map((e) => ({ target: e.target!, title: e.title ?? '', done: done.has(e.task) }));
    const status: DashRequest['status'] = last && asksUser(last.text) ? 'ask' : !last || subs.some((s) => !s.done) ? 'doing' : 'done';
    out.push({ id: u.id, ts: u.ts, text: u.text || '(그림)', status, subs });
  });
  return out.reverse().slice(0, max);
}

export type DashFile = { path: string; ts: string; by: string; /** 화면에 보일 누가(세션 이름) */ byName?: string; /** 짚어 보여 줄 곳(scripts/show --line 등) */ at?: ShowAt };

/** 이 참모·맡긴 세션이 보여 준 파일(scripts/show) + 사용자가 채팅에 붙인 그림 — 최근 순. by = 세션 id, 사용자가면 'me' */
export function dashFiles(showLog: string, orchId: string, heldIds: string[], myImages: { ts: string; src: string }[]): DashFile[] {
  const files: DashFile[] = [];
  for (const id of [orchId, ...heldIds]) for (const f of shownFiles(showLog, id)) files.push({ ...f, by: id });
  for (const im of myImages) files.push({ path: im.src, ts: im.ts, by: 'me' });
  return files.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
}
