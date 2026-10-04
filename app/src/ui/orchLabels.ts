// 참모 별명 저장소 — 세션 id 별, 이 컴퓨터에만(localStorage). 메뉴·탭·대시보드가 같이 읽는다
import { useSyncExternalStore } from 'react';
import { cleanLabel, displayName } from '../domain/orchLabel';

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

// 같이 보이는 참모들 — 화면 이름이 겹칠 때만 꼬리를 붙이려고(App 이 세션 목록이 바뀔 때마다 넣는다)
let roster: { id: string; name: string }[] = [];
export function setOrchRoster(list: { id: string; name: string }[]) {
  const key = (l: typeof list) => l.map((x) => `${x.id}=${x.name}`).join('|');
  if (key(list) === key(roster)) return;
  roster = list;
  labels = { ...labels }; // useOrchLabels 구독자가 다시 그리게
  subs.forEach((f) => f());
}
/** 화면에 보일 참모 이름 — 번호 없이(domain/orchLabel displayName). 진짜 이름은 SendMessage 주소라 안에서만 */
export const orchDisplay = (s: { id: string; name: string }): string =>
  displayName(s.name, labels[s.id], roster.map((r) => ({ name: r.name, label: labels[r.id] })));
