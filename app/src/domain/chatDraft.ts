// 채팅 입력칸에 쓰던 글(+ 말풍선 참조)을 세션마다 기억한다 — 참모 탭을 옮기면 입력칸이 새로 그려져 긴 글이 날아갔다(2026-09-30 사용자).
// 이번 실행은 메모리, 앱을 다시 켜도 남게 저장소에도(막혀 있으면 메모리만). 저장소는 데이터 폴더 파일(bufferedStore — 10-28, 팀챗·DM 도)
import type { ChatRef } from './chat';

export type Draft = { text: string; refs: ChatRef[] };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const EMPTY: Draft = { text: '', refs: [] };

/** prefix — 참모 채팅 chatDraft:(옛 localStorage 열쇠 그대로), 팀챗·DM teamDraft: */
export function draftStore(storage?: Store, prefix = 'chatDraft:') {
  const keyOf = (id: string) => `${prefix}${id}`;
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

/** 파일 읽기·쓰기(Rust drafts_read·drafts_write) — 바꾼 대화만, null 은 지우기 */
export type DraftIO = { read: () => Promise<Record<string, string>>; write: (changes: Record<string, string | null>) => Promise<unknown> };
/** 옛 저장소(localStorage) — 옮기고 지운다 */
export type Legacy = { keys: () => string[]; get: (k: string) => string | null; remove: (k: string) => void };

/**
 * 데이터 폴더 파일 저장소(<데이터>/drafts.json, 600 — 비밀을 붙였다 지우기 전에 나가도 나만 읽게). 켤 때 한 번 읽어(load) 메모리에 두고,
 * 바뀐 대화만 wait ms 모아 쓴다. 읽기·쓰기가 안 되면(폰·브라우저) 이번 실행 동안 메모리로. legacyPrefix 열쇠는 옛 저장소에서 옮긴다(파일에 써진 뒤 지움)
 */
export function bufferedStore(io: DraftIO, legacy?: Legacy, legacyPrefix = '', wait = 400) {
  const mem = new Map<string, string>();
  const dirty = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async (): Promise<boolean> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty.size) return true;
    const changes = Object.fromEntries(dirty);
    dirty.clear();
    try { await io.write(changes); return true; } catch { return false; }
  };
  const queue = (k: string, v: string | null) => {
    dirty.set(k, v);
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, wait);
  };
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); queue(k, v); },
    removeItem: (k: string) => { mem.delete(k); queue(k, null); },
    flush,
    async load() {
      let all: Record<string, string>;
      try { all = await io.read(); } catch { return; } // 못 읽으면 메모리만 — 옛 저장소도 그대로 둔다
      // 읽는 사이 이미 쓴 대화는 그대로(새 글)
      for (const [k, v] of Object.entries(all)) if (!mem.has(k) && !dirty.has(k)) mem.set(k, v);
      if (!legacy || !legacyPrefix) return;
      let moved: string[] = [];
      try { moved = legacy.keys().filter((k) => k.startsWith(legacyPrefix)); } catch { return; }
      for (const k of moved) {
        const v = legacy.get(k);
        if (v && !mem.has(k)) { mem.set(k, v); dirty.set(k, v); }
      }
      if (moved.length && (await flush())) for (const k of moved) legacy.remove(k);
    },
  };
}
