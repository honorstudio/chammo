// 페이지 전체 확대 막기 — 홈 화면 앱이 브라우저처럼 핀치·더블탭으로 커졌다(2026-10-03 사용자 "앱이 브라우저처럼 확대·축소가 된다").
// iOS 사파리는 viewport 의 user-scalable=no 를 접근성 때문에 무시해서 제스처 이벤트를 직접 막는다. 확대가 필요한 칸([data-zoom])은 그 안에서 ZoomBox 가 한다
const inZoom = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-zoom]');

export function blockPageZoom(doc: Document = document) {
  const stop = (e: Event) => { if (!inZoom(e.target)) e.preventDefault(); };
  // iOS 사파리 핀치(gesture*)
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(ev, stop, { passive: false });
  // 두 손가락 끌기 — 제스처 이벤트가 없는 브라우저
  doc.addEventListener('touchmove', (e) => { if ((e as TouchEvent).touches.length > 1) stop(e); }, { passive: false });
}
