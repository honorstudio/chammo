// Craft 맥 앱 스페이스 탭(2026-10-16) — 기본 자리는 스페이스 탭, 머리줄 아이콘 하나로 따로 창과 오간다(비추기는 한 곳만).
// 탭 칸은 비워 두고 Swift 비추기가 그 위에 얹힌다 — 웹은 칸 자리와 '보이는지'만 알려 준다(WebPage 미리보기와 같은 길)

export const craftKey = (app: string) => `k:${app}`;
export const craftAppOf = (key: string) => (key.startsWith('k:') ? key.slice(2) : '');

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

/** 칸 자리(CSS 점, 웹뷰 왼쪽 위 기준) — 정수로 맞춰 같은 자리면 다시 안 보낸다 */
export const boxOf = (r: { left: number; top: number; width: number; height: number }): Box => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
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
