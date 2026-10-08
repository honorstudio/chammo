// 새 판 알아채기 — 홈 화면 앱은 백그라운드에서 돌아올 때 페이지를 다시 안 읽어서, 맥 앱을 새로 깔아도 옛 JS·CSS 로 계속 돈다
// (2026-10-05 밀기 줄 비침을 고친 판을 깔고도 폰엔 옛 판 선이 그대로). 돌아올 때 맥 껍데기의 입구 파일 이름을 지금 페이지 것과 맞대 보고,
// 바뀌었으면 한 번 새로 연다. 입력 초안은 저장소에 남는다(Composer writeDraft)
import { RESUME_EVENT } from '../../domain/poller';

const ENTRY = /src="\/assets\/(mobile-[A-Za-z0-9_-]{8}\.js)"/; // public/sw.js 의 ENTRY 와 같은 모양
const AGAIN_MS = 60_000;
const KEY = 'chammo-fresh-reload';

export const entryOf = (html: string) => ENTRY.exec(html)?.[1] ?? '';

/** page = 지금 페이지 입구(개발판은 ''), server = 맥 껍데기 입구('' = 못 읽음), lastReload = 지난번 이걸로 다시 연 때 */
export function shouldReload({ page, server, lastReload, now }: { page: string; server: string; lastReload: number; now: number }) {
  return !!page && !!server && page !== server && now - lastReload > AGAIN_MS;
}

const pageEntry = () => {
  const s = document.querySelector<HTMLScriptElement>('script[src*="/assets/mobile-"]');
  return s ? entryOf(`src="${new URL(s.src).pathname}"`) : '';
};
const last = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } };

let installed = false;
export function installFreshBuild() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const page = pageEntry();
  if (!page) return;
  let busy = false;
  window.addEventListener(RESUME_EVENT, () => {
    if (busy) return;
    busy = true;
    // navigate 가 아니라 서비스 워커가 안 가로챈다 — 늘 맥에서
    fetch('/', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        const now = Date.now();
        if (!shouldReload({ page, server: entryOf(html), lastReload: last(), now })) return;
        try { sessionStorage.setItem(KEY, String(now)); } catch { /* 못 적어도 연다 — 다음 돌아옴까지는 다시 안 온다 */ }
        location.replace('/');
      })
      .catch(() => {})
      .finally(() => { busy = false; });
  });
}
