// 참조를 참모 입력칸으로 나르는 길(2026-10-23 사용자 폰) — 진행 칸의 일·목표(#task·#goal), 폰 말풍선(#chat).
// 데스크톱 ChatView·폰 Composer 가 자기 참모 id 로 받는다. 받는 입력칸이 아직 없으면(다른 참모 채팅을 보는 중) 모아 뒀다가 열릴 때 넣는다
import { useEffect, useRef } from 'react';
import type { RefKind } from '../domain/refChips';

/** plain = 이름표 없이 글 그대로 입력칸에(내 메모 보내기 아이콘 — 메모 글 통째, 11-05 사용자).
 *  file = 그 파일을 첨부 칩(#file)으로(폰 문서 보기 '참모에게 보내기', 11-06 — 데스크톱 SendToOrch 와 같은 일) */
export type RefAsk = { kind: RefKind; who: string; text: string; plain?: boolean; file?: { path: string; name: string } };
type Got = (r: RefAsk) => void;

const bus = new EventTarget();
const waiting = new Map<string, RefAsk[]>();

/** 그 참모 입력칸에 참조 하나 — 받는 입력칸이 있으면 true. queue=false 면 없을 때 모아 두지 않는다(받는 쪽이 터미널일 수 있을 때) */
export function askRef(orch: string, r: RefAsk, queue = true): boolean {
  const took = !bus.dispatchEvent(new CustomEvent(orch, { detail: r, cancelable: true }));
  if (!took && queue) waiting.set(orch, [...(waiting.get(orch) ?? []), r]);
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
