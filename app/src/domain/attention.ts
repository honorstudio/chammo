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
