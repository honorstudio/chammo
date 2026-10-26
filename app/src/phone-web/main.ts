// 폰 입구 (ADR 0013) — 공개 주소의 첫 화면. 하는 일은 셋: Chammo 계정(구글) 로그인 → 내 컴퓨터 숫자 확인(ADR 0014), 컴퓨터 화면 받아 두고 열기,
// 옛 QR 짝짓기(두드리기 — 아이폰 사파리에선 안 함: 홈 화면 앱엔 안 남는다)
// 컴퓨터 화면(참모 채팅·카드·대기함·세션)은 여기 없다 — 터널로 그 컴퓨터에서 받아 서비스 워커가 / 에 내준다
import { OfflineError, tunnelFor } from './hub';
import { isIos, loginPlace } from './homeFirst';
import { forgetKeys, phoneKeys } from './keys';
import { knockPair } from './knock';
import { keyShape, knockLink, type Computer } from './linkKnock';
import { homeUrl, readLink, saveLink, type RelayLink } from './link';
import { planPair } from './pairPlan';
import { call } from './relayClient';
import { dropShell, fetchShell } from './shell';

const TOKEN_KEY = 'chammo.token'; // data/web.ts 와 같은 칸
const ACCOUNT_KEY = 'chammo.account';
const LOGIN_KEY = 'chammo.loginId';
const RETRY_MS = 10_000;

type Account = { email: string | null; device: string };
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 개인 정보 보호 모드 */ } },
};
const account = (): Account | null => { try { return JSON.parse(store.get(ACCOUNT_KEY) ?? 'null') as Account | null; } catch { return null; } };
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const homeFirst = () => loginPlace({ ios: isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0), standalone: standalone() }) === 'home-first';

const app = document.getElementById('app')!;

/** 화면 한 장 — 제목·글·단추(글자 단추: 낯선 동작이라 아이콘 대신) */
function screen(title: string, text: string, buttons: { label: string; primary?: boolean; run: () => void }[] = [], busy = false, figure?: Node) {
  app.replaceChildren();
  app.dataset.view = '';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  app.append(h, p);
  if (figure) app.append(figure);
  if (busy) {
    const s = document.createElement('div');
    s.className = 'pw-spin';
    s.setAttribute('aria-hidden', 'true');
    app.append(s);
  }
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.className = b.primary ? 'pri' : '';
    el.onclick = b.run;
    app.append(el);
  }
}

// 사파리 ⋯ → 공유 → 홈 화면에 추가 (iOS 26 — 옛 iOS 는 공유 단추가 아래 막대에 바로 있다). 고정 그림이라 innerHTML
const ADD_HOME_SVG = `<svg viewBox="0 0 320 100" width="100%" role="img" aria-label="사파리 더 보기, 공유, 홈 화면에 추가 순서" style="max-width:360px;margin:8px 0 16px">
  <g style="fill:none;stroke:var(--fg);stroke-width:2;stroke-linecap:round;stroke-linejoin:round">
    <circle cx="40" cy="36" r="24" style="stroke:var(--line)"/>
    <circle cx="160" cy="36" r="24" style="stroke:var(--line)"/>
    <path d="M160 24v18M153 31l7-7 7 7M151 36h-3v12h24V36h-3"/>
    <rect x="256" y="12" width="48" height="48" rx="12" style="stroke:var(--pri)"/>
    <rect x="268" y="24" width="24" height="24" rx="6" style="stroke:var(--pri)"/>
    <path d="M280 30v12M274 36h12" style="stroke:var(--pri)"/>
    <path d="M78 36h40M110 29l8 7-8 7M198 36h40M230 29l8 7-8 7" style="stroke:var(--sub)"/>
  </g>
  <g style="fill:var(--fg)"><circle cx="30" cy="36" r="2.5"/><circle cx="40" cy="36" r="2.5"/><circle cx="50" cy="36" r="2.5"/></g>
  <g style="fill:var(--sub);font-size:13px" text-anchor="middle"><text x="40" y="84">더 보기</text><text x="160" y="84">공유</text><text x="280" y="84" style="fill:var(--pri);font-weight:600">홈 화면에 추가</text></g>
</svg>`;

