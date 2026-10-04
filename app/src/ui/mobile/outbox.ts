// 폰 보낼 함 — 화면(OrchSpace)이 참모마다 새로 그려져도 남게 모듈에 하나 + localStorage(domain/mobileOutbox).
// 말풍선은 누르는 즉시 '보내는 중'으로 뜨고, 대화 기록에 실제로 들어오면 빠진다. 못 보내면 그 말풍선에 다시 보내기.
// 맥은 받자마자 답하고 뒤에서 친다(202). 연결이 끊겨 응답을 못 받으면(Load failed — 그래도 맥은 받았을 수 있다) 실패로 띄우지 않고
// 기록을 기다리다, 60초 지나도 안 뜨면 맥에 물어본다(send-status). 같은 말은 말 id(cid)로 한 번만 쳐진다(2026-10-03)
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { sendStatus, sendTextToSession } from '../../data/web';
import type { ChatItem } from '../../domain/chat';
import { addOut, applyStatus, dueForCheck, markOut, readOutbox, settleOut, writeOutbox, type OutMsg, type Store } from '../../domain/mobileOutbox';

export const storage = (): Store | null => { try { return localStorage; } catch { return null; } };

let list: OutMsg[] = readOutbox(storage(), Date.now());
const subs = new Set<() => void>();
function set(next: OutMsg[]) {
  if (next === list) return;
  list = next;
  writeOutbox(storage(), list);
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => list;

async function deliver(id: string) {
  const m = list.find((x) => x.id === id);
  if (!m) return;
  try {
    await sendTextToSession(m.session, m.text, m.id);
    set(markOut(list, id, 'sent'));
  } catch (e) {
    // 연결 오류(fetch 의 TypeError — 사파리 'Load failed')는 맥이 받았을 수 있다 → 보내는 중으로 두고 기록·send-status 로 가린다.
    // 맥이 거절한 것(4xx·5xx 글)만 바로 실패
    set(e instanceof TypeError ? markOut(list, id, 'sent') : markOut(list, id, 'failed', (e as Error).message));
  }
}

/** 늦은 말 확인 — 15초마다, 보낸 지 60초 넘게 기록에 안 뜬 말을 맥에 묻는다 */
let checking = false;
async function checkLate() {
  if (checking) return;
  checking = true;
  try {
    for (const m of list.filter((x) => dueForCheck(x, Date.now()))) {
      try {
        const s = await sendStatus(m.id);
        set(applyStatus(list, m.id, s.state, s.error, Date.now()));
      } catch { /* 연결이 또 끊김 — 다음 차례에 */ }
    }
  } finally {
    checking = false;
  }
}
if (typeof window !== 'undefined') window.setInterval(() => void checkLate(), 15_000);

/** 그 세션의 보내는 중·실패 말 — items(대화 기록)가 바뀔 때마다 들어온 말을 뺀다 */
export function useOutbox(session: string, items: ChatItem[]) {
  const all = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => set(settleOut(list, session, items, Date.now())), [session, items]);
  const mine = all.filter((m) => m.session === session);
  const send = useCallback((text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set(addOut(list, { id, session, text, at: Date.now() }));
    void deliver(id);
  }, [session]);
  // 다시 보내기 — 같은 말 id 라 맥이 이미 쳤으면 두 번 안 친다. 보낸 때도 그대로(먼저 들어간 기록과 맞춰지게)
  const retry = useCallback((id: string) => {
    set(markOut(list, id, 'sending'));
    void deliver(id);
  }, []);
  const drop = useCallback((id: string) => set(list.filter((m) => m.id !== id)), []);
  return { mine, send, retry, drop };
}
