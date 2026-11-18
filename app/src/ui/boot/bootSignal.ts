// 켤 때 점호가 기다리는 신호 — 채팅 칸이 대화 첫 쪽을 다 읽었다(chat). 한 번 오면 끝(앱이 켜져 있는 동안 다시 안 기다린다)
import { useSyncExternalStore } from 'react';

const seen = new Set<string>();
const subs = new Set<() => void>();

export function bootSignal(k: string) {
  if (seen.has(k)) return;
  seen.add(k);
  subs.forEach((f) => f());
}

export const bootSeen = (k: string) => seen.has(k);

export function useBootSignal(k: string): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => seen.has(k));
}