/** 아이폰 사파리 — 여기서 로그인하면 홈 화면 앱엔 안 넘어가니 홈 화면에 먼저 추가하게 */
function addHomeFirst() {
  const fig = document.createElement('div');
  fig.innerHTML = ADD_HOME_SVG;
  screen('홈 화면에 추가해 주세요', '아이폰은 사파리와 홈 화면 앱이 로그인을 따로 해요. 홈 화면에 추가한 참모 앱을 열어 거기서 로그인해요.', [], false, fig);
}

// 안드로이드 크롬 — 설치할 수 있으면 첫 화면에 설치 단추(이미 설치돼 있으면 이 이벤트가 안 온다)
type InstallPrompt = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPrompt | null = null;
let onStart: (() => void) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
  if (app.dataset.view === 'start') onStart?.();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (app.dataset.view === 'start') onStart?.();
});

/** 설치 창은 한 번만 띄울 수 있다 — 띄우고 나면 단추를 뺀다 */
async function install() {
  const p = installPrompt;
  installPrompt = null;
  await p?.prompt().catch(() => {});
  if (app.dataset.view === 'start') onStart?.();
}

async function config(): Promise<{ relay?: string }> {
  try { return (await (await fetch('/config.json', { cache: 'no-store' })).json()) as { relay?: string }; } catch { return {}; }
}

async function worker() {
  if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 서비스 워커가 없어요 — 사파리·크롬 최신판에서 열어 주세요');
  await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
}

/** 컴퓨터 화면을 받아 두고 연다. 컴퓨터가 꺼져 있으면 10초마다 다시 */
async function open(link: RelayLink) {
  screen('컴퓨터에 붙는 중', `${link.macName ?? '컴퓨터'} Chammo 화면을 받아 오고 있어요.`, [], true);
  try {
    await worker();
    await fetchShell(tunnelFor(link), link.relay);
    location.replace(homeUrl(location.search));
  } catch (e) {
    const off = e instanceof OfflineError;
    screen(off ? '컴퓨터가 꺼져 있어요' : '못 붙었어요', off ? `${link.macName ?? '컴퓨터'} Chammo 가 켜지면 저절로 붙어요.` : (e as Error).message, [{ label: '다시', primary: true, run: () => void open(link) }]);
    if (off) setTimeout(() => void open(link), RETRY_MS);
  }
}

const BAD: Record<string, string> = {
  shape: '이 QR 은 쓸 수 없어요 — 이 폰에서 Chammo 계정으로 로그인해 내 컴퓨터를 골라 주세요.',
  relay: '이 QR 은 이 입구의 중계 서버를 쓰지 않아요 — 내 컴퓨터 Chammo 에서 만든 QR 인지 봐 주세요.',
  config: '입구 설정(중계 주소)이 없어요 — 관리자에게 알려 주세요.',
};

/** 받아 둔 화면·열쇠·토큰·계정 표시를 다 지운다 — 다른 컴퓨터로 바꿀 때(보안 검토 A) */
async function wipeAll() {
  await dropShell().catch(() => {});
  store.set(TOKEN_KEY, null);
  store.set(ACCOUNT_KEY, null);
  saveLink(null);
}

