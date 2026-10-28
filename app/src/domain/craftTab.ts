import { closeTab, type LkHold } from './lockerTabs';
// Craft 맥 앱 스페이스 탭(2026-10-16) — 기본 자리는 스페이스 탭, 머리줄 아이콘 하나로 따로 창과 오간다(비추기는 한 곳만).
// 탭 칸은 비워 두고 Swift 비추기가 그 위에 얹힌다 — 웹은 칸 자리와 '보이는지'만 알려 준다(WebPage 미리보기와 같은 길)

export const craftKey = (app: string) => `k:${app}`;
export const craftAppOf = (key: string) => (key.startsWith('k:') ? key.slice(2) : '');

/** 인스턴스 키 → 앱 — 같은 앱을 세션마다 따로 띄우면 2·3번째는 '<앱>-2'·'<앱>-3'(2026-10-20 사용자, scripts/craft 와 같은 규칙) */
export const craftBase = (key: string) => key.replace(/^([a-z]+craft)-[23]$/, '$1');

/** 칸을 덮는 것 — 확인 창·미리보기 모달·메뉴·목록 팝업이 떠 있으면 네이티브 비추기를 숨긴다(안 그러면 그 위에 그려진다).
 *  목록은 칸을 살짝만 덮는 것(구석 메뉴) 몫 — 그 밖의 팝오버(결정 대기함 등)는 coveredAt 이 칸 안 9점으로 잡는다 */
export const COVERS = '.od-back, .dash-preview, .mc-pop, [role=listbox], [role=menu], .cv-switch';

/** 칸 안 9점(가장자리 10% 안쪽 격자)에서 맨 위 요소가 칸(이나 칸 안 안내)이 아니면 무언가 덮고 있다 — 목록에 없는 팝오버도 잡는 일반 규칙.
 *  top(x,y) = document.elementFromPoint, inside(el) = 칸 자신이거나 칸 안인가 */
export function coveredAt(b: Box, top: (x: number, y: number) => unknown, inside: (el: unknown) => boolean): boolean {
  if (b[2] <= 0 || b[3] <= 0) return false;
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.1, 0.5, 0.9]) {
      const el = top(b[0] + b[2] * fx, b[1] + b[3] * fy);
      if (el && !inside(el)) return true;
    }
  }
  return false;
}

export type Box = [number, number, number, number];

/** 떠 있는 팝오버(위 막대 계정 메뉴·결정 대기함·보관함·다른 기기 목록·대화상자) — 칸과 겹치면 덮임으로 친다.
 *  9점 훑기는 칸 구석만 살짝 덮는 팝오버를 못 봐서 계정 목록이 참모 포토 칸 밑에 깔렸다(2026-10-22 사용자) */
export const POPS = '.acct-pop, .inbox-pop, .far-pop, .lk-pop, [role=dialog]';

/** 팝오버 상자 중 하나라도 칸과 겹치나(크기 0 = 숨은 것은 빼고) */
export const popOverlaps = (pane: Box, pops: Box[]): boolean =>
  pops.some((p) => p[2] > 0 && p[3] > 0 && p[0] < pane[0] + pane[2] && pane[0] < p[0] + p[2] && p[1] < pane[1] + pane[3] && pane[1] < p[1] + p[3]);

/** 칸 자리(CSS 점, 웹뷰 왼쪽 위 기준) — 기기 픽셀(dpr, 레티나면 0.5점)로 맞춰 같은 자리면 다시 안 보낸다.
 *  정수로만 밀면 칸이 12.5점에 있을 때 비추기가 13점에서 시작해 칸 끝 1px 에 웹 바탕이 비쳤다(10-28 사용자) */
export const boxOf = (r: { left: number; top: number; width: number; height: number }, dpr = 1): Box => {
  const k = dpr >= 1 ? dpr : 1;
  const q = (v: number) => Math.round(v * k) / k;
  return [q(r.left), q(r.top), q(r.width), q(r.height)];
};
export const sameBox = (a: Box | null, b: Box) => !!a && a.every((v, i) => v === b[i]);

/** 보이나 — 칸이 있고(접힌 패널 아님) 덮는 게 없을 때 */
export const shown = (b: Box, covered: boolean) => b[2] > 0 && b[3] > 0 && !covered;

/** 덮였을 때 마지막 프레임을 그림으로 깔까 — 칸이 보일 크기(Swift 가 숨기는 40점 기준 위)인데 무언가 덮었을 때만.
 *  비추기 층은 웹 위에 얹혀 팝오버를 가려서 덮이면 숨기는데, 그 밑이 검은 칸이라 통째로 검게 보였다(2026-10-19 실사용) */
export const wantStill = (b: Box, covered: boolean) => covered && b[2] >= 40 && b[3] >= 40;

/** Craft 칸(k:<앱>)에서 다른 데로 옮겼나 — 그 앱(숨기기 = 10분 뒤 저장·끄기 시작), 아니면 null. 앱 서랍(k:@apps)은 앱 칸이 아니다.
 *  2026-10-19 사용자: 스페이스의 Craft 글자 탭을 없앴다(독 아이콘이 탭) — 탭 X 대신 '옮기기'가 숨기기 */
export function leftCraft(prev: string, next: string): string | null {
  if (!prev.startsWith('k:') || prev === 'k:@apps' || prev === next) return null;
  return craftAppOf(prev);
}

/** 독(2초마다)에서 보이던 앱이 이만큼 연속으로 안 보이면 꺼짐 — 한 번 비는 건 읽기 틈일 수 있다 */
export const GONE_TICKS = 2;

/** 독 읽기 한 번 → 꺼진 앱. track = 앱 → 연속으로 안 보인 횟수(0 = 보임), 한 번이라도 보인 앱만 센다.
 *  사람이 앱을 직접 끄거나 앱이 죽으면 closed 알림이 안 와서 칸이 '앱이 꺼져 있어' 로 남았다(2026-10-21 사용자) */
export function craftGone(track: Record<string, number>, running: string[]): { track: Record<string, number>; gone: string[] } {
  const next: Record<string, number> = {};
  const gone: string[] = [];
  for (const a of running) next[a] = 0;
  for (const [a, n] of Object.entries(track)) {
    if (a in next) continue;
    if (n + 1 >= GONE_TICKS) gone.push(a);
    else next[a] = n + 1;
  }
  return { track: next, gone };
}

/** 꺼진 앱 칸을 모든 참모(지금 안 보는 참모까지)의 탭 줄·보던 화면에서 거둔다 — 지금 참모 줄(lkHold)은 부르는 쪽이 따로.
 *  keep = 그 참모 줄은 남긴다(주인이 정해진 칸을 남의 참모 줄에서만 거둘 때, 2026-10-21 주인 가르기).
 *  안 보던 참모로 돌아오면 그 칸을 다시 그렸고, 앱이 여럿이면 겹쳐 쌓였다(2026-10-21 사용자). 보던 화면만 그 칸이면 '' = 그 참모 홈 */
export function dropCraftEverywhere(key: string, saved: Map<string, LkHold>, screens: Map<string, { pick: string }>, keep?: string): void {
  for (const [orch, h] of saved) {
    if (orch === keep || !h.tabs.includes(key)) continue;
    const sv = screens.get(orch);
    const r = closeTab(h, key, sv?.pick ?? '');
    saved.set(orch, r.hold);
    if (sv && r.pick) screens.set(orch, { ...sv, pick: r.pick });
  }
  for (const [orch, sv] of screens) if (orch !== keep && sv.pick === key) screens.set(orch, { ...sv, pick: '' });
}
