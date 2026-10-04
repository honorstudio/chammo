/** 검토용 시안(design-curation·flow-curation 껍데기)인가 — 껍데기는 앱에 `hodoc: 'cur-state'` 로 진행을 알린다.
 *  미리보기 창을 띄웠다가 시안이 알려 오면 검토 모드로 바꾸면 창이 번쩍 떴다 사라졌다(2026-09-30 사용자 "깜빡거린다") — 열기 전에 글로 본다 */
export const isCurationHtml = (html: string) => /hodoc\s*:\s*['"]cur-state['"]/.test(html);

/** 껍데기가 알려 온 저장분이 비었나 — 칸(marks·notes·decks·picks·flows…) 어느 하나라도 들어 있으면 빈 게 아니다.
 *  흐름 시안은 결정(picks)만 고를 수도 있어서, 칸 이름을 박아 두면 그것만 고른 기록을 못 되살렸다(2026-10-01) */
export const emptyStore = (d?: Record<string, unknown> | null) =>
  !d || Object.values(d).every((v) => !v || typeof v !== 'object' || !Object.keys(v as object).length);
