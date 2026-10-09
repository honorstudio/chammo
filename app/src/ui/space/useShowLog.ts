// scripts/show 기록 꼬리 — 스페이스(띄우기·대시보드 파일)와 채팅 안 파일 카드가 같이 본다. 3초마다 한 번만 읽고 나눠 준다
// (앱 IPC 폴링이 이미 무겁다 — docs/research/2026-10-04-mac-perf.md)
import { useSyncExternalStore } from 'react';
import { readShowLog } from '../../data/tauri';

let log = '';
let timer: number | undefined;
const subs = new Set<() => void>();
const tick = () => void readShowLog().then((l) => { if (l !== log) { log = l; subs.forEach((f) => f()); } }).catch(() => {});

function subscribe(f: () => void) {
  subs.add(f);
  if (timer === undefined) { tick(); timer = window.setInterval(tick, 3000); }
  return () => {
    subs.delete(f);
    if (!subs.size && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  };
}

const off = () => () => {};
/** on = 읽을 때만(앱은 채팅 뷰일 때만 — 터미널 뷰는 리더가 Rust 쪽에서 본다) */
export const useShowLog = (on = true) => useSyncExternalStore(on ? subscribe : off, () => (on ? log : ''));
