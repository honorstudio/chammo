// 넘겨받은 참모가 사람에게 직접 묻지 않게 — 질문은 넘긴 참모가 모아서 한 번(2026-10-28 사용자 제보: 비서에게 시켰는데 영업 담당이 직접 물어
// 같은 걸 두 번 답했다). 넘긴 참모의 말로만 깬 턴의 답 끝 질문은 그 참모에게 한 말이라 결정 대기함·알림·폰 카드에 안 띄운다.
// 깬 말이 전부 참모인가는 음성과 같은 판단(voice fromOrchTurn), 거기에 '누가 누구에게 넘겼나'만 더한다 — 넘긴 쪽이 받은 쪽 질문으로 깬 턴은 사람에게 묻는 길이라 살린다
import type { Activity } from './activity';
import type { ChatItem } from './chat';
import { splitOrchName } from './orchLabel';
import type { TaskEvent } from './tasks';
import { fromOrchTurn } from './voice';

const base = (name: string) => splitOrchName(name).base;
const DAY = 86_400_000;

/** giver 가 taker 에게 일을 준 쪽인가 — 최근 days 일 둘 사이 마지막 넘김(handover · 참모에게 보낸 send)의 방향. 이름은 기본 이름(참모-2) */
export function gaveTo(events: TaskEvent[], giver: string, taker: string, now: number, days = 7): boolean {
  let last: boolean | undefined;
  for (const e of events) {
    if ((e.type !== 'send' && e.type !== 'handover') || !e.fromName || Date.parse(e.ts) < now - days * DAY) continue;
    const to = e.type === 'handover' ? (e.toName ?? base(e.target ?? '')) : base(e.target ?? '');
    if (e.fromName === giver && to === taker) last = true;
    else if (e.fromName === taker && to === giver) last = false;
  }
  return last === true;
}

/** 이 참모(me — 세션 이름) 턴을 깨운 말(woke)이 전부 이 참모에게 일을 넘긴 참모의 말인가. 기록이 없으면 거짓(질문을 잃는 것보다 두 번 보이는 게 낫다) */
export function handedTurn(woke: string[] | undefined, me: string, events: TaskEvent[], now: number): boolean {
  if (!fromOrchTurn({ ts: '', text: '', woke })) return false;
  return woke!.every((w) => gaveTo(events, base(w), base(me), now));
}

/** 이 참모가 일을 넘긴 참모들의 말로만 깬 턴 — 받은 쪽 보고·질문을 받아 사람에게 모아 묻는 길. 음성은 이때만 참모끼리 턴을 버리지 않는다(기록 없으면 거짓 = 조용히) */
export function giverTurn(woke: string[] | undefined, me: string, events: TaskEvent[], now: number): boolean {
  if (!fromOrchTurn({ ts: '', text: '', woke })) return false;
  return woke!.every((w) => gaveTo(events, base(me), base(w), now));
}

/** 받은 쪽 답 끝 질문을 '묻지 않은 답'으로 — 상태(activityStatus)·결정 대기함·알림이 이걸 본다. 아니면 같은 객체 */
export function quietHanded(a: Activity, me: string, events: TaskEvent[], now: number): Activity {
  const r = a.reply;
  if (!r?.asks || !handedTurn(r.woke, me, events, now)) return a;
  const { ask: _ask, ...rest } = r;
  return { ...a, reply: { ...rest, asks: false } };
}

/** 폰 대화 목록에서 마지막 답의 턴을 깨운 쪽 — 다른 세션 말은 보낸 이름(relay from), 사람 말은 빈 이름. 답이 없으면 없음 */
export function chatWoke(items: ChatItem[]): string[] | undefined {
  let i = items.length - 1;
  while (i >= 0 && items[i]!.kind !== 'assistant') i--;
  if (i < 0) return undefined;
  while (i >= 0 && (items[i]!.kind === 'assistant' || items[i]!.kind === 'tools')) i--;
  const out: string[] = [];
  for (; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'assistant' || it.kind === 'tools') break;
    out.push(it.kind === 'relay' ? it.from : '');
  }
  return out.length ? out : undefined;
}
