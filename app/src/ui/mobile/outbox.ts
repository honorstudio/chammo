// 폰 보낼 함 — 화면(OrchSpace)이 참모마다 새로 그려져도 남게 모듈에 하나 + localStorage(domain/mobileOutbox).
// 말풍선은 누르는 즉시 '보내는 중'으로 뜨고, 대화 기록에 실제로 들어오면 빠진다. 못 보내면 그 말풍선에 다시 보내기.
// 맥은 받자마자 답하고 뒤에서 친다(202). 연결이 끊겨 응답을 못 받으면(Load failed — 그래도 맥은 받았을 수 있다) 실패로 띄우지 않고
// 기록을 기다리다, 60초 지나도 안 뜨면 맥에 물어본다(send-status). 같은 말은 말 id(cid)로 한 번만 쳐진다(2026-10-03)
// 폰은 기록 끝만 읽어서, 자고 일어나 열면 그 말 기록이 꼬리 앞에 있다 — 맥은 보낸 말을 10분만(다시 켜지면 0) 기억해 '모름'이라 하니
// 꼬리 앞을 거슬러 읽어 들어간 말이면 뺀다 — '못 받았어요'는 그렇게 기록을 다 본 뒤에만(2026-10-11 사용자 "아직도 마지막 메세지 남아있는 버그")
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { readTranscriptBefore, sendStatus, sendTextToSession } from '../../data/web';
import { chatStart } from '../space/useChatItems';
import type { ChatItem } from '../../domain/chat';
import { addOut, applyStatus, beforeTail, dueForCheck, findEarlier, markOut, newOut, readOutbox, settleOut, writeOutbox, type OutMsg, type Store } from '../../domain/mobileOutbox';

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

async function deliver(id: string): Promise<{ ok: boolean; error?: string }> {
  const m = list.find((x) => x.id === id);
  if (!m) return { ok: false, error: '보낼 말이 없어요' };
  try {
    await sendTextToSession(m.session, m.text, m.id);
    set(markOut(list, id, 'sent'));
    return { ok: true };
  } catch (e) {
    // 연결 오류(fetch 의 TypeError — 사파리 'Load failed')는 맥이 받았을 수 있다 → 보내는 중으로 두고 기록·send-status 로 가린다.
    // 맥이 거절한 것(4xx·5xx 글)만 바로 실패
    if (e instanceof TypeError) { set(markOut(list, id, 'sent')); return { ok: true }; }
    set(markOut(list, id, 'failed', (e as Error).message));
    return { ok: false, error: (e as Error).message };
  }
}

/** 채팅 화면 밖에서 보내기(폰 시안 검토 보내기) — 같은 보낼 함이라 채팅에 '보내는 중' 말풍선이 바로 뜨고, 결과를 돌려준다.
 *  retryId 를 주면 그 말을 같은 id 로 다시(맥이 이미 쳤으면 두 번 안 친다) */
export function sendOut(session: string, text: string, retryId?: string): Promise<{ id: string; ok: boolean; error?: string }> {
  let id = retryId && list.some((m) => m.id === retryId) ? retryId : '';
  if (id) set(markOut(list, id, 'sending'));
  else {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set(addOut(list, newOut({ id, session, text }, [], Date.now())));
  }
  const at = id;
  return deliver(at).then((r) => ({ id: at, ...r }));
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
        set(applyStatus(list, m.id, s.state, s.error, Date.now(), looked.has(m.id)));
      } catch { /* 연결이 또 끊김 — 다음 차례에 */ }
    }
  } finally {
    checking = false;
  }
}
if (typeof window !== 'undefined') window.setInterval(() => void checkLate(), 15_000);

/** 그 말 보낸 때부터 대화 기록을 다 본 말 — 꼬리가 덮었거나 꼬리 앞을 찾아봤는데 없음. 맥이 '모름'이라 해도 이것만 실패로 바꾼다(applyStatus) */
const looked = new Set<string>();
/** 꼬리 앞 찾기 — '말 id@꼬리 첫 자리' → 다시 찾아도 되는 때(찾는 중·다 찾아봄 = 영영, 연결이 끊김 = 30초 뒤). 꼬리를 새로 읽으면 자리가 바뀌어 다시 찾는다 */
const lookedBack = new Map<string, number>();
/** 꼬리 앞을 다 찾아봤는데 없던 '말 id@꼬리 첫 자리' */
const notFound = new Set<string>();
function lookBack(session: string, sid: string, items: ChatItem[]) {
  const start = chatStart(sid);
  if (start === undefined) return;
  const now = Date.now();
  const key = (m: OutMsg) => `${m.id}@${start}`;
  const mine = list.filter((m) => m.session === session);
  const outside = beforeTail(mine, items, start);
  // 꼬리가 덮는 말, 이 꼬리 앞을 찾아봤는데 없던 말만 '다 봤음' — 꼬리를 새로 읽어 밖으로 밀리면 다시 아직
  mine.forEach((m) => { if (!outside.includes(m) || notFound.has(key(m))) looked.add(m.id); else looked.delete(m.id); });
  const want = outside.filter((m) => (lookedBack.get(key(m)) ?? 0) <= now);
  if (!want.length) return;
  want.forEach((m) => lookedBack.set(key(m), Infinity));
  findEarlier(want, start, (before) => readTranscriptBefore(sid, before), now)
    .then((ids) => {
      want.forEach((m) => { if (!ids.includes(m.id)) { notFound.add(key(m)); looked.add(m.id); } });
      if (ids.length) set(list.filter((m) => !ids.includes(m.id)));
    })
    .catch(() => want.forEach((m) => lookedBack.set(key(m), Date.now() + 30_000)));
}

/** 그 세션의 보내는 중·실패 말 — items(대화 기록)가 바뀔 때마다 들어온 말을 뺀다. sid = 대화 기록 번호(꼬리 앞을 거슬러 읽을 때) */
export function useOutbox(session: string, items: ChatItem[], sid?: string) {
  const all = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    set(settleOut(list, session, items, Date.now()));
    if (sid) lookBack(session, sid, items);
  }, [session, sid, items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mine = all.filter((m) => m.session === session);
  const send = useCallback((text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set(addOut(list, newOut({ id, session, text }, itemsRef.current, Date.now())));
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
