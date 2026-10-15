// 폰에서 음성 모드 소리 틀기의 폰 쪽 판단(2026-10-11 사용자 — "폰을 보고 있을 땐 소리가 폰에서, 안 보면 맥에서").
// 맥(src-tauri/src/phone_voice.rs)이 하트비트로 '보고 있나·오디오 준비됐나'를 보고 소리 파일을 폰으로 돌린다. 여기는 순수 판단만 — 오디오·통신은 data/phoneVoice.ts
import { levelAt } from './speakGlow';

/** 하트비트 간격 — 맥은 8초 안에 하나라도 있으면 보고 있다고 본다 */
export const BEAT_MS = 1500;
/** 마지막으로 만진 뒤 이만큼 지나면 '보는 중'이 아니다 — 폰이 켜진 채 책상 위에 있어도 소리가 폰으로 가 버리지 않게 */
export const TOUCH_WINDOW_MS = 180_000;

/** 소리 받을 준비 = 오디오가 깨어 있고(사람이 한 번 눌렀다) · 앞에 떠 있고 · 최근에 만졌다 */
export function isReady(s: { unlocked: boolean; visible: boolean; lastTouch: number; now: number }): boolean {
  return s.unlocked && s.visible && s.lastTouch > 0 && s.now - s.lastTouch <= TOUCH_WINDOW_MS;
}

export type AckKind = 'start' | 'end' | 'fail';
export type Ack = { id: number; s: AckKind };

/** POST /api/voice-beat 몸통 — 서버는 모르는 칸을 400 으로 거절하니 값 있는 칸만 */
export function beatBody(ready: boolean, hidden: boolean, ack?: Ack): { ready: boolean; hidden?: true; ack?: Ack } {
  return { ready, ...(hidden ? { hidden: true as const } : {}), ...(ack ? { ack } : {}) };
}

/** 하트비트 답 — item.who·hop·env = 말하는 참모 세션 짧은 id·곡선 칸 길이(ms)·소리 크기 곡선(0~255). 옛 맥은 안 준다 */
export type BeatReply = { item: { id: number; ms: number; who?: string | null; hop?: number; env?: number[] | null } | null; cancel: number };
export type Item = { id: number; ms: number; who: string | null; hop: number; env: number[] | null };

/** 하트비트 답에서 이제 틀 소리 — 이미 튼(받은) id 는 건너뛴다. 모양이 틀리면 없음 */
export function pickItem(r: BeatReply | null | undefined, handled: ReadonlySet<number>): Item | null {
  const it = r?.item;
  if (!it || typeof it.id !== 'number' || typeof it.ms !== 'number') return null;
  if (handled.has(it.id)) return null;
  const env = Array.isArray(it.env) && it.env.every((v) => typeof v === 'number') ? it.env : null;
  return { id: it.id, ms: it.ms, who: typeof it.who === 'string' && it.who ? it.who : null, hop: typeof it.hop === 'number' && it.hop > 0 ? it.hop : 25, env };
}

/** 폰이 지금(또는 방금) 튼 소리 — startedMs = 틀기 시작한 때, endedMs = 끝·실패·멈춤(아직이면 null) */
export type PhoneSay = { id: number; who: string | null; startedMs: number; endedMs: number | null; hop: number; env: number[] | null };

/** 말이 끝난 뒤 말한 참모 프사를 이만큼 더 두고 원래 참모로 돌아온다 */
export const HOLD_MS = 2500;

/** 입력칸 참모 단추에 보일 말하는 참모(세션 짧은 id) — 틀고 있거나 끝난 지 HOLD_MS 안. 없으면 null(원래 참모) */
export function speakerShown(s: PhoneSay | null, now: number): string | null {
  if (!s?.who) return null;
  return s.endedMs === null || now - s.endedMs < HOLD_MS ? s.who : null;
}

/** 빛 세기 0~1 — 데스크톱 말하는 빛(domain/speakGlow levelAt)과 같은 셈. 끝났으면 0, 동작 줄이기면 일정한 빛 */
export function sayLevel(s: PhoneSay | null, now: number, reduced: boolean): number {
  if (!s) return 0;
  return levelAt({ id: s.id, from: s.who, phase: s.endedMs === null ? 'playing' : 'done', startedMs: s.startedMs, hopMs: s.hop, env: s.env }, now, reduced);
}

/** 참모 단추를 눌렀을 때 — 말하는 참모가 지금 채팅 참모와 다르면 그 참모로(go), 아니면 평소처럼 참모 바꾸기(chip) */
export function speakerTap(current: string, speaker: string | null): 'go' | 'chip' {
  return speaker && speaker !== current ? 'go' : 'chip';
}

/** 멈춤 번호 — 처음 받는 값은 기억만(그 전에 있던 멈춤으로 지금 소리를 끊지 않게), 그 뒤 바뀌면 틀던 걸 멈춘다 */
export function cancelStep(seen: number | null, now: number): { stop: boolean; seen: number } {
  return { stop: seen !== null && seen !== now, seen: now };
}

/** 깨우기용 무음 wav(16bit 모노) — 네트워크 없이 만든다. 사람이 누르는 순간 이걸 한 번 틀어 오디오 원소를 풀어 둔다 */
export function silentWav(ms = 120, rate = 8000): Uint8Array {
  const n = Math.round((rate * ms) / 1000);
  const b = new Uint8Array(44 + n * 2);
  const dv = new DataView(b.buffer);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  tag(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // 모노
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, n * 2, true);
  return b;
}
