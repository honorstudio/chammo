// 말하는 참모 빛 — 음성 모드에서 지금 소리 내는 참모의 탭·프사·칸이 그 참모 색으로 소리 크기대로 빛난다(2026-10-03 사용자).
// Rust speak_now_state 가 누구·상태·곡선(25ms RMS)·소리가 귀에 닿는 시각을 주고, 화면은 지금 시각의 칸을 찾아 빛 세기로 쓴다

export type SayPhase = 'waiting' | 'playing' | 'done' | 'stopped';
/** Rust SayNow 그대로 — env 는 이미 받은 번호면 null */
export type SayNow = { id: number; from: string | null; phase: SayPhase; startedMs: number; hopMs: number; env: number[] | null };
export type Glow = SayNow;

/** 새 상태 접기 — 앞 번호는 버리고, 같은 번호가 이미 끝·멈춤이면 늦게 온 '재생 중'에 다시 켜지지 않는다 */
export function foldSay(prev: Glow | null, next: SayNow): Glow {
  if (!prev || next.id > prev.id) return { ...next, env: next.env ?? null };
  if (next.id < prev.id) return prev;
  if (prev.phase === 'done' || prev.phase === 'stopped') return prev;
  return { ...next, env: next.env ?? prev.env };
}

/** 지금 빛낼 참모 — 재생 중이고 소리가 귀에 닿은 뒤(startedMs)부터. Rust 가 블루투스 지연까지 더한 시각을 준다(2026-10-10) */
export const speakingFrom = (g: Glow | null, nowMs: number) => (g && g.phase === 'playing' && nowMs >= g.startedMs ? g.from : null);

const FLOOR = 0.15; // 말 사이 조용한 칸에도 누가 말하는지는 보이게

/** 지금 시각(ms)의 빛 세기 0~1. 곡선이 없으면 숨쉬기, 동작 줄이기면 일정한 빛 */
export function levelAt(g: Glow | null, nowMs: number, reduced = false): number {
  if (!g || g.phase !== 'playing' || nowMs < g.startedMs) return 0;
  if (reduced) return 0.7;
  if (!g.env) return 0.55 + 0.25 * Math.sin(((nowMs - g.startedMs) / 1600) * 2 * Math.PI);
  const v = g.env[Math.floor((nowMs - g.startedMs) / g.hopMs)];
  return v === undefined ? 0 : FLOOR + (1 - FLOOR) * (v / 255);
}
