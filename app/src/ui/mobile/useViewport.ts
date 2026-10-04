// 보이는 화면(visualViewport) — iOS 사파리는 키보드가 올라와도 레이아웃 높이가 그대로라 시트·입력줄이 키보드 뒤로 숨는다.
// 보이는 높이·위치를 따라가 화면 틀(.m-app)과 시트 높이를 맞춘다.
// kb = 키보드가 떠 있나(domain/mobile keyboardOpen). 위치는 쓰는 중에만 따라가고 아니면 맨 위(domain/mobile frameAt)
// iOS 가 사건 없이 화면을 옮겨도 돌아오게 — 앱이 다시 보일 때·포커스가 빠질 때·1초마다 다시 읽고, 화면 틀이 실제로 그려진 자리를 잰다(driftBias)
import { useEffect, useState, type RefObject } from 'react';
import { driftBias, frameAt, isTyping, keyboardOpen } from '../../domain/mobile';
import { RESUME_EVENT } from '../../domain/poller';

export type Viewport = { h: number; top: number; kb: boolean };
let tallest = { w: 0, h: 0 };
const typing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && isTyping({ tag: a.tagName, type: a.getAttribute('type') ?? '', editable: a.isContentEditable });
};
const read = (bias = 0): Viewport & { scroll: boolean; editing: boolean } => {
  const v = window.visualViewport;
  const h = Math.round(v ? v.height : window.innerHeight);
  const w = Math.round(v ? v.width : window.innerWidth);
  const k = keyboardOpen(tallest, w, h, window.innerHeight);
  tallest = k.tallest;
  const editing = typing();
  const f = frameAt({ vvTop: v ? Math.round(v.offsetTop) : 0, vvH: h, layoutH: document.documentElement.clientHeight, scrollY: Math.round(window.scrollY), kb: k.kb, editing });
  return { h: f.h, top: f.top + (editing || k.kb ? 0 : bias), kb: k.kb, scroll: f.scroll, editing };
};

export function useViewport(frame: RefObject<HTMLElement | null>): Viewport {
  const [vp, setVp] = useState<Viewport>(() => { const r = read(); return { h: r.h, top: r.top, kb: r.kb }; });
  useEffect(() => {
    const v = window.visualViewport;
    let bias = 0;
    let prev: number | null = null;
    const on = () => {
      const r = read(bias);
      if (r.editing) { bias = 0; prev = null; }
      if (r.scroll) window.scrollTo(0, 0);
      setVp((p) => (r.h === p.h && r.top === p.top && r.kb === p.kb ? p : { h: r.h, top: r.top, kb: r.kb }));
    };
    // 그려진 자리 — 화면 틀 위가 0 이 아닌 게 두 번 연달아 같으면 그만큼 보정. 보정을 바꿨으면 새 자리에서 다시 두 번
    const check = () => {
      if (document.hidden) return;
      const el = frame.current;
      if (el) {
        const rect = Math.round(el.getBoundingClientRect().top);
        const next = driftBias({ bias, rectTop: rect, prevRect: prev, editing: typing(), h: el.clientHeight || window.innerHeight });
        prev = next === bias ? rect : null;
        bias = next;
      }
      on();
    };
    const timers = new Set<number>();
    // 키보드가 닫히는 중엔 값이 늦게 바뀐다 — 조금씩 띄워 다시 읽는다
    const soon = () => {
      for (const ms of [60, 300, 800]) { const t = window.setTimeout(() => { timers.delete(t); on(); }, ms); timers.add(t); }
    };
    const tick = window.setInterval(check, 1000);
    (v ?? window).addEventListener('resize', on);
    v?.addEventListener('scroll', on);
    window.addEventListener('orientationchange', soon);
    window.addEventListener(RESUME_EVENT, soon);
    document.addEventListener('focusout', soon);
    return () => {
      (v ?? window).removeEventListener('resize', on);
      v?.removeEventListener('scroll', on);
      window.removeEventListener('orientationchange', soon);
      window.removeEventListener(RESUME_EVENT, soon);
      document.removeEventListener('focusout', soon);
      window.clearInterval(tick);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [frame]);
  return vp;
}
