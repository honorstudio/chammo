// 폰 md 글 칸 자동 저장 — 보관함 문서·내 메모가 같이 쓴다. 0.8초 모아 한 줄로 쓰고, 맥에서 그새 바뀌었으면(CHANGED_OUTSIDE) 덮지 않고 알린다
import { useRef, useState } from 'react';

export type MdSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'outside';

/** write(글, 알던 글) — 맥에 쓴다. 알던 글이 지금 파일과 다르면 CHANGED_OUTSIDE 로 거절 */
export function useMdSave(write: (text: string, base: string) => Promise<unknown>) {
  const [st, setSt] = useState<MdSaveState>('idle');
  const timer = useRef<number | undefined>(undefined);
  const last = useRef('');
  // 저장은 한 줄로 — 앞 저장이 끝나야 base(last)가 바뀐다. 겹쳐 보내면 뒤 것이 옛 base 로 가 제 앞 저장 때문에 '바뀌었어요'를 맞았다(2026-10-22 코드 리뷰)
  const chain = useRef<Promise<void>>(Promise.resolve());
  const outside = useRef(false);
  const writeNow = useRef(write);
  writeNow.current = write;
  const save = (t: string) => {
    if (t === last.current || outside.current) return;
    setSt('saving');
    // 맥에서 그새 바뀌었으면 덮지 않는다(⑦-5) — 글 칸은 그대로 두고 알린다. 닫고 다시 열면 그 판을 받는다
    chain.current = chain.current.then(() => {
      if (t === last.current || outside.current) return;
      return writeNow.current(t, last.current).then(() => { last.current = t; setSt('saved'); }, (e: Error) => {
        if (e.message.includes('CHANGED_OUTSIDE')) { outside.current = true; setSt('outside'); } else setSt('error');
      });
    });
  };
  /** 글 칸이 바뀌었다 */
  const change = (t: string) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(t), 800); };
  /** 지금 글을 바로 — 닫거나 다른 메모로 옮길 때 */
  const flush = (t: string | null) => { window.clearTimeout(timer.current); if (t !== null) save(t); return chain.current; };
  /** 맥에서 읽은 글을 기준으로 다시 시작 */
  const reset = (t: string) => { window.clearTimeout(timer.current); last.current = t; outside.current = false; setSt('idle'); };
  const stop = () => window.clearTimeout(timer.current);
  return { st, change, flush, reset, stop };
}
