// 사람이 앱을 보고 있나 — 아바타 움직임·말하는 빛·오피스 그리기를 이걸로 켜고 끈다(2026-10-04 mac-perf: 아무도 안 볼 때 아바타가 GPU 39%).
// 창 숨김(document.hidden)만으론 부족하다 — 덮개를 닫으면 앱 창이 가짜 화면에 '보이는 채로' 남는다. 그래서 '앱이 맨 앞' + '입력 2분 안'까지 본다.
// 덮개 닫힘(맥 Rust lid.rs 가 알림)이면 2분을 안 기다리고 바로 안 본다(2026-10-05)
export const IDLE_MS = 120_000;

export function attended(o: { hidden: boolean; focused: boolean; lidClosed: boolean; lastInput: number; now: number }): boolean {
  return !o.hidden && !o.lidClosed && o.focused && o.now - o.lastInput < IDLE_MS;
}

/** 입력 없이 2분이 차기까지 남은 시간 */
export const idleLeft = (lastInput: number, now: number) => Math.max(0, lastInput + IDLE_MS - now);

/** 다음 깜빡임까지 — 6~8초(rand 0~1) */
export function nextBlinkMs(rand: number): number {
  const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 1) : 0.5;
  return Math.round(6_000 + r * 2_000);
}

/** 앱 창이 보이나 — 폴링을 늦추는 기준(2026-10-11 사용자 승인 '안 보일 때 5배'). attended 와 달리 2분 입력 없음은 안 본다(음성 모드로 듣기만 해도 보는 중) */
export function shown(o: { hidden: boolean; focused: boolean; lidClosed: boolean }): boolean {
  return !o.hidden && !o.lidClosed && o.focused;
}

/** 안 보일 때 늦추는 배수 */
export const HIDDEN_SLOW = 5;

/** 다음 폴링까지 — 보이면 원래 주기, 안 보이면 5배 */
export const pollDelay = (ms: number, isShown: boolean) => (isShown ? ms : ms * HIDDEN_SLOW);

/** 다시 보였을 때 다음 폴링까지 — 지난번에서 원래 주기가 지났으면 바로(0), 아니면 남은 만큼 */
export const dueOnShow = (ms: number, lastAt: number, now: number) => Math.max(0, lastAt + ms - now);
