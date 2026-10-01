// 세션 대화 기록 → 말풍선 항목(채팅 판과 같은 이어 읽기). 대시보드가 참모 기록에서 붙인 그림을 뽑는다.
// 한 번 읽은 건 세션마다 기억 — 참모 1↔2 를 바꿀 때마다 긴 기록을 처음부터 다시 읽어 한 박자 늦었다(2026-09-30 사용자)
import { useEffect, useState } from 'react';
import { readTranscript } from '../../data/tauri';
import { appendChat, parseChat, type ChatItem } from '../../domain/chat';

const cache = new Map<string, { items: ChatItem[]; next?: number }>();

export function useChatItems(sessionId?: string, everyMs = 2000): ChatItem[] {
  const [items, setItems] = useState<ChatItem[]>(() => (sessionId ? cache.get(sessionId)?.items ?? [] : []));
  useEffect(() => {
    const had = sessionId ? cache.get(sessionId) : undefined;
    setItems(had?.items ?? []);
    if (!sessionId) return;
    let next = had?.next;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const c = await readTranscript(sessionId, next);
        if (!alive) return;
        next = c.next;
        const prev = cache.get(sessionId)?.items ?? [];
        const now = c.reset ? parseChat(c.text) : c.text ? appendChat(prev, c.text) : prev;
        cache.set(sessionId, { items: now, next });
        if (now !== prev) setItems(now);
      } catch {
        // 다음 차례에
      }
      if (alive) timer = window.setTimeout(tick, everyMs);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [sessionId, everyMs]);
  return items;
}