/** 짝짓기 링크 — 다른 컴퓨터로 바꾸면 먼저 묻고, 짝지을 때마다 새 열쇠(보안 검토 A·D) */
async function pairNow(hash: string, relay: string | undefined, confirmed = false) {
  const plan = planPair(hash, relay, readLink(), confirmed);
  if (plan.kind === 'bad') return screen('이 QR 로는 못 짝지어요', BAD[plan.why]!);
  if (plan.kind === 'confirm') {
    return screen('다른 컴퓨터로 바꿀까요?', `지금은 ${plan.from} 와 짝지어 있어요. 바꾸면 이 폰에 받아 둔 화면과 열쇠가 지워지고 새 QR 의 컴퓨터와 다시 짝지어요.`, [
      { label: '바꾸기', primary: true, run: () => void pairNow(hash, relay, true) },
      { label: '그대로 두기', run: () => location.replace('/pair') },
    ]);
  }
  screen('짝짓는 중', '컴퓨터 Chammo 가 이 폰을 확인하고 있어요.', [], true);
  try {
    const prev = plan.sendPrev ? store.get(TOKEN_KEY) : null;
    if (plan.wipeAll) await wipeAll();
    await forgetKeys(); // 짝지을 때마다 새 열쇠 — 끊긴 열쇠로는 중계가 다시 안 받는다
    const { token, link } = await knockPair(plan.link, { home: standalone(), prev });
    store.set(TOKEN_KEY, token);
    saveLink(link);
    if (store.get(TOKEN_KEY) !== token) throw new Error('이 브라우저가 저장을 막아요(개인 정보 보호 모드?) — 일반 창에서 새 QR 을 찍어 주세요');
    await open(link);
  } catch (e) {
    screen('연결 못 했어요', (e as Error).message);
  }
}

/** 로그인한 폰 — 내 계정 컴퓨터 목록(ADR 0014). 대기 중이어도 숫자 확인으로 바로 허용받을 수 있다 */
async function mine(relay: string, acc: Account) {
  screen('내 컴퓨터 찾는 중', '', [], true);
  try {
    const k = await phoneKeys();
    const r = await call(relay, k, acc.device, 'GET', '/v0/me/self');
    if (r.status === 401 || r.status === 404) {
      store.set(ACCOUNT_KEY, null);
      return screen('이 폰이 계정에서 빠졌어요', '다른 기기에서 거절했거나 뺐어요. 다시 쓰려면 다시 로그인해요.', [{ label: 'Chammo 계정으로 로그인', primary: true, run: () => void login(relay) }]);
    }
    if (r.status !== 200 || !r.json) throw new Error(`내 컴퓨터를 못 받았어요 (${r.status})`);
    const pending = r.json.status === 'pending';
    const list = (Array.isArray(r.json.computers) ? r.json.computers : []) as Computer[];
    const pcs = list.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && keyShape(c.tunnelPub));
    const at = typeof r.json.autoAt === 'number' ? new Date(r.json.autoAt) : null;
    const auto = at ? ` ${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}까지 거절이 없으면 저절로 허용돼요.` : '';
    const title = pending ? '다른 기기에서 허용을 기다려요' : pcs.length ? '어느 컴퓨터를 열까요?' : '열 컴퓨터가 없어요';
    // 같은 폰의 다른 브라우저(아이폰 사파리 ↔ 홈 화면 앱) 로그인이 계정에 따로 있다 — 중계가 대기 폰에만 알려 준다
    const twin = pending && r.json.samePhone === true ? ' 하루 사이에 같은 종류 폰이 계정에 또 들어왔어요 — 이 폰 사파리 로그인이었다면 컴퓨터 기기 관리에서 빼 주세요.' : '';
    const text = pending
      ? `내 컴퓨터를 고르면 양쪽 화면에 같은 숫자가 떠요 — 같으면 컴퓨터에서 허용을 눌러요. 다른 기기 카드에서 허용해도 돼요.${auto}${twin}`
      : pcs.length ? '고르면 양쪽 화면에 같은 숫자가 떠요 — 같으면 컴퓨터에서 허용을 눌러요.' : '컴퓨터 Chammo 에서 같은 Chammo 계정으로 로그인하면 여기 나와요.';
    // online 은 허용된 폰에만 온다(대기 중이면 null — 모름)
    const first = pcs.find((c) => c.online !== false);
    screen(title, text, [
      ...pcs.map((c) => ({ label: `${c.name}${c.online === false ? ' (꺼짐)' : ''}`, primary: c === first, run: () => void linkTo(relay, acc, c) })),
      { label: '다시 보기', run: () => void mine(relay, acc) },
    ]);
  } catch (e) {
    screen('내 컴퓨터를 못 받았어요', (e as Error).message, [{ label: '다시', primary: true, run: () => void mine(relay, acc) }]);
  }
}

