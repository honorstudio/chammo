// 세션 대화 기록 → 말풍선 항목(채팅 판과 같은 이어 읽기). 대시보드가 참모 기록에서 붙인 그림을 뽑는다.
// 한 번 읽은 건 세션마다 기억 — 참모 1↔2 를 바꿀 때마다 긴 기록을 처음부터 다시 읽어 한 박자 늦었다(2026-09-30 사용자)
import { useEffect, useRef, useState } from 'react';
import { readTranscript, type TranscriptChunk } from '../../data/tauri';
import { makePoller, RESUME_EVENT, type Poller } from '../../domain/poller';
import { appendChat, parseChat, type ChatItem } from '../../domain/chat';
import { shared } from '../../domain/inflight';

const cache = new Map<string, { items: ChatItem[]; next?: number; start?: number }>();

/** 미리 받기 — 폰 첫 화면 스플래시 동안 첫 묶음을 기억에 넣어 둔다(화면이 뜨는 순간 대화가 차 있게). 이미 있으면 그대로 */
export async function warmChat(sessionId: string, read: Read = readTranscript): Promise<void> {
  if (cache.has(sessionId)) return;
  const c = await shared(`chat:${sessionId}`, () => read(sessionId, undefined));
  if (!cache.has(sessionId)) cache.set(sessionId, { items: parseChat(c.text), next: c.next, start: c.start });
}

/** 처음 읽은 묶음의 첫 줄 자리 — 폰이 위로 올리면 그 앞을 거슬러 읽는다(ui/mobile/useEarlier) */
export const chatStart = (sessionId: string) => cache.get(sessionId)?.start;
/** 한 번이라도 읽었나 — 빈 목록이 '아직 못 읽음'인지 '대화가 없음'인지 가른다 */
export const chatLoaded = (sessionId: string) => cache.has(sessionId);

/** read 를 바꾸면 폰(data/web.ts)에서도 같은 이어 읽기 */
/** 대화 받기 — read 의 세 번째 인자(signal)로 매달린 요청을 끊는다(폰 web.ts). 데스크톱 tauri 는 무시 */
type Read = (sessionId: string, from?: number, signal?: AbortSignal) => Promise<TranscriptChunk>;

// '최신 아님' — 옛 기억(캐시)을 그리고 있는데 아직 새로 못 받은 대화. 폰이 백그라운드에서 돌아오거나 알림으로 다른 참모로 갈 때
// 옛 내용('생각 중…' 포함)이 지금 상태처럼 보였다(2026-10-04 사용자) — 화면이 이걸 보고 갱신 표시
const stale = new Map<string, boolean>();
const staleSubs = new Set<() => void>();
const setStale = (sid: string, v: boolean) => { if ((stale.get(sid) ?? false) === v) return; stale.set(sid, v); staleSubs.forEach((f) => f()); };
export function useChatStale(sessionId?: string): boolean {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); staleSubs.add(f); return () => { staleSubs.delete(f); }; }, []);
  return !!sessionId && (stale.get(sessionId) ?? false);
}

export function useChatItems(sessionId?: string, everyMs = 2000, read: Read = readTranscript): ChatItem[] {
  const [items, setItems] = useState<ChatItem[]>(() => (sessionId ? cache.get(sessionId)?.items ?? [] : []));
  const every = useRef(everyMs);
  every.current = everyMs;
  const poller = useRef<Poller | null>(null);
  useEffect(() => {
    const had = sessionId ? cache.get(sessionId) : undefined;
    setItems(had?.items ?? []);
    if (!sessionId) return;
    let next = had?.next;
    const p = makePoller({
      // 처음 읽기는 미리 받기(warmChat)가 받는 중이면 그걸 같이 — 스플래시가 먼저 걷혀도 같은 기록을 두 번 안 받게
      read: (signal) => (next === undefined ? shared(`chat:${sessionId}`, () => read(sessionId, undefined, signal)) : read(sessionId, next, signal)),
      apply: (c) => {
        next = c.next;
        const prev = cache.get(sessionId)?.items ?? [];
        const now = c.reset ? parseChat(c.text) : c.text ? appendChat(prev, c.text) : prev;
        cache.set(sessionId, { items: now, next, start: c.reset ? c.start : cache.get(sessionId)?.start });
        if (now !== prev) setItems(now);
      },
      everyMs: () => every.current,
      // 옛 기억을 그리는 중에만 '최신 아님'(처음 읽는 중이면 화면이 따로 '불러오는 중')
      onFresh: (f) => setStale(sessionId, !f && cache.has(sessionId)),
    });
    poller.current = p;
    p.start();
    // 앱이 다시 보이면(백그라운드에서 돌아옴·알림 누름) 매달린 요청을 끊고 바로 다시
    const wake = () => p.kick();
    window.addEventListener(RESUME_EVENT, wake);
    return () => { window.removeEventListener(RESUME_EVENT, wake); p.stop(); poller.current = null; setStale(sessionId, false); };
  }, [sessionId, read]);
  // 주기가 바뀌면(일하는 중 0.8초 ↔ 2·10초) 바로 한 번 — 표시 없이
  const lastEvery = useRef(everyMs);
  useEffect(() => {
    if (lastEvery.current === everyMs) return; // 처음 띄울 땐 start 가 이미 읽는다(두 번 읽지 않게)
    lastEvery.current = everyMs;
    poller.current?.kick(true);
  }, [everyMs]);
  return items;
}
