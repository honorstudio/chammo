// 폰 웹 푸시 판단 — 켤 수 있나·키 바꾸기·알림 눌러 열린 곳. 화면·통신 없음(ui/mobile/usePush)
import { tr } from '../i18n';
import { findTarget } from './inbox';
import { readNoteTarget, type NoteTarget } from './notify';
import type { Session } from './session';

export type PushSupport = 'ok' | 'need-home' | 'denied' | 'unsupported' | 'insecure';

/** iOS 는 홈 화면에 붙인 앱(standalone)에서만 웹 푸시가 열린다(16.4+). 다른 곳은 탭에서도.
 *  secure = https 로 열렸나 — http://100.x(테일넷 HTTPS 인증서 꺼짐)면 서비스 워커·푸시가 아예 없어 홈 화면 앱으로도 안 된다 */
export function pushSupport(f: { sw: boolean; push: boolean; notif: boolean; standalone: boolean; ios: boolean; permission: string; secure: boolean }): PushSupport {
  if (!f.secure) return 'insecure';
  if (f.ios && !f.standalone) return 'need-home';
  if (!f.sw || !f.push || !f.notif) return 'unsupported';
  if (f.permission === 'denied') return 'denied';
  return 'ok';
}

/** base64url(패딩 없음) → 바이트 — pushManager.subscribe 의 applicationServerKey */
export function b64urlBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 알림을 눌러 열린 주소(?go=) → 갈 곳(domain/notify noteTarget 과 같은 글자) */
export function goFrom(search: string): NoteTarget | null {
  const g = new URLSearchParams(search).get('go');
  return g ? readNoteTarget(g) : null;
}

/** 눌린 알림에서 폰이 할 일 — orch = 그 참모 채팅으로(시트는 닫고), card = 그 채팅에서 짚을 카드(dashList 열쇠 w:·d:),
 *  team = 팀 탭의 그 대화, picker = 답을 기다림 목록. 모르는 참모면 null(보던 화면 그대로) */
export type NoteJump = { orch?: string; card?: string; team?: string; picker?: true };

export function noteJump(t: NoteTarget, orchs: Session[]): NoteJump | null {
  if (t.to === 'inbox') return { picker: true };
  if (t.to === 'team') return { team: t.room };
  if (t.to === 'latest') return null;
  const o = findTarget(orchs, t.to === 'card' ? t.orch : t.id);
  if (!o) return null;
  return t.to === 'card' ? { orch: o.id, card: t.card } : { orch: o.id };
}

/** 컴퓨터가 준 마지막 알림 갈 곳(/api/push-last)을 믿을 만한가 — 30분 안의 것만(오래된 알림 칸을 눌렀을 때 엉뚱한 데로 안 가게) */
export const LAST_MAX_S = 30 * 60;
export function lastUsable(r: { target: string; age: number | null }): NoteTarget | null {
  if (r.age === null || r.age > LAST_MAX_S) return null;
  const t = readNoteTarget(r.target);
  return t && t.to !== 'latest' ? t : null;
}

/** 구독이 사라졌을 때 저절로 다시 할까 — 알림 허락(granted)인데 구독이 없고, 사용자가 종으로 직접 끈 게 아니면.
 *  앱을 다시 빌드·서비스 워커가 바뀌어 iOS 가 구독을 놓쳐도 알림이 계속 오게(2026-10-03) */
export const autoResubscribe = (o: { can: PushSupport; permission: string; hasSub: boolean; userOff: boolean }) =>
  o.can === 'ok' && o.permission === 'granted' && !o.hasSub && !o.userOff;

/** 종을 눌렀는데 못 켤 때 까닭(폰 OrchDash) — 탭 이름은 데스크톱 설정 그대로('기기 관리', QA 2차) */
export const PUSH_HINT: Record<string, string> = {
  'need-home': tr('아이폰은 홈 화면에 추가한 앱에서만 알림을 받아요 — 사파리 공유 → 홈 화면에 추가한 뒤, 아래 \'홈 화면 앱 연결\' 코드를 그 앱에 붙여 넣어요', "iPhone only gets notifications in an app added to the Home Screen — in Safari tap Share, then Add to Home Screen, and paste the 'Connect Home Screen app' code below into that app"),
  denied: tr('알림이 막혀 있어요 — 폰 설정 > 알림에서 참모를 허용해 주세요(브라우저 탭으로 열었으면 그 브라우저의 사이트 설정에서)', 'Notifications are blocked — allow Chammo in Phone settings > Notifications (or in the browser site settings if opened in a browser tab)'),
  insecure: tr('http 주소로 열려서 알림·앱 설치·마이크가 안 돼요 — 컴퓨터 Chammo 설정 > 기기 관리 안내대로 테일스케일 HTTPS 를 켠 뒤 새 QR 로 다시 열어 주세요', 'Opened over http, so notifications, app install and the microphone do not work — turn on Tailscale HTTPS as described in Chammo settings > Devices on your computer, then reopen with a new QR code'),
};

/** 종 켜기 실패 글 — 브라우저 오류는 영어라(iOS 'User denied push permission') 우리말로. 우리가 만든 한글 오류는 그대로(QA 2차) */
export function pushError(e: Error): string {
  if (e.name === 'NotAllowedError') return tr('알림 허락이 막혔어요 — 폰 설정 > 알림에서 참모를 허용한 뒤(브라우저 탭으로 열었으면 그 브라우저의 사이트 설정에서) 다시 눌러 주세요', 'Notification permission was blocked — allow Chammo in Phone settings > Notifications (or in the browser site settings if opened in a browser tab), then tap again');
  return /[가-힣]/.test(e.message) ? e.message : tr(`알림을 못 켰어요 — ${e.message}`, `Could not turn on notifications — ${e.message}`);
}
