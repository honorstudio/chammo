// 스페이스 탭 줄의 스크롤 칸 — 고정 탭(홈·보관함·앱) 오른쪽에서 독·파일 탭만 가로로 스크롤한다(2026-10-22 사용자).
// 막대는 숨겨 줄 높이를 안 먹고(맥 '항상 보기'면 17px), 마우스 세로 휠은 가로로, 넘친 끝은 흐리게, 고른 탭은 보이게. 판단은 domain/tabStrip
import { Children, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keepInView, tabFade, wheelToX } from '../../domain/tabStrip';

export function TabStrip({ on, children }: { /** 고른 탭 열쇠 — 바뀌면 그 탭(.on)이 보이게 */ on: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });
  const read = () => {
    const el = box.current;
    if (!el) return;
    const f = tabFade(el.scrollLeft, el.scrollWidth, el.clientWidth);
    setFade((x) => (x.l === f.l && x.r === f.r ? x : f));
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // React onWheel 은 막을 수 없는(passive) 듣기라 세로 휠이 페이지로 샌다 — 직접 단다
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || el.scrollWidth <= el.clientWidth) return;
      const dx = wheelToX(e.deltaX, e.deltaY, e.deltaMode);
      if (!dx) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('scroll', read); ro.disconnect(); };
  }, []);
  // 고른 탭이 바뀌거나 탭이 열리고 닫히면 — 고른 탭을 보이게(그 밖의 다시 그리기엔 사람이 밀어 둔 자리를 안 건드린다)
  const count = Children.count(children);
  useLayoutEffect(() => {
    const el = box.current;
    const tab = el?.querySelector<HTMLElement>(':scope > .on');
    if (!el || !tab) return;
    const r = el.getBoundingClientRect(), t = tab.getBoundingClientRect();
    const l = t.left - r.left + el.scrollLeft;
    const to = keepInView(el.scrollLeft, el.clientWidth, l, l + t.width);
    if (to !== el.scrollLeft) el.scrollLeft = to;
  }, [on, count]);
  useLayoutEffect(read); // 흐림은 매번 잰다(같으면 다시 안 그린다)
  return <div ref={box} className={`lk-tabs-scroll${fade.l ? ' fade-l' : ''}${fade.r ? ' fade-r' : ''}`}>{children}</div>;
}
