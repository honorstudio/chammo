import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { GUARD0, GUARD_WAIT_MS, guardMsg, guardStep, type Guard } from '../domain/frameLink';

/**
 * 시안 칸 지킴이(2026-11-05 참모 업데이트 — 링크가 칸 안에서 바깥 사이트로 넘어가 하얘졌다). 링크 다리의 here·leave 와 칸 load 로
 * 우리 문서가 사라졌는지 보고, 그러면 원래 문서(src)로 되돌린다(domain/frameLink guardStep). 계속 비면 gone — 부르는 쪽이 다시 불러오기 아이콘을 띄운다.
 * 맥 HtmlFrame·폰 HtmlSheet 가 같이 쓴다. onLoad 를 칸 onLoad 에 붙인다
 */
export function useFrameGuard(ref: RefObject<HTMLIFrameElement | null>, src: string) {
  const g = useRef<Guard>(GUARD0);
  const timer = useRef(0);
  const [gone, setGone] = useState(false);
  const reload = useCallback(() => {
    setGone(false);
    ref.current?.setAttribute('src', src); // 같은 주소를 다시 넣으면 칸이 그 문서로 다시 간다
  }, [ref, src]);
  const step = useRef<(ev: 'here' | 'leave' | 'load' | 'check') => void>(() => {});
  step.current = (ev) => {
    const r = guardStep(g.current, ev, Date.now());
    g.current = r.g;
    if (ev === 'here') setGone(false);
    if (r.wait) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => step.current('check'), GUARD_WAIT_MS); }
    if (r.reset) ref.current?.setAttribute('src', src);
    if (r.gone) setGone(true);
  };
  useEffect(() => {
    g.current = GUARD0;
    setGone(false);
    const on = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return; // 이 칸이 보낸 것만
      const m = guardMsg(e.data);
      if (m) step.current(m);
    };
    window.addEventListener('message', on);
    return () => { window.removeEventListener('message', on); window.clearTimeout(timer.current); };
  }, [ref, src]);
  return { gone, reload, onLoad: () => step.current('load') };
}
