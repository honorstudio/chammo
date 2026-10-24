// 채팅 시트 — 바닥(스페이스) 위에 겹친 시트, 살짝·반·전체 세 높이. 손잡이 줄을 끌면 손가락을 1:1 로 따라오고(끝 너머는 고무줄),
// 놓으면 플릭 속도·작은 거리 문턱으로 정한 높이에 스프링으로 붙는다(domain/mobile releaseSnap·rubberTop, 라이브러리 없이 pointer)
// 살짝 높이는 손잡이+입력줄을 재서 정한다 — 그림 칩·여러 줄 입력이 생겨도 입력줄이 화면 밖으로 안 밀린다(2026-10-02 사용자 실기기)
// 반·전체에서 대화 목록이 맨 위일 때 아래로 끌면 시트가 내려온다(목록 스크롤과 안 싸우게 맨 위·아래 방향일 때만)
// 살짝에서 끌어올리는 동안엔 대화 칸도 그린다(domain/sheetGuard logShown) — 늘어난 시트가 입력줄 위로 비지 않게
// 끌기·박힘 풀기·phone-layout.jsonl 진단은 공용 훅 useSheetDrag(아래 시트와 같은 것, 2026-10-11 시트 공용화)
// 잰 살짝 높이는 .m-space 에 --m-peek-h 로 — 뒤 스크롤 칸 아래 여백이 따라간다
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PEEK_H, type Snap } from '../../domain/mobile';
import { chatModel, logShown } from '../../domain/sheetGuard';
import { useSheetDrag } from './useSheetDrag';

type Props = { snap: Snap; onSnap: (s: Snap) => void; peekLine: string; vh: number; kb: boolean; children: ReactNode; composer: ReactNode;
  /** 잠깐 숨김(폰 사무실 뽑기·스킨 시트가 열린 동안) — 빼지 않아서 입력 중 글·시트 자리·잰 높이가 그대로 */ hidden?: boolean };

export function ChatSheet({ snap, onSnap, peekLine, vh, kb, children, composer, hidden }: Props) {
  const [peekH, setPeekH] = useState(PEEK_H);
  const grab = useRef<HTMLDivElement>(null);
  const comp = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const grabPeek = useRef(0);
  // 키보드가 떠 있으면 반 대신 전체 — 반이면 칩·입력줄에 밀려 대화가 한 줄만 남았다. 그때 위 끝은 보이는 화면 맨 위(머리줄을 걸치지 않게)
  const model = chatModel(snap, vh, peekH, kb);
  const { drag, grab: grabProps } = useSheetDrag({
    kind: 'chat',
    el: sheet,
    // 반·전체에서 대화 목록 위만 — 살짝이면 손잡이만 끈다
    pullFrom: (t) => (snap === 'peek' ? null : (t.closest('.m-log') as HTMLElement | null)),
    model,
    go: onSnap,
    vh,
    from: snap,
    onTap: () => onSnap(snap === 'peek' ? 'half' : 'peek'), // 그냥 누르면 살짝 ↔ 반
  });
  const top = drag ?? model.rest;
  const live = useRef({ snap });
  live.current = { snap };

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

  // 숨길 때 입력칸에 포커스가 남아 있으면 놓는다 — 숨은 입력칸에 키보드가 떠 있지 않게
  useEffect(() => { if (hidden && sheet?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); }, [hidden, sheet]);
  // 살짝 높이를 화면(.m-space)에 CSS 변수로 — 홈·세션·예약 스크롤 칸 아래 여백(.m-dash)이 따라가 마지막 칸이 시트에 안 가려진다
  useLayoutEffect(() => {
    const space = sheet?.closest<HTMLElement>('.m-space');
    space?.style.setProperty('--m-peek-h', `${Math.round(peekH)}px`);
  }, [sheet, peekH]);

  return (
    <section ref={setSheet} className={`m-sheet m-snap-${snap}${kb ? ' m-kb' : ''}${drag !== null ? ' m-drag' : ''}${hidden ? ' m-hide' : ''}`} aria-hidden={hidden || undefined} style={{ top, transition: drag === null ? 'top .34s cubic-bezier(.22, 1.25, .36, 1)' : 'none' }}>
      <div ref={grab} className="m-grab" data-grab {...grabProps}>
        <div className="m-handle" />
        {snap === 'peek' && <div className="m-peek">{peekLine || '아직 대화가 없어요'}</div>}
      </div>
      {logShown(snap, drag !== null) && children}
      <div ref={comp} className="m-comp-wrap">{composer}</div>
    </section>
  );
}
