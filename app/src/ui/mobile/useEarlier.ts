// 앞 대화 — 위로 올려 끝에 닿으면 처음 읽은 묶음 앞을 512KB 씩 거슬러 읽어 앞에 붙인다(서버 /api/transcript?before).
// 압축(compact)해도 기록 파일엔 앞 대화가 남아 있어 요약 앞도 나온다(2026-10-03 사용자 "이전 대화 히스토리가 안 나와")
import { useCallback, useEffect, useRef, useState } from 'react';
import { readTranscriptBefore } from '../../data/web';
import { parseChat } from '../../domain/chat';
import { withEarlier, type Earlier } from '../../domain/mobile';
import { chatStart } from '../space/useChatItems';

export function useEarlier(sessionId: string | undefined) {
  const [s, setS] = useState<Earlier>({ older: [], start: -1, done: false });
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  // 실패하면 5초는 다시 안 부른다 — 화면을 채우려고 연달아 부르는 중에 연결이 끊겨도 헛돌지 않게
  const failedAt = useRef(0);
  useEffect(() => { setS({ older: [], start: -1, done: false }); }, [sessionId]);
  /** 불러오기를 시작했으면 true(아직 처음 읽기 전·다 읽음·쉬는 중이면 false) */
  const more = useCallback(async (): Promise<boolean> => {
    if (!sessionId || busy.current || s.done || Date.now() - failedAt.current < 5000) return false;
    const from = s.start >= 0 ? s.start : chatStart(sessionId);
    if (from === undefined) return false; // 처음 읽기가 아직
    if (from <= 0) { setS((p) => ({ ...p, done: true })); return false; }
    busy.current = true;
    setLoading(true);
    try {
      const e = await readTranscriptBefore(sessionId, from);
      setS((p) => withEarlier(p, parseChat(e.text), e.start));
    } catch {
      failedAt.current = Date.now();
    } finally {
      busy.current = false;
      setLoading(false);
    }
    return true;
  }, [sessionId, s]);
  return { items: s.older, done: s.done, loading, more };
}
export type EarlierApi = ReturnType<typeof useEarlier>;
