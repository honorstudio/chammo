// 폰 채팅 한 세션 — 대화 이어 읽기 + 보내는 중 말풍선(보낼 함, 참모를 바꿔도 남는다) + 보내기(그림 경로 붙여서). MessageList·Composer 가 나눠 쓴다
import { useEffect, useState } from 'react';
import { interruptSession, readTranscript } from '../../data/web';
import { liveWork, withAttachments } from '../../domain/mobile';
import type { Session } from '../../domain/session';
import { chatLoaded, useChatItems, useChatStale } from '../space/useChatItems';
import { useEarlier } from './useEarlier';
import { useOutbox } from './outbox';

/** 일하는 중엔 대화 꼬리를 이만큼마다(이어 읽기라 바뀐 줄만 온다) — 화면이 보일 때만 */
const LIVE_MS = 800;
const visible = () => typeof document === 'undefined' || !document.hidden;

/** everyMs — 시트가 반·전체면 2초, 살짝이면 10초(메모 폴링 주기). stateAt = 세션 상태를 마지막으로 읽은 때(liveWork) */
export function useMobileChat(session: Session, everyMs: number, stateAt: number) {
  const [fast, setFast] = useState(false);
  const items = useChatItems(session.sessionId, fast ? LIVE_MS : everyMs, readTranscript);
  const out = useOutbox(session.id, items);
  const earlier = useEarlier(session.sessionId);
  const loading = !!session.sessionId && !chatLoaded(session.sessionId);
  const [now, setNow] = useState(() => Date.now());
  // 최신 아님(돌아온 뒤·다른 참모로 옮긴 뒤 첫 답 전) — 옛 '생각 중…'·멈춤 버튼이 지금 상태처럼 보이지 않게 일하는 표시를 접는다
  const stale = useChatStale(session.sessionId);
  const work = liveWork({ state: session.state, items, pending: out.mine.filter((m) => m.status !== 'failed').length, stateAt, now });
  const live = stale ? { ...work, busy: false } : work;
  // 일하는 동안 1초마다 경과 시간을 다시 그리고, 화면이 숨으면 느리게
  useEffect(() => {
    const on = () => setFast(live.busy && visible());
    on();
    if (!live.busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', on);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', on); };
  }, [live.busy]);
  const [error, setError] = useState<string | null>(null);

  /** 누르는 즉시 말풍선이 뜨고 입력칸은 비운다 — 못 보내면 그 말풍선에 다시 보내기(보낼 함) */
  const send = (text: string, paths: string[] = []): boolean => {
    const full = withAttachments(text, paths);
    if (!full) return false;
    out.send(full);
    return true;
  };

  // 멈춤 — 비서 세션에 Esc 한 번. 누른 뒤 2초는 다시 못 누른다(서버도 2초에 한 번)
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    setError(null);
    try {
      await interruptSession(session.id); // 이미 쉬는 중·연타는 조용히
    } catch (e) {
      setError(`못 멈췄어요: ${(e as Error).message}`);
    } finally {
      window.setTimeout(() => setStopping(false), 2000);
    }
  };

  return { items, earlier, loading, stale, out: out.mine, retry: out.retry, drop: out.drop, live, send, error, setError, stop, stopping };
}
