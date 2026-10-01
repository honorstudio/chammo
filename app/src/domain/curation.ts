/** 검토용 시안(design-curation·flow-curation 껍데기)인가 — 껍데기는 앱에 `hodoc: 'cur-state'` 로 진행을 알린다.
 *  미리보기 창을 띄웠다가 시안이 알려 오면 검토 모드로 바꾸면 창이 번쩍 떴다 사라졌다(2026-09-30 사용자 "깜빡거린다") — 열기 전에 글로 본다 */
export const isCurationHtml = (html: string) => /hodoc\s*:\s*['"]cur-state['"]/.test(html);
