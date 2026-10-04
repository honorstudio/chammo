// 폰 웹 푸시 판단 — 켤 수 있나·키 바꾸기·알림 눌러 열린 곳. 화면·통신 없음(ui/mobile/usePush)
import { readNoteTarget, type NoteTarget } from './notify';

export type PushSupport = 'ok' | 'need-home' | 'denied' | 'unsupported';

/** iOS 는 홈 화면에 붙인 앱(standalone)에서만 웹 푸시가 열린다(16.4+). 다른 곳은 탭에서도 */
export function pushSupport(f: { sw: boolean; push: boolean; notif: boolean; standalone: boolean; ios: boolean; permission: string }): PushSupport {
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

/** 구독이 사라졌을 때 저절로 다시 할까 — 알림 허락(granted)인데 구독이 없고, 사용자가 종으로 직접 끈 게 아니면.
 *  앱을 다시 빌드·서비스 워커가 바뀌어 iOS 가 구독을 놓쳐도 알림이 계속 오게(2026-10-03) */
export const autoResubscribe = (o: { can: PushSupport; permission: string; hasSub: boolean; userOff: boolean }) =>
  o.can === 'ok' && o.permission === 'granted' && !o.hasSub && !o.userOff;
