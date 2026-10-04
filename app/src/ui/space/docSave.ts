import { invoke } from '@tauri-apps/api/core';
import { mdDiff } from '../../domain/space';
import { setCurrent } from './pending';

/**
 * 고친 md 저장 — 0.7초 모았다가 파일에 쓰고, 지난번 저장과의 차이를 스페이스 기록(space-log.jsonl)에 한 줄.
 * 쓸 땐 그 편집기가 마지막으로 본 파일 글(base)을 같이 보내 Rust 가 지금 파일과 맞을 때만 쓴다 — 밖(참모·세션)이 그새 고쳤으면
 * 덮지 않고 CHANGED_OUTSIDE → 편집기(docSync)가 바깥 판을 합친다(2026-10-04 QA D1: 밖에서 고친 줄이 말없이 사라졌다).
 * base 는 편집기(열 때마다)마다 따로 — 문서를 떠났다 바로 돌아오면 옛 편집기의 늦은 저장이 새 편집기의 기준을 바꿔치기했다
 */
export const lastSaved = new Map<string, string>();

export type DocSession = {
  path: string;
  /** 이 편집기가 마지막으로 본 파일 글 · 도장(바뀐 시각:크기, 열었을 땐 모름) · 바뀔 때마다 오르는 번호 */
  base: { text: string; stamp: string | null; ver: number };
  /** 같은 곳을 둘 다 고쳐 저장을 멈춤 — 사람이 고를 때까지 안 쓴다 */
  blocked: boolean;
  /** 쓰는 중 — 감시가 내 쓰기를 바깥 변경으로 읽지 않게 */
  writing: boolean;
  /** 편집기가 열려 있는 동안만 — 밖에서 바뀌어 거절됨 / 파일이 없어짐 */
  onOutside?: () => void;
  onGone?: () => void;
};

export const newSession = (path: string, text: string): DocSession => ({ path, base: { text, stamp: null, ver: 1 }, blocked: false, writing: false });
export function setBase(s: DocSession, text: string, stamp: string | null) {
  s.base = { text, stamp, ver: s.base.ver + 1 };
}

const OUTSIDE = 'CHANGED_OUTSIDE';
const saveTimers = new Map<DocSession, ReturnType<typeof setTimeout>>();

export function saveSoon(s: DocSession, md: string) {
  // 편집기가 문서를 처음 읽어 들일 때도 바뀜 알림이 온다 — 지난번 저장과 같으면 파일에 안 쓴다(열기만 해도 "- [ ]"→"* [ ]" 로 바뀌었다, 2026-09-30)
  if (lastSaved.get(s.path) === md) return;
  setCurrent(s.path, md);
  clearTimeout(saveTimers.get(s));
  saveTimers.set(s, setTimeout(() => void flush(s, md), 700));
}

/** 지금 바로 쓴다(충돌에서 '내 판으로 저장') — 기다리던 저장은 취소 */
export function saveNow(s: DocSession, md: string) {
  clearTimeout(saveTimers.get(s));
  return flush(s, md);
}

async function flush(s: DocSession, md: string) {
  saveTimers.delete(s);
  if (s.blocked) return;
  const before = lastSaved.get(s.path) ?? '';
  s.writing = true;
  try {
    const stamp = await invoke<string>('write_doc_text', { path: s.path, text: md, expected: s.base.text });
    setBase(s, md, stamp);
    lastSaved.set(s.path, md);
    const diff = mdDiff(before, md);
    if (diff.added.length || diff.removed.length) void invoke('space_log_append', { line: JSON.stringify({ ts: new Date().toISOString(), who: '사용자', kind: 'edit', path: s.path, ...diff }) }).catch(() => {});
  } catch (e) {
    const outside = String(e).includes(OUTSIDE);
    // 못 쓴 내 판은 history 에 — 파일이 없어졌거나, 편집기가 닫힌 뒤(문서를 떠난 직후) 늦게 거절돼 합칠 편집기가 없을 때(잃지 않게)
    if (!outside || !s.onOutside) void invoke('keep_doc_version', { path: s.path, text: md }).catch(() => {});
    (outside ? s.onOutside : s.onGone)?.();
  } finally {
    s.writing = false;
  }
}
