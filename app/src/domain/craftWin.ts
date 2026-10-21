/**
 * Craft 맥 앱 따로 창(craft.html) — 머리줄 ①(이름·판·저장 상태 + 꺼내기·닫기)과 아래 줄(참모가 한 일)의 글.
 * 정보는 Rust craft_win_info(scripts/craft 가 남긴 <데이터>/craft-native/<앱>.json·.status.json + 비추기 상태)
 */
import { assistant, josa, tr } from '../i18n';

/** shot = 윈도우 — 비추기 대신 그 앱 조작 채널 그림(ui.screenshot)을 칸에 깐다(2026-10-21) */
export type MirrorState = 'waiting' | 'live' | 'no-permission' | 'no-window' | 'stopped' | 'not-built' | 'shot';

export interface CraftInfo {
  name: string;
  version: string;
  pid: number | null;
  last: string;
  dirty: boolean;
  mirror: MirrorState | string;
  /** 사람이 조작 중(개입) */
  takeover: boolean;
  /** 지금 비추는 자리 — window(따로 창)·space(스페이스 탭)·''(없음). 비추기는 한 곳만 */
  place?: string;
  /** 이 인스턴스를 띄운 세션 id — 칸 이름·아래 줄에 그 세션 별명(사람이 연 것은 빈 글) */
  by?: string;
}

// 닫기는 묻지 않는다 — 바뀐 게 있으면 scripts/craft close 가 저장하고 닫는다(사람 파일 자리 또는 보관함 Craft 폴더)
export const saveState = (i: CraftInfo) => ({ text: i.dirty ? tr('닫으면 저장', 'Saves on close') : tr('저장됨', 'Saved'), dirty: i.dirty });

/** 아래 줄 — who = 이 인스턴스를 띄운 세션 별명(모르면 대표 참모 이름). 같은 앱이 세션마다 떠도 누가 다루는지 보이게 */
export function doingLine(i: CraftInfo, who?: string): string {
  const w = who || assistant();
  if (i.pid == null) return tr('앱이 꺼져 있어', 'The app is not running');
  if (i.takeover) return tr(`직접 조작 중 — ${josa(w, '은', '는')} 멈춰서 기다려 · 다 했으면 돌려주기`, `You have control — ${w} is waiting · Hand back when done`);
  return i.last ? `${w} · ${i.last}` : tr(`${josa(w, '이', '가')} 다루는 중`, `${w} is working`);
}

/** 비추기가 안 될 때 칸 가운데 안내 — settings: 화면 기록 권한 열기 단추를 보일지 */
export function mirrorNote(i: CraftInfo): { text: string; settings: boolean } | null {
  switch (i.mirror) {
    case 'live':
    case 'shot':
      return null;
    case 'waiting':
      return { text: tr('앱 화면을 비추는 중…', 'Mirroring the app…'), settings: false };
    case 'no-permission':
      return {
        text: tr('화면 기록 권한이 한 번 필요해 — 이 앱 창 하나만 찍고 다른 화면은 안 본다. 허용한 뒤 Chammo 를 다시 켜야 해(맥 규칙).',
          'Screen Recording permission is needed once — only this app window is captured. Restart Chammo after allowing it (a macOS rule).'),
        settings: true,
      };
    case 'no-window':
      return { text: tr('앱 창을 못 찾았어 — 참모가 다시 띄우면 이어져.', 'The app window was not found — it comes back when the assistant reopens it.'), settings: false };
    case 'not-built':
      return { text: tr('이 빌드엔 비추기가 없어 — 참모는 명령으로 계속 다룰 수 있어.', 'This build has no mirroring — the assistant can still drive the app.'), settings: false };
    default:
      return { text: tr('비추기가 멈췄어 — 창을 닫았다 다시 열면 이어져.', 'Mirroring stopped — close and reopen this window.'), settings: false };
  }
}

/** 윈도우 칸 그림을 지금 받을까 — 보는 중(칸이 보이고 창이 보임)·개입 아님·받는 중 아님일 때, 1초에 한 번 또는 참모가 방금 한 일이 바뀌면 바로(명령 직후 한 장).
 *  shotLast = 마지막 그림을 받을 때의 last. 화면 밖 창이라도 받기마다 앱이 그림을 만든다(그리드 2fps 한 코어 9~12%, 포토 한 장 0.55초) — 1fps 를 넘기지 않는다 */
export function paneShotDue(s: { mirror: string; visible: boolean; docVisible: boolean; takeover: boolean; inFlight: boolean; lastAt: number; now: number; last: string; shotLast: string }): boolean {
  if (s.mirror !== 'shot' || !s.visible || !s.docVisible || s.takeover || s.inFlight) return false;
  return s.now - s.lastAt >= 1000 || s.last !== s.shotLast;
}

/** 화면 기록 권한 설정 화면 */
export const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/** 머리줄 개입 단추 — 누르면 on 으로(개입 켜기) */
export const takeButton = (i: CraftInfo) => (i.takeover ? { text: tr('돌려주기', 'Hand back'), on: false } : { text: tr('개입', 'Take over'), on: true });

/** 돌려받을 때 참모 입력칸에 넣는 한 줄(화면엔 안 띄운다 — 참모만 알면 된다) */
export const handbackLine = (name: string, changed: string) =>
  `[앱] ${name} 돌려받음 — 사람이 바꾼 것: ${changed.trim() || '바뀐 것 없음'} — 남은 스크립트를 다시 돌리지 말고 이 상태를 보고 사람에게 다음을 물어(이어서 하라면 사람이 바꾼 걸 반영해 다시 짠다)`;

/** 돌려받음 [앱] 줄을 받을 참모 순서 — 그 칸이 떠 있는 참모 탭(사람이 개입한 곳) → 그 앱을 연 참모(scripts/craft 의 by) → 대표 참모.
 *  앞 사람이 없으면(세션이 꺼짐) 다음으로. 2026-10-19 회사 비서 탭에서 개입했는데 대표 참모(참모-2)에게 갔다 */
export function handbackTargets(owner: string | undefined, by: string | undefined, front: string | undefined): string[] {
  return [...new Set([owner, by, front].filter((x): x is string => !!x))];
}
