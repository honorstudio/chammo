// 채팅 뷰 스페이스가 사람 모르게 바뀌지 않게(2026-10-06 사용자 "가끔 화면이 말도 안 되게 튄다") —
// 원칙: 사람이 보던 스페이스는 사람이 바꾸기 전엔 안 바뀐다. 다른 참모 일은 그 참모 탭에 넣어 두고 알림만.
// 그리고 바뀔 때마다 이유를 종류만 한 줄 남겨, 또 튀면 어느 길인지 잡히게
import type { DashFile } from './dashboard';
import type { ShowAt } from './showAt';
import { HOME_PICK } from './orchHome';
import { OFFICE, sheetOpen, showPick } from './spaceOffice';

/** 탭(참모)마다 기억하는 스페이스 화면 — SpaceView screens 와 같은 모양 */
export type SavedScreen = { pick: string; modal: DashFile | null; focus?: { path: string; at: ShowAt; key: string } | null; scroll?: number; sheet?: string[] };

/** 띄운 파일(scripts/show)을 어디에 — 지금 보는 참모(또는 그 참모가 맡긴 세션)·주인 모름이면 지금 화면에 바로(here),
 *  다른 참모 것이면 그 참모 탭 화면에 넣어 두고 알림만. 예전엔 그 참모 탭으로 채팅·스페이스를 통째로 옮겼다(2026-10-01) */
export function showPlace(owner: string | null, viewing: string | undefined, chat?: string): 'here' | 'chat' | 'queue' {
  if (!owner || !viewing || owner === viewing) return 'here';
  // 메뉴로 다른 참모를 잠깐 보는 중이어도 채팅 탭 참모는 지금 대화 상대 — 그 참모 화면으로 옮겨 보여 준다(채팅 탭은 그대로)
  return owner === chat ? 'chat' : 'queue';
}

/** 다른 참모 탭에 넣어 둘 화면 — 그 탭으로 가면 지금 화면에 띄우는 것과 똑같이 보이게(사무실이면 사무실 위 창·미리보기) */
export function queueShow(saved: SavedScreen | undefined, home: string, f: DashFile, md: boolean): SavedScreen {
  const base: SavedScreen = saved ?? { pick: home, modal: null, sheet: [] };
  const r = showPick(base.pick, f.path, md);
  if (!md) return { ...base, modal: f };
  const focus = f.at ? { path: f.path, at: f.at, key: f.ts } : undefined; // 앞서 넣어 둔 짚을 곳은 지운다
  if (r.sheet) return { ...base, sheet: sheetOpen(base.sheet ?? [], r.sheet), focus };
  return { ...base, pick: r.pick, modal: null, sheet: base.sheet ?? [], focus, scroll: undefined }; // 새 문서는 맨 위부터
}

/** 화면 키의 종류만 — 기록에 경로·세션 번호가 남지 않게 */
export function pickKind(k: string): string {
  if (!k) return 'none';
  if (k === HOME_PICK) return 'home';
  if (k === OFFICE) return 'office';
  const i = k.indexOf(':');
  return i > 0 ? k.slice(0, i) : 'other';
}

/** 스페이스가 바뀐 한 줄(JSON). why = 바꾼 길(tab·menu·click·pet·show·focus·back·follow·mount…).
 *  other = 채팅 탭 참모가 아닌 다른 참모 대시보드로 감(2026-10-06 캡처의 모양), view = 보는 참모가 바뀜, off = 보는 참모가 채팅 탭과 다름 */
export function traceLine(t: { ts: string; why: string; from: string; to: string; viewFrom?: string; viewTo?: string; chat?: string }): string {
  const toOrch = t.to.startsWith('o:') ? t.to.slice(2) : '';
  return JSON.stringify({
    ts: t.ts, why: t.why, from: pickKind(t.from), to: pickKind(t.to),
    ...(toOrch && t.viewTo && toOrch !== t.viewTo ? { other: true } : {}),
    ...(toOrch && !t.viewTo && t.chat && toOrch !== t.chat ? { other: true } : {}),
    ...(t.viewFrom !== t.viewTo ? { view: true } : {}),
    ...(t.viewTo && t.chat && t.viewTo !== t.chat ? { off: true } : {}),
  });
}
