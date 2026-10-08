/** 검토용 시안(design-curation·flow-curation 껍데기)인가 — 껍데기는 앱에 `hodoc: 'cur-state'` 로 진행을 알린다.
 *  미리보기 창을 띄웠다가 시안이 알려 오면 검토 모드로 바꾸면 창이 번쩍 떴다 사라졌다(2026-09-30 사용자 "깜빡거린다") — 열기 전에 글로 본다 */
export const isCurationHtml = (html: string) => /hodoc\s*:\s*['"]cur-state['"]/.test(html);

/** 껍데기가 알려 온 저장분이 비었나 — 칸(marks·notes·decks·picks·flows…) 어느 하나라도 들어 있으면 빈 게 아니다.
 *  흐름 시안은 결정(picks)만 고를 수도 있어서, 칸 이름을 박아 두면 그것만 고른 기록을 못 되살렸다(2026-10-01) */
export const emptyStore = (d?: Record<string, unknown> | null) =>
  !d || Object.values(d).every((v) => !v || typeof v !== 'object' || !Object.keys(v as object).length);

/** 시안(HTML) 칸 샌드박스 — 폰처럼 앱과 다른 불투명 출처로 돈다. allow-same-origin 을 주면 시안 스크립트가 hodoc 으로 홈 폴더 아무 파일이나
 *  읽었다(2026-10-06 실측). 스크립트·확인 창(검토 틀 초기화·빈 결과 보내기 confirm)만. hodoc 응답 머리글(reader.rs DOC_CSP)도 같은 sandbox 를 건다 */
export const DOC_SANDBOX = 'allow-scripts allow-modals';

export type CurStep = { do: 'restore' } | { do: 'save'; text: string; json: string } | null;

/** 시안이 알려 온 것(cur-state) → 앱이 할 일. 불투명 출처라 칸을 새로 열면 시안 저장소가 비어 있다 — 그 칸의 첫 알림이 비었으면
 *  파일(curation/)에서 되돌리고, 그 밖엔 결과 글·저장분을 파일에 적는다. 첫 알림 뒤의 빈 알림은 시안 안 초기화라 그대로 적는다 */
export function curStep(first: boolean, d: unknown): CurStep {
  const m = d as { hodoc?: unknown; text?: unknown; store?: unknown } | null;
  if (!m || typeof m !== 'object' || m.hodoc !== 'cur-state' || typeof m.text !== 'string') return null;
  const store = m.store && typeof m.store === 'object' && !Array.isArray(m.store) ? (m.store as Record<string, unknown>) : undefined;
  if (first && emptyStore(store)) return { do: 'restore' };
  return { do: 'save', text: m.text, json: JSON.stringify(store ?? {}) };
}
