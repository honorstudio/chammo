// 앱이 다시 보일 때 — 백그라운드에서 돌아옴(visibilitychange·pageshow), 창이 다시 잡힘(focus), 망이 돌아옴(online), 알림을 눌러 서비스 워커가 창을 깨움(message go).
// 한데 모아 RESUME_EVENT 하나로(250ms 안 여러 번은 한 번). 받기 고리(domain/poller)가 이걸 듣고 매달린 요청을 끊고 바로 다시 받는다(2026-10-04 사용자 실기기)
import { RESUME_EVENT } from '../../domain/poller';

let installed = false;
export function installResume() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let last = 0;
  const fire = () => {
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    window.dispatchEvent(new Event(RESUME_EVENT));
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fire(); });
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) fire(); });
  window.addEventListener('focus', fire);
  window.addEventListener('online', fire);
  navigator.serviceWorker?.addEventListener('message', (e) => { if (typeof (e.data as { go?: unknown } | null)?.go === 'string') fire(); });
}
