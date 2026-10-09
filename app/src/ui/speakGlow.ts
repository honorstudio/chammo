// 말하는 참모 빛 — 음성 모드일 때 100ms 마다 Rust 에 '지금 읽는 말'을 묻고(speak_now_state), 재생 중이면
// 프레임마다 지금 시각(소리가 귀에 닿은 때부터 — Rust 가 장치 지연까지 잰다)의 소리 크기를 --speak-level(0~1)로 문서 맨 위에 쓴다. 빛낼 자리는 useSpeaking() 이 주는 세션 id 와 맞춰 st-speak 를 단다
import { useEffect, useSyncExternalStore } from 'react';
import { speakNowState } from '../data/tauri';
import { foldSay, levelAt, speakingFrom, type Glow } from '../domain/speakGlow';
import { isAttended, onAttention } from './attention';

let glow: Glow | null = null;
let speaking: string | null = null;
const subs = new Set<() => void>();
let timer = 0;
let raf = 0;

const setLevel = (v: number) => document.documentElement.style.setProperty('--speak-level', v.toFixed(3));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// 사람이 안 보면(ui/attention) 프레임마다 그리지 않고 가운데 밝기로 멈춘다 — 누가 말하는지는 그대로 보인다
const STILL = 0.5;

const playing = () => glow?.phase === 'playing';

/** 빛낼 참모를 지금 시각으로 다시 본다 — 재생 중이어도 소리가 귀에 닿기 전(블루투스 0.3초쯤)엔 아직 아무도 아니다 */
function refresh(now: number) {
  const who = speakingFrom(glow, now);
  if (who !== speaking) {
    speaking = who;
    subs.forEach((f) => f());
  }
}

function frame() {
  const now = Date.now();
  refresh(now);
  if (!isAttended()) { setLevel(speaking ? STILL : 0); raf = 0; return; }
  setLevel(levelAt(glow, now, reduced()));
  raf = playing() ? requestAnimationFrame(frame) : 0;
}
onAttention((on) => { if (on && playing() && !raf) raf = requestAnimationFrame(frame); });

function apply(next: Glow | null) {
  glow = next;
  refresh(Date.now());
  if (playing() && !raf) raf = requestAnimationFrame(frame);
  if (!playing()) { if (raf) cancelAnimationFrame(raf); raf = 0; setLevel(0); } // 끊기면 그 자리에서 0
}

async function poll() {
  // 곡선은 재생 중으로 받은 번호면 다시 안 받는다 — 기다림(만드는 중)으로 받은 번호는 곡선이 아직 없어 0
  const known = glow && glow.phase === 'playing' ? glow.id : 0;
  try { apply(foldSay(glow, await speakNowState(known))); } catch { /* 앱 밖(시험 화면)에선 없다 */ }
  timer = window.setTimeout(poll, isAttended() ? 100 : 500); // 안 볼 땐 누가 말하나만 알면 된다
}

/** 음성 모드일 때만 묻는다 — 끄면 빛도 0 */
export function useSpeakGlowPoll(on: boolean) {
  useEffect(() => {
    if (!on) return;
    void poll();
    return () => { window.clearTimeout(timer); timer = 0; apply(null); };
  }, [on]);
}

/** 지금 소리 내는 참모의 세션 id(없으면 null) */
export function useSpeaking(): string | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => speaking);
}
