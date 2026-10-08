// 폰에서 바꾼 이름 — 길게 누르기 메뉴·대시보드 프로필 창이 같이 본다(한쪽에서 바꾸면 다른 쪽도 바로 새 이름).
// 맥이 쉬는 때 /rename 을 보내 진짜 이름에 실리면 뺀다(domain/mobile pendingName·prunePendingNicks)
import { useEffect, useSyncExternalStore } from 'react';
import { renameOrch } from '../../data/web';
import { pendingName, prunePendingNicks } from '../../domain/mobile';
import type { Session } from '../../domain/session';

let nicks: Record<string, string> = {};
const subs = new Set<() => void>();
const set = (next: Record<string, string>) => { if (next === nicks) return; nicks = next; subs.forEach((f) => f()); };

/** 이름 바꾸기 — 맥에 보내고(쉬는 때 /rename) 폰엔 바로 새 이름. nick 은 cleanLabel 한 것(빈 글 = 처음 이름) */
export async function renamePending(id: string, nick: string): Promise<void> {
  await renameOrch(id, nick);
  set({ ...nicks, [id]: nick });
}

export function usePendingNicks(orchs: Session[]) {
  const n = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => nicks);
  useEffect(() => { set(prunePendingNicks(nicks, orchs)); }, [orchs]);
  return {
    /** 지금 별명(바꾼 게 있으면 그것) — 이름 칸 처음 값 */
    nickOf: (s: Session) => (s.id in n ? n[s.id] : undefined),
    nameOf: (s: Session) => pendingName(s, n, orchs),
  };
}
