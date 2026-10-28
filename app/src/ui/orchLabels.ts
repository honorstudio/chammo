// 참모 별명 저장소 — 세션 id 별, 이 컴퓨터에만(localStorage). 메뉴·탭·대시보드가 같이 읽는다
import { useSyncExternalStore } from 'react';
import { cleanLabel, displayName } from '../domain/orchLabel';
import { seenName } from '../domain/session';

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
/** 지금 별명 전부(짧은 번호 → 별명) — live.json 에 같이 적는다(기본 모드 '참모 상태'가 읽는다, domain/revive) */
export const orchLabelsNow = (): Readonly<Record<string, string>> => labels;
/** 별명이 바뀌면 다시 그린다 */
export function useOrchLabels(): Record<string, string> {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => labels);
}

// 같이 보이는 참모들 — 화면 이름이 겹칠 때만 꼬리를 붙이려고(App 이 세션 목록이 바뀔 때마다 넣는다)
// off = 쉬는(꺼진) 참모 — 채팅 입력칸 @ 목록이 흐리게 뒤에 둔다
let roster: { id: string; name: string; off?: boolean }[] = [];
export function setOrchRoster(list: { id: string; name: string; off?: boolean }[]) {
  const key = (l: typeof list) => l.map((x) => `${x.id}=${x.name}${x.off ? '~' : ''}`).join('|');
  if (key(list) === key(roster)) return;
  roster = list;
  labels = { ...labels }; // useOrchLabels 구독자가 다시 그리게
  subs.forEach((f) => f());
}
/** 같이 보이는 참모들(띠 순서 — 살아 있는 것 먼저) — useOrchLabels 로 구독하면 바뀔 때 다시 그린다 */
export const orchRoster = () => roster;
/** 화면에 보일 참모 이름 — 번호 없이(domain/orchLabel displayName). 진짜 이름은 SendMessage 주소라 안에서만 */
export const orchDisplay = (s: { id: string; name: string }): string =>
  displayName(s.name, labels[s.id], roster.map((r) => ({ name: r.name, label: labels[r.id] })));
/** 진짜 이름만 아는 자리(받은 말 머리·기록의 보낸 참모) — 같이 보이는 참모면 orchDisplay(앱 별명까지), 아니면 seenName */
export const seenNow = (name: string): string => {
  const r = roster.find((x) => x.name === name);
  return r ? orchDisplay(r) : seenName(name, roster.map((x) => ({ name: x.name, label: labels[x.id] })));
};
