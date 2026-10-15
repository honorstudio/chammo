// 포인터로 직접 구현한 끌기에서 '버튼이 안 눌린 움직임(buttons 0)'을 어떻게 볼지 — 보관함 카드·띠 프사·보관함 네모 고르기가 같이 쓴다.
// WebKit(맥)은 마우스 사건의 buttons 를 사건이 난 때가 아니라 앱이 그 사건을 처리하는 순간의 하드웨어 상태로 채운다.
// 그래서 앱이 조금(30ms)만 밀려도 놓기 직전 끌기 사건이 buttons 0 으로 오고 바로 뒤에 진짜 pointerup 이 온다 —
// buttons 0 을 '놓음 신호를 놓쳤다'로 보고 바로 끝내면 빨리 놓은 것이 안 들어갔다(2026-10-12 사용자, 재현 .shots/fix-drop-quick).
// buttons 0 이면 끌기는 이어 가며 LOST_MS 동안 pointerup 을 기다리고, 안 오면 그때 놓친 것(창 밖에서 놓기)으로 끝낸다.

export const LOST_MS = 400;

export function lostRelease(onLost: () => void) {
  let timer: number | null = null;
  const stop = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
  return {
    /** 움직임마다 — buttons 0 이면 기다리기 시작(이미 기다리는 중이면 그대로 — 창 밖에서 놓고 계속 움직여도 끝나게), 눌린 채면 기다림을 푼다 */
    move(buttons: number) {
      if (buttons !== 0) return stop();
      if (timer === null) timer = window.setTimeout(() => { timer = null; onLost(); }, LOST_MS);
    },
    stop,
  };
}
