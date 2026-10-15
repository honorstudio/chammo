// 띠 쉬는 참모 깨우기 — pointerup 과 click 이 둘 다 와도 한 번만(2026-10-15 윈도우: click 하나에만 기대면 첫 누름이 안 먹었다)
/** 이 간격 안에 또 온 신호는 같은 누름의 뒤따르는 신호 */
export const WAKE_GAP_MS = 600;

/** last = 마지막으로 깨운 때(ms), now = 지금. wake=true 면 깨우고 at 을 새 last 로 */
export function wakeOnce(last: number, now: number): { wake: boolean; at: number } {
  return now - last < WAKE_GAP_MS ? { wake: false, at: last } : { wake: true, at: now };
}
