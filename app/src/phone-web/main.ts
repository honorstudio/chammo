// 폰 입구 (ADR 0013) — 공개 주소의 첫 화면. 하는 일은 셋: QR 짝짓기(두드리기), 컴퓨터 화면 받아 두고 열기, Chammo 계정(구글) 로그인.
// 컴퓨터 화면(참모 채팅·카드·대기함·세션)은 여기 없다 — 터널로 그 컴퓨터에서 받아 서비스 워커가 / 에 내준다
import { OfflineError, tunnelFor } from './hub';
import { forgetKeys, phoneKeys } from './keys';
import { knockPair } from './knock';
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

const app = document.getElementById('app')!;

/** 화면 한 장 — 제목·글·단추(글자 단추: 낯선 동작이라 아이콘 대신) */
function screen(title: string, text: string, buttons: { label: string; primary?: boolean; run: () => void }[] = [], busy = false) {
  app.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  app.append(h, p);
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
  shape: '컴퓨터 Chammo 설정 > 기기 관리에서 QR 을 새로 만들어 찍어 주세요.',
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

/** Chammo 계정(구글) — 결과는 이 입구 주소로 돌아온다(서버 WEB_ORIGINS). 시작과 마침은 같은 폰 열쇠로 */
async function login(relay: string) {
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
    const r = await call(relay, k, dev, 'POST', '/v0/auth/google/finish', { loginId, code, deviceName: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Android' });
    if ((r.status !== 200 && r.status !== 201) || typeof r.json?.deviceId !== 'string') throw new Error(r.status === 409 ? '이 폰은 다른 Chammo 계정에 붙어 있어요' : `로그인 못 했어요 (${r.status})`);
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
  if (new URLSearchParams(hash.slice(1)).has('p')) return pairNow(hash, cfg.relay);
  if (q.get('login') && q.get('code') && relay) return finishLogin(relay, q.get('login')!, q.get('code')!);
  if (q.get('error') === 'login_failed') return screen('로그인 못 했어요', '구글 로그인이 끝나지 않았어요.', [{ label: '처음으로', run: () => location.replace('/pair') }]);
  // 짝지은 폰이 / 로 오면(받아 둔 화면이 아직 없을 때) 바로 받아서 연다
  if (link && store.get(TOKEN_KEY) && location.pathname !== '/pair') return open(link);
  const acc = account();
  const buttons = [
    ...(link && store.get(TOKEN_KEY) ? [{ label: `${link.macName ?? '컴퓨터'} 화면 열기`, primary: true, run: () => void open(link) }] : []),
    // 짝지은 폰 열쇠는 '폰' 기기라 로그인을 못 한다(중계 403, 보안 검토 B) — 짝짓기 전 폰만
    ...(relay && !acc && !link ? [{ label: 'Chammo 계정으로 로그인', run: () => void login(relay) }] : []),
  ];
  screen('참모', `컴퓨터 Chammo 설정 > 기기 관리에서 QR 을 이 폰 카메라로 찍어 주세요.${acc?.email ? ` · Chammo 계정 ${acc.email}` : ''}`, buttons);
}

// 이미 열린 입구에 QR 주소(# 만 다름)를 또 열면 페이지가 다시 안 읽힌다 — 다시 읽어 새 코드로
window.addEventListener('hashchange', () => location.reload());
void main();
