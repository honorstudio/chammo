// 세션 브라우저 앱에서 보기(2026-10-03 사용자 "가보자") — 참모 브라우저 래퍼가 적은 상태(agent_lives)를 세션과 잇고,
// 크게 보일지·탭 띠·프레임을 정한다. Rust agent_browser.rs 가 CDP 로 화면을 받는다
import { tr } from '../i18n';

export type LiveTab = { index: number; title: string; url: string; current: boolean };
/** 래퍼 상태 파일 — 하는 일 한 줄(tool)엔 값이 없다(live.js toolLine) */
export type Live = { profile: string; pid: number; sessionPid: number; url: string; title: string; tabs: LiveTab[]; tool: string; toolAt: number; busy: boolean; ts: number;
  /** 세션이 사람을 부름(browser_ask_human) — 앱이 크게 띄운다 */
  ask?: { reason: string; at: number } | null };
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
