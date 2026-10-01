// 참모 별명 저장소 — 세션 id 별, 이 컴퓨터에만(localStorage). 메뉴·탭·대시보드가 같이 읽는다
import { useSyncExternalStore } from 'react';
import { cleanLabel } from '../domain/orchLabel';

const KEY = 'orchLabels';
let labels: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>; } catch { return {}; } })();
const subs = new Set<() => void>();

export function setOrchLabel(id: string, raw: string) {
  const v = cleanLabel(raw);
  const next = { ...labels };
  if (v) next[id] = v; else delete next[id];
  labels = next;
  try { localStorage.setItem(KEY, JSON.stringify(labels)); } catch { /* 이번 실행만 */ }
  subs.forEach((f) => f());
}
export const orchLabel = (id: string): string | undefined => labels[id];
/** 별명이 바뀌면 다시 그린다 */
export function useOrchLabels(): Record<string, string> {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => labels);
}
