// 프사 창 목소리 다이얼 — 하나씩 넘기면 바로 들린다(2026-10-02 목소리 고르기 시안 B, 사용자 확정)
import { VOICES, type Voice } from './avatar';

/** 다이얼이 처음 가리킬 칸 — 고른 목소리, 안 골랐으면 기본 배정 목소리 */
export const dialStart = (voice: Voice | null, def: Voice | undefined) => Math.max(0, VOICES.indexOf(voice ?? def ?? VOICES[0]));

/** 끝에서 넘기면 처음으로 돈다 */
export const stepDial = (i: number, d: 1 | -1) => (i + d + VOICES.length) % VOICES.length;

/** 이름은 F1·M1 그대로 — '여자/남자' 글자는 쓰지 않는다(사용자 "폭력적이다"). 기본이면 지금 배정된 것을 같이 */
export const dialLabel = (voice: Voice | null, def: Voice | undefined) => voice ?? (def ? `기본 · ${def}` : '기본');

/** Rust speak_preview_state 와 같은 값 */
export type PreviewPhase = 'preparing' | 'playing' | 'done' | 'stopped';
export type ViewPhase = PreviewPhase | 'idle';

/** 내가 누른 번호(mine)의 상태만 — 0 은 아직 안 누름. 앞 번호가 남아 있으면 내 것은 아직 준비 중 */
export function viewPhase(mine: number, s: { id: number; phase: PreviewPhase }): ViewPhase {
  if (!mine) return 'idle';
  return s.id === mine ? s.phase : 'preparing';
}

export const isLive = (p: ViewPhase) => p === 'preparing' || p === 'playing';

/** 마지막 부름만 ms 뒤에 — 빨리 넘기면 앞 것은 버린다. cancel = 창을 닫을 때 */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const call = (...a: A) => { if (t) clearTimeout(t); t = setTimeout(() => { t = undefined; fn(...a); }, ms); };
  call.cancel = () => { if (t) clearTimeout(t); t = undefined; };
  return call;
}
