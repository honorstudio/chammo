import { tr } from '../i18n';
import { parseLkPick } from './lockerTree';
// 보관함 탭 줄(2026-10-11 사용자) — 맨 왼쪽 고정 탭 둘(홈 집·보관함 폴더, 2026-10-12), 닫기 없음, 그 뒤로 연 파일 탭.
// 파일은 종류 상관없이 탭으로 연다(md·엑셀은 편집 페이지, 그림·영상·html·pdf 는 탭 안 미리보기). 모달은 '크게 보기'·카드 메뉴 '띄워 보기'로만

/** 보관함 화면 자리인가(홈 l:<참모>#h 는 아님) — 폴더 탭이 돌아갈 곳 */
const isFolderPick = (pick: string) => pick.startsWith('l:') && !pick.endsWith('#h');

/** 탭 열쇠 → 화면 키 — 파일은 경로(d:<경로>), 세션은 s:<id>·시안 검토는 c:<경로> 그대로(패널 하나로 S4: 세션 '크게' = 가운데 탭) */
export const tabPick = (key: string) => (key.startsWith('s:') || key.startsWith('c:') ? key : `d:${key}`);

/** 시안 검토 탭 열쇠 — 화면 키와 같다(c:<경로>) */
export const reviewKey = (path: string) => `c:${path}`;

/** 그 참모 보관함에서 연 탭 — back = 폴더 탭을 누르면 돌아갈 보관함 자리(l:…). tabs = 파일 경로 또는 세션 s:<id> */
export type LkHold = { orch: string; back: string; tabs: string[] };

export const MAX_TABS = 8;

/** 보관함에서 파일을 열었다 — 그 참모 탭 줄 끝에(이미 열렸으면 자리 그대로). here = 지금 화면 키 */
export function openTab(h: LkHold | null, orch: string, here: string, path: string): LkHold {
  const same = h && h.orch === orch ? h : null;
  const back = isFolderPick(here) ? here : same?.back ?? `l:${orch}`;
  const tabs = same ? (same.tabs.includes(path) ? same.tabs : [...same.tabs, path]) : [path];
  return { orch, back, tabs: tabs.slice(-MAX_TABS) };
}

/** 시안을 검토 탭으로 연다(fix/curation-space) — 창 전체를 덮던 검토 모드 대신 띄운 참모 탭 줄의 한 탭. 같은 시안의 html 탭(경로)이 있으면
 *  그 자리를 검토 탭으로 바꾼다 — 남겨 두면 검토를 닫을 때 그 탭으로 돌아가 또 시안을 알아보고 검토로 튀었다(X 가 안 닫힘, 2026-10-12 사용자) */
export function openReview(h: LkHold | null, orch: string, here: string, path: string): LkHold {
  const key = reviewKey(path);
  const same = h && h.orch === orch ? h : null;
  if (!same || !same.tabs.includes(path)) return openTab(h, orch, here, key);
  const tabs = same.tabs.includes(key) ? same.tabs.filter((x) => x !== path) : same.tabs.map((x) => (x === path ? key : x));
  return { ...same, back: isFolderPick(here) ? here : same.back, tabs };
}

/** 지금 보는 참모(orch)·화면(pick)의 탭 줄 — 맨 왼쪽 고정 탭 둘(홈·보관함, 닫기 없음)이 있으니 늘 있다(2026-10-12 사용자).
 *  homeOn = 홈(l:<참모>#h), folderOn = 보관함 화면(l:…), folderTo = 보관함 탭이 갈 곳(마지막에 본 보관함 자리) */
export type TabRow = { homeOn: boolean; folderOn: boolean; folderTo: string; tabs: { path: string; on: boolean }[] };
export function tabRow(h: LkHold | null, orch: string, pick: string): TabRow {
  const same = h && h.orch === orch ? h : null;
  const cur = pick.startsWith('d:') ? pick.slice(2) : pick.startsWith('s:') || pick.startsWith('c:') ? pick : '';
  return { homeOn: pick === `l:${orch}#h`, folderOn: isFolderPick(pick), folderTo: same?.back ?? `l:${orch}`, tabs: (same?.tabs ?? []).map((path) => ({ path, on: path === cur })) };
}

