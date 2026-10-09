import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tabEdges, tabScrollLeft } from '../domain/tabScroll';

/** 채팅 탭 줄 — 크롬 탭처럼 탭이 늘면 줄어들고(이름은 줄임표), 최소 폭 밑으로 가야 가로로 넘긴다.
 *  넘칠 땐 양 끝을 흐려 더 있다는 걸 보이고, + 는 넘기는 칸 밖에 둬서 안 밀린다(2026-10-10 사용자 QA).
 *  고른 탭(aria-selected)이 줄 밖·흐림 밑에 있으면 보이게 굴린다 — ⌘1~9·세션으로 가기는 클릭이 아니라 줄이 안 따라왔다(2026-10-09) */
export function ChatTabStrip({ active, count, add, children }: { active: string | null; count: number; add?: ReactNode; children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = strip.current;
    if (!el) return;
    const e = tabEdges(el);
    setEdges((p) => (p.left === e.left && p.right === e.right ? p : e));
  };
  useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const x = tabScrollLeft({ left: b.left, width: b.width, scrollLeft: box.scrollLeft }, { left: t.left, width: t.width });
    if (x !== null) box.scrollLeft = x;
  }, [active, count]);
  // 탭 이름이 바뀌어도(이름 바꾸기·별명) 넘침이 달라진다 — 그리기마다 재 본다(같으면 setState 가 그냥 돌아간다)
  useLayoutEffect(measure);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="chat-tabs" role="tablist">
      <div className="ct-strip" ref={strip} data-more-l={edges.left || undefined} data-more-r={edges.right || undefined} onScroll={measure}
        // 마우스 휠(세로)로도 넘긴다 — 트랙패드는 가로 쓸기가 그대로 먹는다
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
        {children}
      </div>
      {add}
    </div>
  );
}
