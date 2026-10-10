import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tabEdges, tabScrollLeft, tabsTight } from '../domain/tabScroll';

/** 채팅 탭 줄 — 크롬 탭처럼 탭이 늘면 줄어들고(이름은 줄임표), 최소 폭 밑으로 가야 가로로 넘긴다.
 *  넘칠 땐 양 끝을 흐려 더 있다는 걸 보이고, + 는 넘기는 칸 밖에 둬서 안 밀린다(2026-10-10 사용자 QA).
 *  고른 탭(aria-selected)이 줄 밖·흐림 밑에 있으면 보이게 굴린다 — ⌘1~9·세션으로 가기는 클릭이 아니라 줄이 안 따라왔다(2026-10-09).
 *  줄이 좁으면(tabsTight) data-tight — 안 고른 탭의 × 는 자리를 비우고 올렸을 때만 이름 끝 위에 뜬다(2026-10-10 사용자 PC) */
/** dragging = 탭을 끄는 중(SessionGrid) — 옆 탭이 부드럽게 비켜 주게 */
/** order = 탭 순서 글(바뀌면 고른 탭이 보이게 다시 굴린다 — 단축키로 옮겼을 때) */
export function ChatTabStrip({ active, count, order, add, dragging, children }: { active: string | null; count: number; order?: string; add?: ReactNode; dragging?: boolean; children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [tight, setTight] = useState(false);
  const measure = () => {
    const el = strip.current;
    if (!el) return;
    const e = tabEdges(el);
    setEdges((p) => (p.left === e.left && p.right === e.right ? p : e));
    const row = el.parentElement;
    if (!row) return;
    const cs = getComputedStyle(row);
    setTight(tabsTight({
      row: row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      add: row.querySelector<HTMLElement>(':scope > .tab-add')?.offsetWidth ?? 0,
      active: el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.offsetWidth ?? 0,
      gap: parseFloat(cs.columnGap) || 0,
      n: count,
    }));
  };
  useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const x = tabScrollLeft({ left: b.left, width: b.width, scrollLeft: box.scrollLeft }, { left: t.left, width: t.width });
    if (x !== null) box.scrollLeft = x;
  }, [active, count, order]);
  // 탭 이름이 바뀌어도(이름 바꾸기·별명) 넘침이 달라진다 — 그리기마다 재 본다(같으면 setState 가 그냥 돌아간다)
  useLayoutEffect(measure);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement); // 줄 폭이 바뀌면 좁음도 다시
    return () => ro.disconnect();
  }, []);
  return (
    <div className="chat-tabs" role="tablist">
      <div className="ct-strip" ref={strip} data-more-l={edges.left || undefined} data-more-r={edges.right || undefined} data-tight={tight || undefined} data-dragging={dragging || undefined} onScroll={measure}
        // 마우스 휠(세로)로도 넘긴다 — 트랙패드는 가로 쓸기가 그대로 먹는다
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
        {children}
      </div>
      {add}
    </div>
  );
}
