// 말하기 키(지구본 fn·오른쪽 ⌥) 누르는 중 — Rust 가 누를 때 받는 pty, 뗄 때 null 을 보낸다(ptt_live). 채널은 하나라 여기서 창들에 나눠 준다
import { useSyncExternalStore } from 'react';
import { pttLive } from '../data/tauri';

let live: number | null = null;
const subs = new Set<() => void>();
let watching = false;

function subscribe(f: () => void) {
  subs.add(f);
  if (!watching) {
    watching = true;
    void pttLive((id) => { live = id; subs.forEach((g) => g()); }).catch(() => { watching = false; }); // 앱 밖(시험 화면)에선 없다
  }
  return () => { subs.delete(f); };
}

/** 이 pty 가 지금 말하기 키 입력을 받는 중인가 */
export function usePttLive(ptyId: number | null): boolean {
  return useSyncExternalStore(subscribe, () => ptyId != null && live === ptyId);
}
