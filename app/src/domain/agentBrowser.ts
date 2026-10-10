// 세션 브라우저 앱에서 보기(2026-10-03 사용자 "가보자") — 참모 브라우저 래퍼가 적은 상태(agent_lives)를 세션과 잇고,
// 크게 보일지·탭 띠·프레임을 정한다. Rust agent_browser.rs 가 CDP 로 화면을 받는다
import { tr } from '../i18n';

export type LiveTab = { index: number; title: string; url: string; current: boolean };
/** 래퍼 상태 파일 — 하는 일 한 줄(tool)엔 값이 없다(live.js toolLine) */
export type Live = { profile: string; pid: number; sessionPid: number; url: string; title: string; tabs: LiveTab[]; tool: string; toolAt: number; busy: boolean; ts: number;
  /** 세션이 사람을 부름(browser_ask_human) — 앱이 크게 띄운다 */
  ask?: { reason: string; at: number } | null;
  /** 래퍼가 개입 때 세션 도구를 붙잡을 수 있다(없으면 스크립트 크롬·옛 래퍼 — 멈추지 못함) */
  gate?: boolean;
  /** 세션 도구가 사람이 돌려주길 기다리기 시작한 때(ms, 0 = 안 기다림) */
  held?: number;
  /** 사람이 개입 중(앱 takeover.rs 가 채움) */
  takeover?: { by: 'desktop' | 'phone'; at: number } | null;
  /** 이 크롬을 같이 쓰는 산 스크립트 수(chammo-browser launch) — 앱이 채움. 스크립트는 개입해도 못 멈춘다 */
  scripts?: number;
  /** 크롬이 그림 밖에 자기 창(패스키·Touch ID·폰 QR)을 띄워 둠 — 앱이 1초마다 채운다(모달을 안 봐도, agent_browser watch_popups) */
  popup?: boolean;
  /** 폰 목록에만 — 화면 받기 상태(맥 일꾼이 있을 때, agent_browser phone_screen). 이유는 주소를 뺀 한 줄 */
  screen?: PhoneScreen | null };
export type PhoneScreen = { error: string; attached: boolean; pages: number };

/** 사람이 조작해도 되나(2026-10-06 사용자) — 평소엔 보기만(view), 개입 중(mine)·세션이 부르는 중(ask)만 조작 */
export type Control = 'view' | 'mine' | 'ask';
export const controlOf = (l: Live | undefined): Control => (!l ? 'view' : l.ask ? 'ask' : l.takeover ? 'mine' : 'view');

