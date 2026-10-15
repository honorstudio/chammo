// 고른 프사 ↔ 채팅 카드 이음 윤곽(2026-10-12 사용자 201.png) — 띠 | 채팅 | 스페이스 의 공통 부모(.space) 위에 SVG 선 하나.
// 고른 프사 칸(.lk-av.on)과 채팅 카드(.och-card)를 재서 domain/chatLink 로 경로를 짓는다. 참모를 바꾸면 탭 자리가 140ms 에 옮겨 가고
// 색은 CSS 전환(stroke), 동작 줄이기면 바로. 자리는 offsetTop 으로 잰다 — 자리 옮김(FLIP)·끌기 transform 중에 재도 제자리가 나온다
import { useEffect, useLayoutEffect, useRef } from 'react';
import { LINK_MOVE_MS, linkGeom, linkPath, type Box } from '../../domain/chatLink';
import { orchVars } from '../../domain/orchTheme';
import { motionOn } from '../calm';

const still = () => !motionOn(); // 애니메이션 줄이기·끄기·OS 동작 줄이기(ui/calm)
const ease = (t: number) => 1 - (1 - t) ** 3;

/** root 기준 자리 — offsetParent 를 따라 더한다(transform 은 안 들어간다) */
function at(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0; let y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== root) { x += e.offsetLeft - (e !== el ? e.scrollLeft : 0); y += e.offsetTop - (e !== el ? e.scrollTop : 0); e = e.offsetParent as HTMLElement | null; }
  return { x, y };
}

type Shape = { card: Box; tab: Box | null; rt: number };

function measure(root: HTMLElement): Shape | null {
  const card = root.querySelector<HTMLElement>(':scope > .office-chats.left .och-card');
  const nav = root.querySelector<HTMLElement>(':scope > .lk-strip');
  const on = nav?.querySelector<HTMLElement>(':scope > .lk-av.on');
  if (!card || !nav || !on) return null;
  const c = at(card, root);
  const n = at(nav, root);
  const join = nav.querySelector<HTMLElement>(':scope > .lk-join');
  const left = join ? join.offsetLeft : on.offsetLeft - 2;
  const rt = join ? parseFloat(getComputedStyle(join).borderTopLeftRadius) || 12 : 12;
  return { card: { x: c.x, y: c.y, w: card.offsetWidth, h: card.offsetHeight }, tab: { x: n.x + left, y: n.y + on.offsetTop, w: c.x - (n.x + left), h: on.offsetHeight }, rt };
}

export function ChatLink({ color }: { color?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPathElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const shown = useRef<Shape | null>(null);
  const anim = useRef(0);

  const draw = (s: Shape) => {
    shown.current = s;
    const o = { rt: s.rt };
    line.current?.setAttribute('d', linkPath(s.card, s.tab, o));
    fill.current?.setAttribute('d', linkGeom(s.card, s.tab, o).fills.join(' '));
  };

  const update = () => {
    const root = svg.current?.parentElement;
    const next = root ? measure(root) : null;
    if (svg.current) svg.current.style.visibility = next ? '' : 'hidden';
    if (!next) { shown.current = null; return; }
    const prev = shown.current;
    const moved = prev?.tab && next.tab && (Math.abs(prev.tab.y - next.tab.y) > 0.5 || Math.abs(prev.tab.h - next.tab.h) > 0.5);
    cancelAnimationFrame(anim.current);
    if (!moved || still()) { draw(next); return; }
    const from = prev!.tab!;
    const to = next.tab!;
    // 시작 = 첫 프레임 시각 — rAF 시각은 그 프레임 시작이라 performance.now() 보다 앞설 수 있다(음수 k 로 탭이 위로 튀었다)
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const k = ease(Math.min(1, Math.max(0, (now - t0) / LINK_MOVE_MS)));
      draw({ ...next, tab: { ...to, y: from.y + (to.y - from.y) * k, h: from.h + (to.h - from.h) * k } });
      if (k < 1) anim.current = requestAnimationFrame(step);
      else shown.current = next;
    };
    anim.current = requestAnimationFrame(step);
  };

  // 고른 칸·폭·순서가 바뀌면 다시 잰다 — 띠 안 class 바뀜(고르기·자리 옮김)·크기 바뀜(창·폭 손잡이·펼치기)을 지켜본다
  useLayoutEffect(update, [color]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = svg.current?.parentElement;
    if (!root) return;
    let queued = 0;
    const later = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; update(); }); };
    const ro = new ResizeObserver(later);
    // 스페이스 전체가 아니라 띠 안만 지켜본다 — 채팅 글이 흐를 때마다 다시 재지 않게
    const mo = new MutationObserver(() => { watch(); later(); });
    const watch = () => {
      ro.disconnect(); ro.observe(root);
      for (const el of root.querySelectorAll<HTMLElement>(':scope > .lk-strip, :scope > .office-chats.left, :scope > .office-chats.left .och-card')) ro.observe(el);
      mo.observe(root, { childList: true });
      const nav = root.querySelector(':scope > .lk-strip');
      if (nav) mo.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    };
    watch();
    window.addEventListener('resize', later);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', later); cancelAnimationFrame(queued); cancelAnimationFrame(anim.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg ref={svg} className="chat-link" aria-hidden="true" style={orchVars(color ?? '') as React.CSSProperties}>
      <path ref={fill} className="cl-fill" />
      <path ref={line} className="cl-line" />
    </svg>
  );
}