/** 지금 화면을 그리는 숫자 확인 — 앞선 확인이 늦게 실패해도 새 확인의 숫자 화면을 덮지 않게 */
let linkRun = 0;

/** 숫자 확인 — 숫자가 뜨면 컴퓨터에서 사람이 허용할 때까지 기다린다 */
async function linkTo(relay: string, acc: Account, c: Computer) {
  const me = ++linkRun;
  screen('컴퓨터에 묻는 중', `${c.name} 에 숫자 확인을 보내고 있어요.`, [], true);
  try {
    const { token, link } = await knockLink(relay, acc.device, c,
      (sas) => me === linkRun && screen(sas, `${c.name} 화면에 같은 숫자가 떴으면 거기서 허용을 눌러요. 숫자가 다르면 거절해요 — 누군가 가운데 끼어든 거예요.`, [], true),
      // 컴퓨터가 허용했다 — 이 폰에서도 사람이 한 번 더(양쪽 확인)
      (sas) => new Promise<boolean>((ok) => screen(`${sas}`, `컴퓨터 화면에 이 숫자가 떴었나요? 같았으면 '같았어요', 아니면 '달랐어요'를 눌러요.`, [
        { label: '같았어요', primary: true, run: () => ok(true) },
        { label: '달랐어요', run: () => ok(false) },
      ])));
    store.set(TOKEN_KEY, token);
    saveLink(link);
    if (store.get(TOKEN_KEY) !== token) throw new Error('이 브라우저가 저장을 막아요(개인 정보 보호 모드?) — 일반 창에서 다시 해 주세요');
    await open(link);
  } catch (e) {
    if (me === linkRun) screen('못 열었어요', (e as Error).message, [{ label: '다시', primary: true, run: () => void mine(relay, acc) }]);
  }
}

/** Chammo 계정(구글) — 결과는 이 입구 주소로 돌아온다(서버 WEB_ORIGINS). 시작과 마침은 같은 폰 열쇠로 */
async function login(relay: string) {
  if (homeFirst()) return addHomeFirst();
  try {
    const k = await phoneKeys();
    const dev = readLink()?.device ?? account()?.device ?? null;
    const r = await call(relay, k, dev, 'POST', '/v0/auth/google/begin', { returnTo: `${location.origin}/pair` });
    if (r.status !== 201 || typeof r.json?.url !== 'string' || typeof r.json.loginId !== 'string') throw new Error(`로그인을 못 시작했어요 (${r.status})`);
    sessionStorage.setItem(LOGIN_KEY, r.json.loginId);
    location.href = r.json.url;
  } catch (e) {
    screen('로그인 못 했어요', (e as Error).message, [{ label: '처음으로', run: () => location.replace('/pair') }]);
  }
}

