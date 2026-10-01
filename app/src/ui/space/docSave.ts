import { invoke } from '@tauri-apps/api/core';
import { mdDiff } from '../../domain/space';
import { setCurrent } from './pending';

/** 고친 md 저장 — 0.7초 모았다가 파일에 쓰고, 지난번 저장과의 차이를 스페이스 기록(space-log.jsonl)에 한 줄 */
export const lastSaved = new Map<string, string>();
const saveTimers = new Map<string, number>();
export function saveSoon(path: string, md: string) {
  // 편집기가 문서를 처음 읽어 들일 때도 바뀜 알림이 온다 — 지난번 저장과 같으면 파일에 안 쓴다(열기만 해도 "- [ ]"→"* [ ]" 로 바뀌었다, 2026-09-30)
  if (lastSaved.get(path) === md) return;
  setCurrent(path, md);
  window.clearTimeout(saveTimers.get(path));
  saveTimers.set(path, window.setTimeout(() => {
    const before = lastSaved.get(path) ?? '';
    lastSaved.set(path, md);
    const diff = mdDiff(before, md);
    void invoke('write_doc_text', { path, text: md }).catch(() => {});
    if (diff.added.length || diff.removed.length) void invoke('space_log_append', { line: JSON.stringify({ ts: new Date().toISOString(), who: '사용자', kind: 'edit', path, ...diff }) }).catch(() => {});
  }, 700));
}

