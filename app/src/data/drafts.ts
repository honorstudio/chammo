// 입력칸 쓰던 글 — <데이터>/drafts.json(600, Rust drafts). 켤 때 한 번 읽고(loadDrafts — main·messenger 가 그리기 전에), 바꾼 대화만 모아 쓴다.
// 참모 채팅(chatDraft:<세션>)은 옛 localStorage 에서 한 번 옮겨 온다. Tauri 가 없으면(폰) 이번 실행 동안 메모리로
import { invoke } from '@tauri-apps/api/core';
import { bufferedStore, draftStore, type Legacy } from '../domain/chatDraft';

const legacy: Legacy | undefined = (() => {
  try {
    const ls = window.localStorage;
    return { keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? ''), get: (k) => ls.getItem(k), remove: (k) => ls.removeItem(k) };
  } catch {
    return undefined;
  }
})();

const file = bufferedStore(
  { read: () => invoke<Record<string, string>>('drafts_read'), write: (changes) => invoke('drafts_write', { changes }) },
  legacy,
  'chatDraft:',
);

export const loadDrafts = () => file.load();
// 창을 닫거나 다시 읽기 직전 — 모아 둔 글을 바로
try { window.addEventListener('pagehide', () => void file.flush()); } catch { /* 창 없음(시험) */ }

/** 참모 채팅 — 세션마다 */
export const chatDrafts = draftStore(file, 'chatDraft:');
/** 팀챗·DM — 대화마다 */
export const teamDrafts = draftStore(file, 'teamDraft:');