async function finishLogin(relay: string, loginId: string, code: string) {
  screen('로그인 마치는 중', 'Chammo 계정에 이 폰을 붙이고 있어요.', [], true);
  try {
    if (sessionStorage.getItem(LOGIN_KEY) !== loginId) throw new Error('이 폰에서 시작한 로그인이 아니에요');
    sessionStorage.removeItem(LOGIN_KEY);
    const k = await phoneKeys();
    const dev = readLink()?.device ?? account()?.device ?? null;
    const r = await call(relay, k, dev, 'POST', '/v0/auth/google/finish', { loginId, code, deviceName: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Android', kind: 'phone' });
    if ((r.status !== 200 && r.status !== 201) || typeof r.json?.deviceId !== 'string') {
      throw new Error(r.status === 409 ? '이 폰은 다른 Chammo 계정에 붙어 있어요'
        : r.status === 403 && r.json?.error === 'key_rejected' ? '이 폰은 다른 기기에서 거절됐어요 — 24시간 뒤 다시 로그인할 수 있어요'
        : r.status === 429 ? '계정에 허용을 기다리는 기기가 5개를 넘었어요 — 다른 기기에서 먼저 정리해 주세요'
        : `로그인 못 했어요 (${r.status})`);
    }
    store.set(ACCOUNT_KEY, JSON.stringify({ email: typeof r.json.email === 'string' ? r.json.email : null, device: r.json.deviceId }));
    location.replace('/pair');
  } catch (e) {
    screen('로그인 못 했어요', (e as Error).message, [{ label: '처음으로', run: () => location.replace('/pair') }]);
  }
}

async function main() {
  const hash = location.hash;
  const q = new URLSearchParams(hash.startsWith('#login=') ? hash.slice(1) : location.search);
  // 코드 든 주소는 주소 줄·방문 기록에서 지운다
  if (hash || location.search) history.replaceState(null, '', location.pathname);
  const cfg = await config();
  const link = readLink();
  const relay = cfg.relay;
  // 옛 짝짓기 QR(#p=) — 아이폰 카메라는 늘 사파리로 연다. 사파리에서 짝지으면 홈 화면 앱엔 안 남으니 홈 화면부터(2026-10-24 사용자)
  if (new URLSearchParams(hash.slice(1)).has('p')) return homeFirst() ? addHomeFirst() : pairNow(hash, cfg.relay);
  if (q.get('login') && q.get('code') && relay) return finishLogin(relay, q.get('login')!, q.get('code')!);
  if (q.get('error') === 'login_failed') return screen('로그인 못 했어요', '구글 로그인이 끝나지 않았어요.', [{ label: '처음으로', run: () => location.replace('/pair') }]);
  // 짝지은 폰이 / 로 오면(받아 둔 화면이 아직 없을 때) 바로 받아서 연다
  if (link && store.get(TOKEN_KEY) && location.pathname !== '/pair') return open(link);
  const acc = account();
  // 로그인한 폰은 QR 없이 — 내 계정 컴퓨터를 골라 숫자 확인(ADR 0014)
  if (relay && acc?.device && !(link && store.get(TOKEN_KEY)) && location.pathname !== '/pair-qr') return mine(relay, acc);
  // 아이폰 사파리에서 아무것도 없이 열면 — 여기서 로그인·짝짓기하면 홈 화면 앱엔 안 남으니 홈 화면부터
  if (!acc && !link && homeFirst()) return addHomeFirst();
  onStart = () => start(relay, link, acc);
  start(relay, link, acc);
}

function start(relay: string | undefined, link: RelayLink | null, acc: Account | null) {
  const buttons = [
    ...(link && store.get(TOKEN_KEY) ? [{ label: `${link.macName ?? '컴퓨터'} 화면 열기`, primary: true, run: () => void open(link) }] : []),
    // 짝지은 폰 열쇠는 '폰' 기기라 로그인을 못 한다(중계 403, 보안 검토 B) — 짝짓기 전 폰만
    ...(relay && !acc && !link ? [{ label: 'Chammo 계정으로 로그인', primary: true, run: () => void login(relay) }] : []),
    ...(installPrompt ? [{ label: '홈 화면에 추가', run: () => void install() }] : []),
  ];
  // 폰은 QR 짝짓기가 아니라 계정 로그인으로 붙는다(ADR 0014) — 첫 화면은 로그인부터
  const text = link ? `${link.macName ?? '컴퓨터'} 와 연결돼 있어요.` : '컴퓨터 Chammo 와 같은 Chammo 계정(구글)으로 로그인하면 내 컴퓨터를 골라 열어요.';
  screen('참모', `${text}${acc?.email ? ` · Chammo 계정 ${acc.email}` : ''}`, buttons);
  app.dataset.view = 'start';
}

// 이미 열린 입구에 QR 주소(# 만 다름)를 또 열면 페이지가 다시 안 읽힌다 — 다시 읽어 새 코드로
window.addEventListener('hashchange', () => location.reload());
void main();
