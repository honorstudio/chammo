// 채팅 입력칸에 쓰던 글(+ 말풍선 참조)을 세션마다 기억한다 — 참모 탭을 옮기면 입력칸이 새로 그려져 긴 글이 날아갔다(2026-09-30 사용자).
// 이번 실행은 메모리, 앱을 다시 켜도 남게 localStorage 에도(막혀 있으면 메모리만)
import type { ChatRef } from './chat';

export type Draft = { text: string; refs: ChatRef[] };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const EMPTY: Draft = { text: '', refs: [] };
const keyOf = (id: string) => `chatDraft:${id}`;

export function draftStore(storage?: Store) {
  const mem = new Map<string, Draft>();
  return {
    load(id: string | undefined): Draft {
      if (!id) return EMPTY;
      const m = mem.get(id);
      if (m) return m;
      try {
        const raw = storage?.getItem(keyOf(id));
        const d = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
        if (d && typeof d.text === 'string') return { text: d.text, refs: Array.isArray(d.refs) ? d.refs : [] };
      } catch {
        // 깨진 값·막힌 저장소는 빈 입력칸
      }
      return EMPTY;
    },
    save(id: string | undefined, d: Draft) {
      if (!id) return;
      const empty = !d.text.trim() && !d.refs.length;
      if (empty) mem.delete(id);
      else mem.set(id, d);
      try {
        if (empty) storage?.removeItem(keyOf(id));
        else storage?.setItem(keyOf(id), JSON.stringify(d));
      } catch {
        // 이번 실행 동안은 메모리로
      }
    },
  };
}
