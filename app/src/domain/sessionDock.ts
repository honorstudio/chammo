// 세션 독(2026-10-12 패널 하나로 S1~S3) — 그 참모가 잡은 세션이 가운데 맨 아래 같은 자리에. 펼침 높이 판단만(시험: sessionDock.test.ts)

export const DOCK_DEFAULT = 240;
export const DOCK_MIN = 140;

/** 펼침 높이 — 끌어 정한 값(h, 없으면 기본)을 최소 140 ~ 가운데(room)의 60% 사이로. 가운데가 낮으면 최소가 이긴다 */
export function dockHeight(h: number | null, room: number): number {
  const want = h === null || !Number.isFinite(h) ? DOCK_DEFAULT : h;
  return Math.max(DOCK_MIN, Math.min(want, Math.floor(room * 0.6)));
}

/** 펼친 띠 폭(패널 하나로 P1 A) — 기본 240, 오른쪽 손잡이로 끌어 200~360, 앱 전체 한 값. 맡은 일 글이 길어도 안 늘어난다(191.png) */
export const RAIL_DEFAULT = 240;
export function railWidth(w: number | null): number {
  if (w === null || !Number.isFinite(w)) return RAIL_DEFAULT;
  return Math.max(200, Math.min(360, Math.round(w)));
}
