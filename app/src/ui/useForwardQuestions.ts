// 하위 세션 선택지 창을 참모 입력칸에 한 줄로 넘긴다 — 판단은 domain/forwardQuestion.
// sessions 는 3초마다 새로 와서 이 효과도 그때마다 돈다(30초 유예를 따로 재지 않아도 된다)
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { forwardText, nextForward, type AskTrack } from '../domain/forwardQuestion';
import type { Session } from '../domain/session';

export function useForwardQuestions(subs: Session[], orch: Session | undefined, watching: (s: Session) => boolean) {
  const track = useRef<AskTrack>(new Map());
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current) return;
    const r = nextForward(subs, orch, track.current, Date.now(), watching);
    track.current = r.track;
    if (!r.sub || !orch) return;
    busy.current = true;
    const sub = r.sub;
    void sendToSession(orch.id, forwardText(sub))
      .catch(() => track.current.delete(sub.id)) // 못 넣었으면 다음 번에 다시 센다
      .finally(() => { busy.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, orch]);
}
