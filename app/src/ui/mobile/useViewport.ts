// 보이는 화면(visualViewport) — iOS 사파리는 키보드가 올라와도 레이아웃 높이가 그대로라 시트·입력줄이 키보드 뒤로 숨는다.
// 보이는 높이·위치를 따라가 화면 틀(.m-app)과 시트 높이를 맞춘다.
// kb = 키보드가 떠 있나(domain/mobile keyboardOpen). 위치는 쓰는 중에만 따라가고 아니면 맨 위(domain/mobile frameAt)
// iOS 가 사건 없이 화면을 옮겨도 돌아오게 — 앱이 다시 보일 때·포커스가 빠질 때·손을 뗄 때·1초마다 다시 읽고, 화면 틀이 실제로 그려진 자리를 잰다(driftBias)
// 유령 키보드(domain/mobile ghostKeyboard) — 키보드를 닫았는데 iOS 가 높이를 안 돌려주면 키보드 없음으로 그리고, 그때 값을 맥에 한 줄 남긴다(phone-diag)
// 엉터리 visualViewport 높이(domain/mobile visibleHeight)는 innerHeight 로 바꿔 그리고, 처음 바꾼 때 값을 맥에 한 줄(vp-fix)
import { useEffect, useState, type RefObject } from 'react';
import { diagLine, driftBias, isTyping, readViewport } from '../../domain/mobile';
import { RESUME_EVENT } from '../../domain/poller';
import { phoneDiag } from '../../data/web';
import { isStandalone } from './standalone';

export type Viewport = { h: number; top: number; kb: boolean };
let tallest = { w: 0, h: 0 };
/** 마지막으로 쓰는 중이었거나 포커스가 움직인 때 — 유령 키보드는 이 뒤 GHOST_MS 를 기다린다 */
let lastTyping = 0;
/** vp-fix 진단은 페이지마다 한 번 */
let fixSent = false;
/** 직전 사건들 — 진단 줄에(무슨 일 뒤에 멈췄나). 짧은 이름 4개, 같은 게 이어지면 하나로 */
let evs: string[] = [];
const note = (ev: string) => { if (evs[evs.length - 1] !== ev) evs = [...evs, ev].slice(-4); };
const typingEl = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && isTyping({ tag: a.tagName, type: a.getAttribute('type') ?? '', editable: a.isContentEditable }) ? a : null;
};
const touch = () => (navigator.maxTouchPoints ?? 0) > 0;
const read = (bias = 0): Viewport & { scroll: boolean; editing: boolean; ghost: boolean; fixed: boolean } => {
  const v = window.visualViewport;
  const editing = !!typingEl();
  const now = Date.now();
  if (editing) lastTyping = now;
  const r = readViewport({
    vvH: v ? Math.round(v.height) : null, vvW: v ? Math.round(v.width) : null, vvTop: v ? Math.round(v.offsetTop) : 0,
    innerH: window.innerHeight, innerW: window.innerWidth, layoutH: document.documentElement.clientHeight, scrollY: Math.round(window.scrollY),
    tallest, editing, quietMs: now - lastTyping, touch: touch(),
  });
  tallest = r.tallest;
  return { h: r.h, top: r.top + (editing || r.kb ? 0 : bias), kb: r.kb, scroll: r.scroll, editing, ghost: r.ghost, fixed: r.fixed };
};

/** 진단 값 — 숫자·짧은 낱말만(글 내용 없음). diagLine 이 한 번 더 거른다 */
const snapshot = (frame: HTMLElement | null) => {
  const v = window.visualViewport;
  const sheet = document.querySelector('.m-sheet');
  const fr = frame?.getBoundingClientRect();
  const ios = /OS (\d+)_(\d+)(?:_(\d+))?/.exec(navigator.userAgent);
  return {
    ev: evs.join('.') || 'none',
    vvH: v?.height ?? -1,
    vvTop: v?.offsetTop ?? -1,
    innerH: window.innerHeight,
    clientH: document.documentElement.clientHeight,
    tallH: tallest.h,
    scrH: window.screen?.height ?? -1,
    scrollY: window.scrollY,
    typing: !!typingEl(),
    tag: document.activeElement?.tagName ?? 'none',
    snap: /m-snap-(\w+)/.exec(sheet?.className ?? '')?.[1] ?? 'none',
    sheetTop: sheet ? sheet.getBoundingClientRect().top : -1,
    frameTop: fr?.top ?? -1,
    frameH: fr?.height ?? -1,
    quiet: Date.now() - lastTyping,
    sa: isStandalone(),
    ios: ios ? [ios[1], ios[2], ios[3]].filter(Boolean).join('.') : 'none',
  };
};

