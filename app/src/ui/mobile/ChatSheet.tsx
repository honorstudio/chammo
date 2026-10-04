// 채팅 시트 — 바닥(스페이스) 위에 겹친 시트, 살짝·반·전체 세 높이. 손잡이 줄을 끌면 손가락을 1:1 로 따라오고(끝 너머는 고무줄),
// 놓으면 플릭 속도·작은 거리 문턱으로 정한 높이에 스프링으로 붙는다(domain/mobile releaseSnap·rubberTop, 라이브러리 없이 pointer)
// 살짝 높이는 손잡이+입력줄을 재서 정한다 — 그림 칩·여러 줄 입력이 생겨도 입력줄이 화면 밖으로 안 밀린다(2026-10-02 사용자 실기기)
// 반·전체에서 대화 목록이 맨 위일 때 아래로 끌면 시트가 내려온다(목록 스크롤과 안 싸우게 맨 위·아래 방향일 때만)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PEEK_H, releaseSnap, rubberTop, sheetTop, type Snap } from '../../domain/mobile';

type Props = { snap: Snap; onSnap: (s: Snap) => void; peekLine: string; vh: number; kb: boolean; children: ReactNode; composer: ReactNode };

/** 이만큼 움직여야 끌기 — 그 아래는 누르기 */
const SLOP = 5;
type Drag = { y: number; top: number; trail: { t: number; y: number }[] };

export function ChatSheet({ snap, onSnap, peekLine, vh, kb, children, composer }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [peekH, setPeekH] = useState(PEEK_H);
  const grab = useRef<HTMLDivElement>(null);
  const comp = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const grabPeek = useRef(0);
  // 키보드가 떠 있으면 반 대신 전체 — 반이면 칩·입력줄에 밀려 대화가 한 줄만 남았다
  const top = drag ?? sheetTop(kb && snap === 'half' ? 'full' : snap, vh, peekH);
  // 손 떼기·터치 리스너가 마지막 값을 읽게
  const live = useRef({ snap, vh, peekH, top, onSnap });
  live.current = { snap, vh, peekH, top, onSnap };

  // 살짝 높이 = 살짝일 때의 손잡이 줄 + 입력줄(칩·여러 줄 포함)
  useLayoutEffect(() => {
    const measure = () => {
      const g = grab.current, c = comp.current;
      if (!g || !c) return;
      if (live.current.snap === 'peek') grabPeek.current = g.offsetHeight;
      const h = (grabPeek.current || 44) + c.offsetHeight;
      setPeekH((p) => (Math.abs(p - h) < 1 ? p : h));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (grab.current) ro.observe(grab.current);
    if (comp.current) ro.observe(comp.current);
    return () => ro.disconnect();
  }, [snap]);

  const cur = useRef<Drag | null>(null);
  const begin = (y: number, t: number) => { cur.current = { y, top: live.current.top, trail: [{ t, y }] }; };
  const move = (y: number, t: number) => {
    const s = cur.current;
    if (!s) return;
    s.trail.push({ t, y });
    if (s.trail.length > 8) s.trail.shift();
    setDrag(rubberTop(s.top + y - s.y, live.current.vh, live.current.peekH));
  };
  const end = (y: number, t: number) => {
    const s = cur.current;
    cur.current = null;
    setDrag(null);
    if (!s) return;
    // 놓기 직전 0.1초 동안의 속도(px/ms, 아래 +)
    const recent = s.trail.filter((p) => t - p.t <= 100);
    const first = recent[0] ?? s.trail[0]!;
    const v = (y - first.y) / Math.max(1, t - first.t);
    const { snap: from, vh: h, peekH: ph, onSnap: go } = live.current;
    go(releaseSnap(from, s.top, s.top + y - s.y, v, h, ph));
  };

  // 손잡이 줄 — 5px 넘게 움직이면 끌기, 아니면 누르기(살짝 ↔ 반)
  const press = useRef<{ y: number; t: number } | null>(null);

  // 대화 목록 맨 위에서 아래로 끌기 — 브라우저 스크롤을 막아야 해서 passive:false 터치 리스너
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    let st: { y: number; log: HTMLElement; on: boolean } | null = null;
    const start = (e: TouchEvent) => {
      const log = (e.target as Element).closest?.('.m-log') as HTMLElement | null;
      st = log && live.current.snap !== 'peek' && e.touches.length === 1 ? { y: e.touches[0]!.clientY, log, on: false } : null;
    };
    const mv = (e: TouchEvent) => {
      if (!st) return;
      const y = e.touches[0]!.clientY;
      if (!st.on) {
        const dy = y - st.y;
        if (dy < -SLOP || st.log.scrollTop > 0) { st = null; return; } // 위로 = 목록 스크롤
        if (dy <= SLOP) return;
        st.on = true;
        begin(y, e.timeStamp);
      }
      e.preventDefault();
      move(y, e.timeStamp);
    };
    const up = (e: TouchEvent) => {
      if (st?.on) end(e.changedTouches[0]!.clientY, e.timeStamp);
      st = null;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', mv, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', mv);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, []);

  return (
    <section ref={sheet} className={`m-sheet m-snap-${snap}${kb ? ' m-kb' : ''}`} style={{ top, transition: drag === null ? 'top .34s cubic-bezier(.22, 1.25, .36, 1)' : 'none' }}>
      <div
        ref={grab}
        className="m-grab"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press.current = { y: e.clientY, t: e.timeStamp }; }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          if (!cur.current) {
            if (Math.abs(e.clientY - p.y) <= SLOP) return;
            begin(p.y, p.t);
          }
          move(e.clientY, e.timeStamp);
        }}
        onPointerUp={(e) => {
          const dragging = !!cur.current;
          press.current = null;
          if (dragging) end(e.clientY, e.timeStamp);
          else onSnap(snap === 'peek' ? 'half' : 'peek'); // 그냥 누르면 살짝 ↔ 반
        }}
        onPointerCancel={() => { press.current = null; cur.current = null; setDrag(null); }}
      >
        <div className="m-handle" />
        {snap === 'peek' && <div className="m-peek">{peekLine || '아직 대화가 없어요'}</div>}
      </div>
      {snap !== 'peek' && children}
      <div ref={comp} className="m-comp-wrap">{composer}</div>
    </section>
  );
}
