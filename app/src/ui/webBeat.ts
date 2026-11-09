// 웹 화면 숨소리 — 보이는 동안 5초마다 Rust 에 한 번(web_watch.rs 가 끊긴 걸 보고 되살린다). 가려졌을 땐 바뀔 때 한 번과
// 창이 앞으로 올 때 Rust 가 부르는 __webBeat 뿐(가만히 CPU 예산). 그리기(rAF)는 안 잰다 — 11-06 재현에서 GPU 가 굳어도 15초 뒤엔 rAF 가 다시 돌아 못 가렸고, 그건 GPU 번호로 본다
import { invoke } from '@tauri-apps/api/core';

export const BEAT_MS = 5000;

type Env = {
  hidden: () => boolean;
  onChange: (f: () => void) => void;
  every: (f: () => void, ms: number) => void;
};

export function startBeat(send: (visible: boolean) => void, env: Env) {
  const beat = () => send(!env.hidden());
  env.every(() => { if (!env.hidden()) beat(); }, BEAT_MS);
  env.onChange(beat);
  beat();
  return beat;
}

// 맥 앱 창에서만(시험·브라우저엔 Tauri 가 없다)
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  (window as unknown as { __webBeat?: () => void }).__webBeat = startBeat(
    (visible) => { invoke('web_beat', { visible }).catch(() => {}); },
    {
      hidden: () => document.visibilityState === 'hidden',
      onChange: (f) => document.addEventListener('visibilitychange', f),
      every: (f, ms) => window.setInterval(f, ms),
    },
  );
}
