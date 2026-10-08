// 폰에서 답한 '답을 기다림' 카드 — 시트를 닫았다 열어도 남게 앱 전체가 나눠 본다(WaitReply 지역 상태였을 땐 다시 열면 보낸 표시가 사라져
// 같은 답을 또 보냈다, 2026-10-06). 결정 카드는 맥 기록(answer)이 따라와 목록에서 빠지면 지운다(domain/mobile pruneWaitSent)
import { useEffect, useSyncExternalStore } from 'react';
import { pruneWaitSent, type WaitSent, type Waiting } from '../../domain/mobile';

let sent: WaitSent = {};
const subs = new Set<() => void>();
const set = (next: WaitSent) => { if (next === sent) return; sent = next; subs.forEach((f) => f()); };

export const peekWaitSent = () => sent;
export const markWaitSent = (key: string, a: string, fail = false) => set({ ...sent, [key]: { a, at: Date.now(), ...(fail ? { fail } : {}) } });

/** raw = 숨기기 전 목록 — 거기서 빠진 카드의 표시를 지운다 */
export function useWaitSent(raw: Waiting[]): WaitSent {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sent);
  useEffect(() => { set(pruneWaitSent(sent, raw)); }, [raw]);
  return s;
}
