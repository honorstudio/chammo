// 새 판 알아채기 — 홈 화면 앱은 백그라운드에서 돌아올 때 페이지를 다시 안 읽어서, 맥 앱을 새로 깔아도 옛 JS·CSS 로 계속 돈다
// (2026-10-05 밀기 줄 비침을 고친 판을 깔고도 폰엔 옛 판 선이 그대로). 맥 껍데기의 입구 파일 이름을 지금 페이지 것과 맞대 보고,
// 바뀌었으면 한 번 새로 연다. 입력 초안은 저장소에 남는다(Composer writeDraft)
// 맞대는 때 — 돌아올 때만이 아니라 처음 켤 때도(START_MS 뒤). 홈 화면 앱을 새로 켜면 서비스 워커가 받아 둔 옛 껍데기를 주고, 돌아올 때 한 번(5초 마감)뿐이라
// LTE 에서 터널이 늦으면 옛 판에 남았다 — 못 읽으면 RETRY_MS 뒤 다시(MAX_TRIES 까지). 11-08 사용자 폰: 맥엔 입력칸 고침이 깔렸는데 폰은 옛 판으로 가렸다
// 새 판으로 다시 열 때 맥 notify.log 에 한 줄(phone-diag fresh from=… to=… via=start|resume) — 폰이 새 판을 받았는지 맥에서 본다
import { RESUME_EVENT } from '../../domain/poller';
import { diagLine } from '../../domain/mobile';
import { phoneDiag } from '../../data/web';
import { readLink } from '../../phone-web/link';
import { tunnelFor } from '../../phone-web/hub';
import { fetchShell } from '../../phone-web/shell';

const ENTRY = /src="\/assets\/(mobile-[A-Za-z0-9_-]{8}\.js)"/; // public/sw.js 의 ENTRY 와 같은 모양
const AGAIN_MS = 60_000;
const KEY = 'chammo-fresh-reload';
/** 켠 뒤 이만큼 있다가 — 첫 화면 받기(대화·세션)와 같은 연결을 나눠 쓰지 않게 */
export const START_MS = 4000;
/** 못 읽었으면 다시 — 돌아온 직후엔 터널이 다시 붙는 중일 수 있다 */
export const RETRY_MS = 15_000;
export const MAX_TRIES = 4;
const FETCH_MS = 15_000;
/** 진단 한 줄을 보내고 다시 열기까지 기다리는 최대 — 다시 열면 날던 요청이 끊긴다 */
const DIAG_WAIT_MS = 1500;

export const entryOf = (html: string) => ENTRY.exec(html)?.[1] ?? '';

/** page = 지금 페이지 입구(개발판은 ''), server = 맥 껍데기 입구('' = 못 읽음), lastReload = 지난번 이걸로 다시 연 때 */
export function shouldReload({ page, server, lastReload, now }: { page: string; server: string; lastReload: number; now: number }) {
  return !!page && !!server && page !== server && now - lastReload > AGAIN_MS;
}

type Via = 'start' | 'resume';
export type FreshDeps = {
  page: string;
  /** 맥 껍데기 html — 못 읽으면 '' 또는 오류 */
  fetchHtml: () => Promise<string>;
  lastReload: () => number;
  markReload: () => void;
  now: () => number;
  /** 입력칸에 쓰는 중인가 — 그러면 손을 뗄 때까지 다시 열기를 미룬다 */
  typing: () => boolean;
  onBlur: (fn: () => void) => void;
  /** 다시 열기 전에 새 판 화면 파일을 받아 둔다(중계 길) */
  prefetch: () => Promise<void>;
  reload: () => void;
  diag: (line: string) => void | Promise<void>;
  later: (ms: number, fn: () => void) => void;
};

export function makeFreshBuild(d: FreshDeps) {
  let busy = false;
  let waiting = false; // 손 떼기를 기다리는 중 — 또 묻지 않는다
  const open = async (server: string, via: Via) => {
    d.markReload();
    await d.diag(diagLine({ from: d.page, to: server, via }));
    d.reload();
  };
  const check = (via: Via, tries = 1) => {
    if (busy || waiting) return;
    busy = true;
    void (async () => {
      let server = '';
      try { server = entryOf(await d.fetchHtml()); } catch { /* 못 읽음 — 아래에서 다시 */ }
      if (!server) {
        if (tries < MAX_TRIES) d.later(RETRY_MS, () => check(via, tries + 1));
        return;
      }
      if (!shouldReload({ page: d.page, server, lastReload: d.lastReload(), now: d.now() })) return;
      await d.prefetch();
      if (d.typing()) { waiting = true; d.onBlur(() => void open(server, via)); return; }
      await open(server, via);
    })().catch(() => {}).finally(() => { busy = false; });
  };
  return { check, start: () => d.later(START_MS, () => check('start')) };
}

const pageEntry = () => {
  const s = document.querySelector<HTMLScriptElement>('script[src*="/assets/mobile-"]');
  return s ? entryOf(`src="${new URL(s.src).pathname}"`) : '';
};
const typingNow = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable);
};

let installed = false;
export function installFreshBuild() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const page = pageEntry();
  if (!page) return;
  const fb = makeFreshBuild({
    page,
    // navigate 가 아니라 서비스 워커가 껍데기로 안 바꾼다 — 늘 맥에서(중계 길은 워커가 터널을 가진 창에 부탁)
    fetchHtml: () => fetch('/', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(FETCH_MS) }).then((r) => (r.ok ? r.text() : '')),
    lastReload: () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } },
    markReload: () => { try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* 못 적어도 연다 — 다음 돌아옴까지는 다시 안 온다 */ } },
    now: () => Date.now(),
    typing: typingNow,
    onBlur: (fn) => document.addEventListener('focusout', fn, { once: true }),
    // 중계 길은 / 를 서비스 워커가 받아 둔 껍데기로 준다 — 새 판 껍데기·화면 파일을 먼저 받아 두고 연다(ADR 0013)
    prefetch: () => { const relay = readLink(); return relay ? fetchShell(tunnelFor(relay), relay.relay) : Promise.resolve(); },
    reload: () => location.replace('/'),
    diag: (line) => Promise.race([phoneDiag('fresh', line), new Promise<void>((r) => setTimeout(r, DIAG_WAIT_MS))]),
    later: (ms, fn) => { window.setTimeout(fn, ms); },
  });
  fb.start();
  window.addEventListener(RESUME_EVENT, () => fb.check('resume'));
}
