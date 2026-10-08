// 짧은 폴링(1차 — SSE 전). 실패는 조용히 다음 차례에, 화면이 사라지면 멈춘다
import { useCallback, useEffect, useRef, useState } from 'react';
import { makePoller, RESUME_EVENT, RESUME_LATER_MS } from '../../domain/poller';
import { remember, remembered } from './memo';
import { shared } from '../../domain/inflight';

export function usePoll<T>(load: () => Promise<T>, everyMs: number, init: T, deps: unknown[] = []): T {
  return useMemoPoll(null, load, everyMs, init, deps)[0];
}

/** 화면을 오가도 마지막 값을 바로 그리는 폴링 — key 로 기억해 두고(memo) 뒤에서 새로 받는다. loaded = 한 번이라도 받았나(처음이면 뼈대).
 *  kick = 다음 차례를 안 기다리고 지금 다시 받기(낡은 목록으로 누른 게 실패했을 때) */
export function useMemoPoll<T>(key: string | null, load: () => Promise<T>, everyMs: number, init: T, deps: unknown[] = []): [T, boolean, () => void] {
  const had = key ? remembered<T>(key) : undefined;
  const [v, setV] = useState<T>(had ?? init);
  const [loaded, setLoaded] = useState(had !== undefined);
  const poller = useRef<{ kick: () => void } | null>(null);
  useEffect(() => {
    // 받기 고리(domain/poller) — 앱이 다시 보이면(RESUME_EVENT) 다음 차례를 안 기다리고 바로, 매달린 요청의 늦은 답은 버린다(2026-10-04)
    const p = makePoller({
      read: () => (key ? shared(key, load) : load()), // 미리 받기(bootPreload)가 같은 열쇠를 받는 중이면 그걸 같이
      apply: (got) => { if (key) remember(key, got); setV(got); setLoaded(true); },
      everyMs: () => everyMs,
    });
    p.start();
    poller.current = p;
    // 대화·세션 받기가 먼저 — 이건 조금 뒤에(동시 연결에서 대화가 줄 서지 않게)
    let later: ReturnType<typeof setTimeout> | undefined;
    const wake = () => { clearTimeout(later); later = setTimeout(() => p.kick(), RESUME_LATER_MS); };
    window.addEventListener(RESUME_EVENT, wake);
    return () => { clearTimeout(later); window.removeEventListener(RESUME_EVENT, wake); p.stop(); poller.current = null; };
  }, [everyMs, key, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const kick = useCallback(() => poller.current?.kick(), []);
  return [v, loaded, kick];
}