/** 개입 중 한 줄 — 누가 쥐었나·세션이 기다리나. 멈추지 못하는 브라우저(gate 없음)면 섞일 수 있다고, 같이 쓰는 스크립트가 있으면 그건 못 멈춘다고. 개입 아니면 null */
export function takeoverLine(l: Live): string | null {
  if (!l.takeover) return null;
  const who = l.takeover.by === 'phone' ? tr('폰에서 조작 중', 'Being controlled from the phone') : tr('사람이 조작 중', 'You are in control');
  const n = l.scripts ?? 0;
  const scripts = n > 0 ? ` · ${tr(`같이 쓰는 스크립트 ${n}개는 멈추지 못해`, `${n} script${n > 1 ? 's' : ''} sharing it can't be paused`)}` : '';
  if (!l.gate) return `${who} — ${tr('이 브라우저는 세션을 멈추지 못해 (조작이 섞일 수 있어)', 'this browser cannot pause the session (actions may mix)')}${scripts}`;
  return `${who} — ${l.held ? tr('세션은 기다리는 중', 'the session is waiting') : tr('세션이 브라우저를 쓰려 하면 기다려', 'the session will wait if it needs the browser')}${scripts}`;
}
/** 사이트가 물은 권한(agent_tabs permission) — 숨긴 크롬 말풍선 대신 모달에서 허용·거부 */
export type PagePermission = { kind: 'geolocation' | 'notifications'; origin: string };
export function permLine(p: PagePermission): string {
  const host = p.origin.replace(/^[a-z]+:\/\//, '');
  return p.kind === 'geolocation' ? tr(`${host} 이(가) 위치를 쓰려고 해`, `${host} wants to use your location`) : tr(`${host} 이(가) 알림을 보내려고 해`, `${host} wants to send notifications`);
}

/** 구글 등 '…로 계속'(FedCM) 계정 고르기(agent_tabs fedcm) — 크롬 자체 창이라 그림에 안 찍혀 모달 단추로 받는다(2026-10-10) */
export type FedcmDialog = { dialogId: string; type: string; title: string; accounts: { email: string; name: string }[] };
export function fedcmLine(f: FedcmDialog): string {
  return f.title || tr('사이트가 계정으로 로그인하려고 해', 'The site wants to sign you in with an account');
}
/** 단추들 — account = 고른 계정 번호(확인 창은 '계속' = 0), null = 닫기 */
export function fedcmChoices(f: FedcmDialog): { label: string; account: number | null }[] {
  const close = { label: tr('닫기', 'Close'), account: null };
  if (f.type === 'AccountChooser') return [...f.accounts.map((a, i) => ({ label: a.email || a.name, account: i })), close];
  if (f.type === 'ConfirmIdpLogin') return [{ label: tr('계속', 'Continue'), account: 0 }, close];
  return [close];
}

/** 래퍼에 부탁한 대화상자 답 결과(agent_tabs wrapperDialog) */
export type WrapperDialog = { at: number; ok: boolean; error: string };

/** 멈춘 탭 안내 한 줄 — 앱이 붙기 전에 뜬 대화상자는 앱이 못 답해 래퍼(처음부터 붙은 playwright)에 부탁한다. askedAt = 부탁한 때(ms) */
export function stuckLine(askedAt: number | null, done: WrapperDialog | null): string {
  if (askedAt == null) return tr('페이지가 멈춰 있어 — 대화상자가 떠 있을 수 있어', 'The page is stuck — a dialog may be open');
  if (!done || done.at < askedAt) return tr('세션 브라우저로 답하는 중…', 'Answering through the session browser…');
  return done.ok ? tr('대화상자에 답했어', 'Answered the dialog') : tr('세션 브라우저도 못 풀었어 (다른 탭 것일 수 있어)', 'The session browser couldn’t close it either (it may be on another tab)');
}
export type CdpPage = { id: string; url: string; title: string };
export type Tab = { id: string; label: string; url: string; active: boolean; dialog: boolean };

/** 그 세션의 브라우저 — 래퍼의 부모 프로세스(sessionPid) = 세션 프로세스(procPid) */
export const liveOf = (s: { procPid?: number }, lives: Live[]): Live | undefined => (s.procPid ? lives.find((l) => l.sessionPid === s.procPid) : undefined);

/** 이만큼 조용하면(도구 호출도 화면 변화도 없음) 브라우저 일이 끝난 것 — 터미널이 다시 커진다 */
export const QUIET_MS = 45_000;

/** 브라우저를 크게 보여 줄까 — 사람을 기다리거나(작은 띠로 접히면 '사람 필요'가 안 보였다, QA B2), 도구가 도는 중이거나, 마지막 도구 호출·화면 변화가 QUIET_MS 안 */
export function browserBig(live: Live | undefined, lastFrameAt: number, now: number): boolean {
  if (!live) return false;
  return !!live.ask || live.busy || now - Math.max(live.toolAt, lastFrameAt) < QUIET_MS;
}

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

/** 열린 탭 띠 — CDP 탭 순서, 제목 없으면 호스트, 빈 탭은 '새 탭'. 대화상자가 떠 있는 탭은 표시(다른 탭을 보는 동안에도 어디서 기다리는지) */
export function tabStrip(pages: CdpPage[], current: string | null | undefined, dialogTabs: string[] = []): Tab[] {
  return pages.map((p) => ({ id: p.id, label: p.title || hostOf(p.url) || tr('새 탭', 'New tab'), url: p.url, active: p.id === current, dialog: dialogTabs.includes(p.id) }));
}

/** agent_frame 응답 — [순번 8바이트 LE][jpeg]. 비었으면 새 프레임 없음 */
export function unpackFrame(buf: ArrayBuffer): { seq: number; jpeg: Uint8Array } | null {
  if (buf.byteLength <= 8) return null;
  const v = new DataView(buf);
  const seq = v.getUint32(0, true) + v.getUint32(4, true) * 2 ** 32;
  return { seq, jpeg: new Uint8Array(buf, 8) };
}

/**
 * 모달 머리에 보일 사이트(2026-10-04 QA B3 — 비밀번호를 치는 화면인데 진짜 사이트인지 확인할 길이 없었다).
 * 페이지 제목은 페이지가 정하니 안 쓰고, 크롬이 아는 탭 주소(CDP)에서 호스트만 — URL 이 표준화해 주니
 * 사용자 정보 속이기(google.com@evil.com)는 진짜 호스트로, 닮은 글자 도메인은 퓨니코드(xn--)로 보인다
 */
export function siteOf(url: string | null | undefined): { host: string; secure: boolean } | null {
  if (!url) return null;
  if (url === 'about:blank') return { host: url, secure: false };
  let u: URL;
  try { u = new URL(url.startsWith('blob:') ? url.slice(5) : url); } catch { return null; }
  if (u.protocol === 'https:' || u.protocol === 'http:') return u.host ? { host: u.host, secure: u.protocol === 'https:' } : null;
  return { host: u.protocol, secure: false }; // data: · file: · chrome: … — 호스트가 없으니 종류를 그대로
}

/** 모달 머리 주소 = Rust 가 입력을 보내는 지금 탭(current — 팝업이면 팝업, 고정한 탭이면 그 탭)의 주소. 못 찾으면 null('주소 확인 중') */
export const currentSite = (pages: CdpPage[], current: string | null | undefined) => siteOf(pages.find((p) => p.id === current)?.url);

/** 세션 칸 상태 — 브라우저가 사람을 기다리면 '일하는 중'(도구가 도는 중이라) 대신 사람 필요(QA B2). 끝난 세션의 남은 부름은 무시 */
export function paneStatus<S extends string>(status: S, live: Live | undefined): S | 'human' {
  return live?.ask && status !== 'done' ? 'human' : status;
}

/** 어느 세션 브라우저인지 — '프로젝트 · 세션 이름'(이름이 없거나 프로젝트와 같으면 프로젝트만), 세션을 못 찾으면 브라우저 프로필 */
export function askName(live: Live, sessions: { procPid?: number; name?: string; cwd: string }[]): string {
  const s = sessions.find((x) => x.procPid && x.procPid === live.sessionPid);
  if (!s) return live.profile;
  const proj = s.cwd.replace(/\/+$/, '').split('/').pop() || live.profile;
  return s.name && s.name !== proj ? `${proj} · ${s.name}` : proj;
}

/**
 * 화면 받기 실패 이유(Rust 일꾼 error) → 'off'(브라우저가 꺼진 듯 — 연결 거절·상태 파일 없음·끊김) · 'fail'(그 밖) · null(문제 없음).
 * 이유 없이 '화면 받는 중'에 멈춰 사람이 기다리기만 했다(2026-10-05 QA 5)
 */
export function frameTrouble(error: string | null | undefined): 'off' | 'fail' | null {
  if (!error) return null;
  return /no live|refused|reset|closed|broken pipe|os error (32|54|61)/i.test(error) ? 'off' : 'fail';
}

/** 닫힘 덮개 한 줄 — 맥 모달(FrameView)·폰이 같이 쓴다. 옆 줄 '화면을 못 받았어'와 같은 반말로 */
export const closedText = () => tr('브라우저가 닫혔어 — 세션이 다시 열면 이어져', 'The browser is closed — it resumes when the session opens it again');

/** 지금 탭을 이만큼 넘게 모르면(주소 확인 중) 이유를 보이고 입력을 막는다 — 탭 이동·팝업 닫힘 같은 잠깐은 그 안에 끝난다 */
export const UNSURE_MS = 3000;
/** 목록에서 이만큼 넘게 빠져야 닫힘 — 바쁜 맥에서 포트 확인(300ms)이 한 번 늦으면 한 틱(1.5초) 빠진다(리뷰). 그동안 입력은 Rust 가 상태 파일로 보낸다 */
export const GONE_MS = 2500;
/** 탭 0개가 이만큼 이어져야 닫힘 — 세션이 탭을 바꾸며 닫고 열기·꺼낸 창을 닫은 뒤 빈 탭 다시 열기(keep_loop 400ms)가 겹치는 틈(리뷰) */
export const EMPTY_MS = 1500;

/**
 * 폰 브라우저 보기가 화면을 못 받는 이유 한 줄 — 괜찮으면 null. 맥 모달과 같은 판단(browserScreen)에 폰이 프레임을 못 받은 이유(pullErr)를 더한다.
 * 예전엔 실패를 조용히 삼켜 '화면 받는 중'에 이유 없이 멈췄다(2026-10-05 남은 것 ①). emptyMs = 붙었는데 탭 0개가 이어진 시간
 */
export function phoneTrouble(screen: PhoneScreen | null | undefined, pullErr: string, emptyMs: number): { kind: 'closed' | 'fail'; text: string } | null {
  const closed = { kind: 'closed' as const, text: closedText() };
  const fail = (why: string) => ({ kind: 'fail' as const, text: why ? `${tr('화면을 못 받았어', 'Could not get the screen')} — ${why}` : tr('화면을 못 받았어', 'Could not get the screen') });
  if (pullErr === 'no such browser') return closed;
  if (pullErr) return fail(pullErr);
  if (!screen) return null;
  const s = browserScreen({ goneMs: 0, error: screen.error, attached: screen.attached, pages: screen.pages, emptyMs, current: true, unsureMs: 0 });
  return s.kind === 'closed' ? closed : s.kind === 'fail' ? fail(screen.error) : null;
}

export type ScreenKind = 'ok' | 'checking' | 'closed' | 'fail';
/**
 * 크게 보기 화면이 진짜 화면인가(2026-10-05 사용자 실사용 — 닫힌 브라우저의 마지막 화면이 '사진'처럼 남아 눌러도 안 먹었다).
 * closed = 브라우저가 닫힘(목록에서 빠짐·포트에 못 붙음·붙었는데 탭 0개 — 맥 크롬은 마지막 창을 닫아도 포트가 산다),
 * fail = 화면을 못 받음, checking = 지금 탭을 모름(UNSURE_MS 안이면 막지 않는다 — 친 건 Rust 가 버리고 띠로 알린다).
 * blocked = 입력을 막는다(보내 봐야 버려진다). why = '주소 확인 중' 대신 머리에 보일 이유. *Ms = 그 상태가 이어진 시간
 */
export function browserScreen(x: { goneMs: number; error: string; attached: boolean; pages: number; emptyMs: number; current: boolean; unsureMs: number }): { kind: ScreenKind; why: string; blocked: boolean } {
  const trouble = frameTrouble(x.error);
  if (x.goneMs >= GONE_MS || trouble === 'off' || (x.attached && x.pages === 0 && x.emptyMs >= EMPTY_MS)) return { kind: 'closed', why: tr('브라우저 닫힘', 'Browser closed'), blocked: true };
  if (trouble === 'fail') return { kind: 'fail', why: tr('화면 못 받음', 'No screen'), blocked: true };
  if (x.current) return { kind: 'ok', why: '', blocked: false };
  if (x.unsureMs < UNSURE_MS) return { kind: 'checking', why: '', blocked: false };
  return { kind: 'checking', why: x.attached ? tr('지금 탭을 못 찾음', 'No current tab') : tr('브라우저에 붙는 중', 'Connecting to the browser'), blocked: true };
}

/**
 * '크롬에서 보기'가 실패한 이유 한 줄(Rust agent_focus 의 Err) — 예전엔 실패를 삼켜 눌러도 아무 일 없이 조용했다(2026-10-10 네이버 로그인).
 * 주소·포트는 빼고 짧게
 */
export function focusFailLine(err: unknown): string {
  const e = String(err instanceof Error ? err.message : err);
  if (/no live browser|chrome not found/.test(e)) return tr('브라우저가 꺼져 있어서 크롬 창을 못 꺼냈어', 'The browser is closed, so the Chrome window could not be shown');
  if (/still off screen/.test(e)) return tr('크롬 창을 화면으로 못 옮겼어 — 한 번 더 눌러 줘', 'Could not move the Chrome window on screen — try again');
  const why = e.replace(/\b(?:ws|https?):\/\/\S+/g, '…').replace(/\s+/g, ' ').trim().slice(0, 70);
  return `${tr('크롬 창을 못 꺼냈어', 'Could not show the Chrome window')} — ${why}`;
}

/** 사람이 그 브라우저를 쓰는 중으로 볼 시간 — 모달을 눌러 열었거나 화면·글칸을 만진 뒤 이만큼 */
export const ACTIVE_MS = 30_000;

/**
 * 패스키·Touch ID·폰 QR 처럼 크롬이 그림 밖에 자기 창을 띄웠을 때 모달이 할 일(2026-10-10 사용자 — 사람은 '크롬에서 보기'를 찾아가지 않는다).
 * 'peek' = 크롬을 작게 꺼낸다(사람이 쓰는 중일 때만 — 세션 혼자 돌다 뜬 건 알림·카드), 'unpeek' = 꺼냈던 걸 되돌린다(창이 사라졌거나 페이지가 넘어감).
 * peeked = 자동으로 꺼냈을 때의 주소(사람이 '크롬에서 보기'로 연 건 null — 저절로 안 숨긴다), failed = 이번 창에서 꺼내기 실패(다시 안 부른다)
 */
export function peekStep(x: { popup: boolean; shown: boolean; peeked: { url: string | undefined } | null; failed: boolean; active: boolean; url: string | undefined }): 'peek' | 'unpeek' | null {
  if (x.peeked) return !x.popup || x.url !== x.peeked.url ? 'unpeek' : null;
  // 주소를 모르면 기다린다 — 모른 채 꺼내면 주소가 오는 순간 '넘어갔다'로 보고 숨겼다
  return x.popup && !x.shown && !x.failed && x.active && x.url !== undefined ? 'peek' : null;
}
