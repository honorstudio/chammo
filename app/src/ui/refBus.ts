// 참조를 참모 입력칸으로 나르는 길(2026-10-23 사용자 폰) — 진행 칸의 일·목표(#task·#goal), 폰 말풍선(#chat).
// 데스크톱 ChatView·폰 Composer 가 자기 참모 id 로 받는다. 받는 입력칸이 아직 없으면(다른 참모 채팅을 보는 중) 모아 뒀다가 열릴 때 넣는다
import { useEffect, useRef } from 'react';
import type { RefKind } from '../domain/refChips';

export type RefAsk = { kind: RefKind; who: string; text: string };
type Got = (r: RefAsk) => void;

const bus = new EventTarget();
const waiting = new Map<string, RefAsk[]>();

/** 그 참모 입력칸에 참조 하나 — 받는 입력칸이 있으면 true */
export function askRef(orch: string, r: RefAsk): boolean {
  const took = !bus.dispatchEvent(new CustomEvent(orch, { detail: r, cancelable: true }));
  if (!took) waiting.set(orch, [...(waiting.get(orch) ?? []), r]);
  return took;
}

/** 입력칸이 받는다 — 붙을 때 모아 둔 것부터 */
export function takeRefs(orch: string, got: Got): () => void {
  const on = (e: Event) => { e.preventDefault(); got((e as CustomEvent<RefAsk>).detail); };
  bus.addEventListener(orch, on);
  const left = waiting.get(orch);
  waiting.delete(orch);
  left?.forEach(got);
  return () => bus.removeEventListener(orch, on);
}

/** takeRefs 를 컴포넌트에서 — got 은 늘 지금 것 */
export function useRefInbox(orch: string | undefined, got: Got) {
  const cb = useRef(got);
  cb.current = got;
  useEffect(() => (orch ? takeRefs(orch, (r) => cb.current(r)) : undefined), [orch]);
}
