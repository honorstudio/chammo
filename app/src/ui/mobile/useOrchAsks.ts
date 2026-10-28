// 참모마다 '사용자에게 묻고 멈췄나' — 대화 기록을 이어 읽어(처음만 작은 꼬리 = 살짝 보기, 그 뒤는 새로 붙은 것만) 15초마다 판단. 일하는 중인 참모는 안 읽는다.
// 마지막 말만 보면 돼서 살짝 보기(32KB~) — 채팅 첫 읽기(256KB~2MB)를 참모마다 받아 느린 셀룰러 첫 화면이 7MB 였다(2026-10-27)
// 읽은 김에 참모 바꾸기 줄의 상태 한 줄(orchLine)도 — 일하는 중이면 '일하는 중'만
import { makePoller, RESUME_EVENT, RESUME_LATER_MS } from '../../domain/poller';
import { useEffect, useRef, useState } from 'react';
import { peekTranscript } from '../../data/web';
import { appendChat, parseChat, type ChatItem } from '../../domain/chat';
import { orchAsk } from '../../domain/mobile';
import type { Session } from '../../domain/session';
import { orchLine } from './peek';

type Ask = ReturnType<typeof orchAsk>;

export function useOrchAsks(orchs: Session[]): { asks: Record<string, Ask>; lines: Record<string, string> } {
  const [asks, setAsks] = useState<Record<string, Ask>>({});
  const [lines, setLines] = useState<Record<string, string>>({});
  const mem = useRef(new Map<string, { items: ChatItem[]; next?: number }>());
  const live = useRef(orchs);
  live.current = orchs;
  useEffect(() => {
    // 받기 고리(domain/poller) — 앱이 다시 보이면 바로(옛 '물음' 카드·마지막 말이 남아 있었다, 2026-10-04)
    const read = async () => {
      const out: Record<string, Ask> = {};
      const ln: Record<string, string> = {};
      for (const o of live.current) {
        if (!o.sessionId || o.state === 'working') { out[o.id] = null; ln[o.id] = o.state === 'working' ? '일하는 중' : ''; continue; }
        try {
          const had = mem.current.get(o.sessionId);
          const c = await peekTranscript(o.sessionId, had?.next);
          const items = c.reset ? parseChat(c.text) : c.text ? appendChat(had?.items ?? [], c.text) : had?.items ?? [];
          mem.current.set(o.sessionId, { items, next: c.next || undefined }); // 0 이면 다음에도 '처음'으로(from 0 은 기록 전체를 읽는다)
          out[o.id] = orchAsk(items, o.state);
          ln[o.id] = orchLine(items, o.state);
        } catch {
          out[o.id] = null;
        }
      }
      return { out, ln };
    };
    const p = makePoller({ read, apply: ({ out, ln }) => { setAsks(out); setLines(ln); }, everyMs: () => 15_000 });
    p.start();
    // 대화·세션 받기가 먼저 — 이건 조금 뒤에(동시 연결에서 대화가 줄 서지 않게)
    let later: ReturnType<typeof setTimeout> | undefined;
    const wake = () => { clearTimeout(later); later = setTimeout(() => p.kick(), RESUME_LATER_MS); };
    window.addEventListener(RESUME_EVENT, wake);
    return () => { clearTimeout(later); window.removeEventListener(RESUME_EVENT, wake); p.stop(); };
  }, [orchs.length > 0]); // 목록이 처음 들어오면 바로 한 번 — 아니면 15초를 기다린다
  return { asks, lines };
}
