// 채팅 뷰 스페이스가 사람 모르게 바뀌지 않게(2026-10-06 사용자 "가끔 화면이 말도 안 되게 튄다") —
// 원칙: 사람이 보던 스페이스는 사람이 바꾸기 전엔 안 바뀐다. 다른 참모 일은 그 참모 탭에 넣어 두고 알림만.
// 그리고 바뀔 때마다 이유를 종류만 한 줄 남겨, 또 튀면 어느 길인지 잡히게
import type { DashFile } from './dashboard';
import type { ShowAt } from './showAt';
import { HOME_PICK } from './orchHome';
import { openTab, type LkHold } from './lockerTabs';
import { OFFICE } from './spaceOffice';

/** 탭(참모)마다 기억하는 스페이스 화면 — SpaceView screens 와 같은 모양 */
export type SavedScreen = { pick: string; modal: DashFile | null; focus?: { path: string; at: ShowAt; key: string } | null; scroll?: number; sheet?: string[] };

/** 띄운 파일(scripts/show)을 어디에 — 지금 보는 참모(또는 그 참모가 맡긴 세션)·주인 모름이면 지금 화면에 바로(here),
 *  다른 참모 것이면 그 참모 탭 화면에 넣어 두고 알림만. 예전엔 그 참모 탭으로 채팅·스페이스를 통째로 옮겼다(2026-10-01) */
export function showPlace(owner: string | null, viewing: string | undefined, chat?: string): 'here' | 'chat' | 'queue' {
  if (!owner || !viewing || owner === viewing) return 'here';
  // 메뉴로 다른 참모를 잠깐 보는 중이어도 채팅 탭 참모는 지금 대화 상대 — 그 참모 화면으로 옮겨 보여 준다(채팅 탭은 그대로)
  return owner === chat ? 'chat' : 'queue';
}

/** 한 번에 읽은 띄운 파일 여럿(show 기록은 3초마다 읽는다) — 다른 참모 것은 하나하나 그 탭에(queue), 지금 화면에 띄울 건 차례로 다(here, 마지막 것이 보인다).
 *  채팅 탭 참모 것이 있으면 그 참모로 옮겨(go) 띄우고, 보던 참모 것은 그 참모 탭 줄에 넣어 둔다. 주인 모르는 것은 옮겨 간 화면에.
 *  마지막 줄만 보니 두 참모가 같이 띄우면 앞 참모 문서가 그 탭에 안 들어갔고(2026-10-11), 보는 참모 것과 채팅 탭 참모 것이 같이 오면 앞 것이 버려졌다(bug-hunt L12).
 *  부르는 쪽 차례: go 로 옮기기 → queue 넣기(떠난 참모 탭 줄이 저장된 뒤라야 거기 쌓인다) → here 띄우기 */
export function showBatch<T extends { by: string }>(fresh: T[], ownerOf: (by: string) => string | null, viewing: string | undefined, chat?: string): { queue: { owner: string; show: T }[]; go: string | null; here: { show: T; owner: string | null }[] } {
  const queue: { owner: string; show: T }[] = [];
  const mine: { show: T; owner: string | null }[] = [];
  let go: string | null = null;
  for (const show of fresh) {
    const owner = ownerOf(show.by);
    const place = showPlace(owner, viewing, chat);
    if (place === 'queue' && owner) queue.push({ owner, show });
    else { if (place === 'chat') go = owner; mine.push({ show, owner }); }
  }
  if (!go) return { queue, go, here: mine };
  for (const m of mine) if (m.owner && m.owner !== go) queue.push({ owner: m.owner, show: m.show });
  return { queue, go, here: mine.filter((m) => !m.owner || m.owner === go) };
}

/** 다른 참모가 띄운 파일 — 그 참모 탭 줄 끝에 새 탭으로 넣어 두고 그 탭을 연 화면으로(그 참모로 가면 그 탭이 떠 있다).
 *  지금 화면에 띄울 때(SpaceView present)·시안 검토(queueReview)와 같은 규칙. 예전엔 md 가 아니면 미리보기 모달로 넣어 둬서, 그 참모로 가는 순간
 *  PDF 가 창 전체를 덮었다(2026-10-15 사용자). 모달은 사람이 '크게 보기'로 직접 고를 때만 — 그 참모 화면에 열어 둔 미리보기는 그대로 둔다 */
export function queueShow(saved: SavedScreen | undefined, hold: LkHold | null, owner: string, home: string, f: DashFile): { screen: SavedScreen; hold: LkHold } {
  const base: SavedScreen = saved ?? { pick: home, modal: null, sheet: [] };
  const focus = f.at ? { path: f.path, at: f.at, key: f.ts } : undefined; // 앞서 넣어 둔 짚을 곳은 지운다
  return {
    screen: { ...base, pick: `d:${f.path}`, modal: base.modal?.path === f.path ? null : base.modal, sheet: base.sheet ?? [], focus, scroll: undefined }, // 새 문서는 맨 위부터
    hold: openTab(hold, owner, base.pick, f.path),
  };
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

/** 문서 스크롤 자리 열쇠 — 참모 탭 + 화면(pick). 탭마다 하나만 기억하면 같은 탭에서 다른 문서를 띄웠다 ⌘[ 로 돌아올 때 맨 위였다(2026-10-11) */
export const scrollKey = (view: string | undefined, pick: string) => `${view ?? ''}\n${pick}`;
const SCROLL_KEEP = 200;
/** 떠날 때 스크롤 자리를 재는 칸 — 문서, 보관함(기록 목록·폴더, 카드·목록 보기 같은 칸), 홈 모드 칸, 세션 탭 옆칸(할 일·최근 결정). 2026-10-12 사용자: 보관함은 안 재서 맨 위로 */
export const SCROLL_PANES = ['.cv-doc-scroll', '.lk-page-wrap', '.hm-modes', '.sp-side'];
/** 화면에 돌아왔을 때 맞출 자리 — 적어 둔 게 있으면 그 자리. 없으면: 칸을 다시 쓰는 화면(보관함 — 폴더를 바꿔도 같은 칸이라 앞 폴더 자리가 남았다)은 맨 위,
 *  새로 그리는 화면은 null(손대지 않음 — 문서 '짚어 띄우기' 줄 맞춤을 덮지 않게) */
export function restoreTop(saved: number | undefined, reused: boolean): number | null {
  if (saved && saved > 0) return saved;
  return reused ? 0 : null;
}
/** 떠나는 화면의 스크롤 자리를 적는다 — 0 이면 지우고, 오래된 것부터 SCROLL_KEEP 개만 */
export function keepScroll(m: Map<string, number>, key: string, top: number): void {
  m.delete(key);
  if (top > 0) m.set(key, top);
  while (m.size > SCROLL_KEEP) m.delete(m.keys().next().value!);
}