/** 탭 닫기 — 보던 탭이면 마지막 탭으로(다 닫으면 폴더로), 아니면 화면 그대로(pick null) */
export function closeTab(h: LkHold, path: string, pick: string): { hold: LkHold; pick: string | null } {
  const tabs = h.tabs.filter((x) => x !== path);
  const hold = { ...h, tabs };
  if (pick !== tabPick(path)) return { hold, pick: null };
  return { hold, pick: tabs.length ? tabPick(tabs[tabs.length - 1]!) : h.back };
}

/** ⌘W — 지금 보는 탭을 닫는다(2026-10-12 사용자). 보는 게 이 참모 탭 줄의 파일·문서·세션 탭이 아니면(홈·보관함 고정 탭, 탭 줄에 없는 화면) null = 아무것도 안 한다 */
export function closeCurrentTab(h: LkHold | null, orch: string, pick: string): { hold: LkHold; pick: string | null } | null {
  if (!h || h.orch !== orch) return null;
  const path = h.tabs.find((p) => tabPick(p) === pick);
  return path === undefined ? null : closeTab(h, path, pick);
}

/** 참모를 바꿀 때(2026-10-12 사용자) — 떠나는 참모의 탭 줄·보관함 자리를 그 참모 몫으로 적어 두고, 가는 참모가 적어 둔 것을 돌려준다(없으면 null).
 *  탭 줄(LkHold)이 참모 하나 몫이라, 다른 참모에서 파일을 열면 먼저 참모의 열린 탭이 사라졌다 */
export function swapHold(saved: Map<string, LkHold>, leaving: LkHold | null, to: string): LkHold | null {
  if (leaving) saved.set(leaving.orch, leaving);
  return saved.get(to) ?? null;
}

/** ⌘T 새 문서가 놓일 보관함 폴더 — 보관함 폴더를 보고 있으면 그 폴더(rel), 그 밖(보관함 맨 위·칩·홈·문서 탭·세션 탭…)이면 보관함 맨 위('') */
export function newDocFolder(pick: string): string {
  const p = parseLkPick(pick)?.place;
  return p?.kind === 'dir' ? p.rel : '';
}

/** 폴더 화면에서 파일 탭·홈 탭으로 갈 때 — 폴더 탭이 돌아올 자리를 지금 폴더로. 연 탭이 없어도 적는다(홈 갔다 오면 맨 위였다, 2026-10-12 사용자).
 *  맨 위 보관함은 기본 자리라 새로 안 만든다. 다른 참모 탭 줄이면 openTab 처럼 이 참모 것으로 */
export function leaveFolder(h: LkHold | null, orch: string, here: string): LkHold | null {
  if (!isFolderPick(here)) return h;
  const same = h && h.orch === orch ? h : null;
  if (same) return here !== same.back ? { ...same, back: here } : same;
  return here === `l:${orch}` ? h : { orch, back: here, tabs: [] };
}

/** 탭 문서 머리의 작은 경로 한 줄 — 보관함 맨 위면 '보관함', 안이면 보관함 속 폴더('자료', '10월 / 세부'), 밖이면 ~ 로 줄인 폴더 */
export function pathLine(path: string, lockerDir: string, home: string): string {
  const dir = path.replace(/\/[^/]*$/, '');
  if (lockerDir && dir === lockerDir) return tr('보관함', 'Locker');
  if (lockerDir && dir.startsWith(`${lockerDir}/`)) return dir.slice(lockerDir.length + 1).split('/').join(' / ');
  return home && (dir === home || dir.startsWith(`${home}/`)) ? `~${dir.slice(home.length)}` : dir;
}

/** 보여 준 파일(scripts/show·채팅 파일 카드)을 지금 참모 탭 줄에 새 탭으로 여나(홈·모드 v2 A) — 참모를 보고 있으면.
 *  오케스트레이터 홈(oh:)·기능 화면(f:)에서도 탭으로 열고 그 탭으로 간다(10/12 사용자 — 거기서 띄운 PDF 가 화면을 덮는 모달로 떴다).
 *  시안 검토(c:)도 탭이라 그 중에 띄운 것도 탭(fix/curation-space). 아니면 예전 길(미리보기) */
export function showInTab(_pick: string, orch: string | null): boolean {
  return !!orch;
}