/** iOS 에 다시 재게 하기 — 화면 크기짜리 빈 층을 껐다 켠다(키보드 뒤 줄어든 높이가 이걸로 돌아온다는 보고가 있다, 효과는 진단 줄 ia·va 로 본다) */
let probe: HTMLDivElement | null = null;
const relayout = () => {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
  }
  probe.style.display = 'none';
  void probe.offsetHeight;
  probe.style.display = '';
  window.scrollTo(0, 0);
};

export function useViewport(frame: RefObject<HTMLElement | null>): Viewport {
  const [vp, setVp] = useState<Viewport>(() => { const r = read(); return { h: r.h, top: r.top, kb: r.kb }; });
  useEffect(() => {
    const v = window.visualViewport;
    let bias = 0;
    let prev: number | null = null;
    let wasGhost = false;
    const timers = new Set<number>();
    const later = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const on = () => {
      const r = read(bias);
      if (r.editing) { bias = 0; prev = null; }
      if (r.scroll) window.scrollTo(0, 0);
      setVp((p) => (r.h === p.h && r.top === p.top && r.kb === p.kb ? p : { h: r.h, top: r.top, kb: r.kb }));
      // 유령 키보드에 막 들어섰으면 — 고치기 전 값을 잡고, 다시 재게 한 뒤 값(ia·va)과 함께 맥에 한 줄
      if (r.ghost && !wasGhost) {
        const before = snapshot(frame.current);
        relayout();
        later(400, () => {
          const vv = window.visualViewport;
          void phoneDiag('vp-ghost', diagLine({ ...before, ia: window.innerHeight, va: vv?.height ?? -1, fixedH: frame.current?.getBoundingClientRect().height ?? -1 }));
        });
      }
      wasGhost = r.ghost;
      if (r.fixed && !fixSent) {
        fixSent = true;
        void phoneDiag('vp-fix', diagLine(snapshot(frame.current)));
      }
    };
    // 이름을 남기고 다시 읽기 — 진단 줄이 '무슨 사건 뒤에'를 알게
    const mark = (ev: string, fn: () => void) => () => { note(ev); fn(); };
    // 그려진 자리 — 화면 틀 위가 0 이 아닌 게 두 번 연달아 같으면 그만큼 보정. 보정을 바꿨으면 새 자리에서 다시 두 번
    const check = () => {
      if (document.hidden) return;
      const el = frame.current;
      if (el) {
        const rect = Math.round(el.getBoundingClientRect().top);
        const next = driftBias({ bias, rectTop: rect, prevRect: prev, editing: !!typingEl(), h: el.clientHeight || window.innerHeight });
        prev = next === bias ? rect : null;
        bias = next;
      }
      on();
    };
    // 키보드가 닫히는 중엔 값이 늦게 바뀐다 — 조금씩 띄워 다시 읽는다(800 은 유령 키보드 기다림 GHOST_MS 뒤)
    const soon = () => { for (const ms of [60, 300, 800]) later(ms, on); };
    // 포커스가 움직이면 키보드가 열리거나 닫히는 중 — 유령 판정은 여기서부터 다시 센다
    const focusMove = (ev: string) => () => { note(ev); lastTyping = Date.now(); soon(); };
    const onFocusOut = focusMove('fo');
    const onFocusIn = focusMove('fi');
    // 앱으로 돌아옴 — iOS 는 백그라운드에서 키보드를 내리는데 입력칸 포커스는 남겨 둔다. 남은 포커스면 '쓰는 중'으로 보여 유령 키보드를 못 고쳐서 풀어 준다(글은 입력칸에 남는다)
    const back = (ev: string) => {
      note(ev);
      const el = typingEl();
      if (el && el.tagName !== 'IFRAME') el.blur();
      soon();
    };
    const onVisible = () => { if (!document.hidden) back('vis'); };
    const onPageShow = () => back('ps');
    // 손을 뗐을 때(시트 끌기·누르기) — 끌다 키보드가 닫히면 사건 없이 끝날 수 있다
    const onTouchEnd = () => { note('te'); later(350, on); };
    const onResize = mark('rs', on);
    const onScroll = mark('sc', on);
    const onOrient = mark('or', soon);
    const onResume = mark('rm', soon);
    const tick = window.setInterval(check, 1000);
    (v ?? window).addEventListener('resize', onResize);
    v?.addEventListener('scroll', onScroll);
    window.addEventListener('orientationchange', onOrient);
    window.addEventListener(RESUME_EVENT, onResume);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    return () => {
      (v ?? window).removeEventListener('resize', onResize);
      v?.removeEventListener('scroll', onScroll);
      window.removeEventListener('orientationchange', onOrient);
      window.removeEventListener(RESUME_EVENT, onResume);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      window.clearInterval(tick);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [frame]);
  return vp;
}
