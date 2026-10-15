// 폰 입력창 두 줄 카드(시안 docs/design-drafts/phone-dash K, 2026-10-11 사용자) — 위 = 글, 아래 = [붙이기] [모델 칩] … [스피커] [한 자리]
// 참모 바꾸기는 늘 닿는다(2026-10-11 사용자 "일하는 중·쓰는 중에도 다른 참모로 간다" — 일하는 참모에서 ■ 에 막혀 못 돌아왔다):
// 비었으면 오른쪽 아래 = 참모 프사, 글이 있으면 오른쪽 아래 = 보내기·그 왼쪽(스피커 자리) = 참모 프사. 멈춤은 일하는 중일 때만 따로 한 칸

export type Slots = { corner: 'send' | 'orch'; left: 'voice' | 'orch'; stop: boolean };

export function composerSlots({ canSend, busy }: { canSend: boolean; busy: boolean }): Slots {
  return canSend ? { corner: 'send', left: 'orch', stop: busy } : { corner: 'orch', left: 'voice', stop: busy };
}

/** 글 한 줄 높이(px) — mobile.css .m-input textarea 의 16px × 1.45 와 맞춘다 */
export const TEXT_LINE_PX = 16 * 1.45;

/** 글 칸 최대 높이 — 6줄까지, 화면 쪽 상한(키보드가 덮으면 더 작다)이 더 작으면 그쪽 */
export const textMaxH = (viewportCap: number) => Math.min(viewportCap, Math.round(TEXT_LINE_PX * 6));

/** 모델 칩 — 눌러 보낸 뒤 상태줄(ctx)이 새 값을 알려 줄 때까지 기다리는 한도. 맥 runModelPick 은 결과를 20초까지 기다린다 */
export const PICK_WAIT_MS = 25_000;

/** 바꾸는 중인가 — asked = 누를 때 값(모델|에포트)과 시각. 값이 바뀌면 끝, 한도를 넘으면 못 바꿈 */
export function pickState(asked: { key: string; at: number } | null, key: string, now: number): 'idle' | 'wait' | 'fail' {
  if (!asked || asked.key !== key) return 'idle';
  return now - asked.at < PICK_WAIT_MS ? 'wait' : 'fail';
}
