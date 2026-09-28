// 앱의 macOS 알림은 전부 여기로 — 정책·2분 중복 막기(domain/notify)를 한 곳에서 거친다
import { notify } from '../data/tauri';
import { noteKey, noteTarget, shouldNotify, type Note } from '../domain/notify';

const last = new Map<string, number>();

export function notifyOnce(n: Note) {
  const now = Date.now();
  if (!shouldNotify(n, last, now)) return;
  last.set(noteKey(n), now);
  void notify(n.title, n.body.slice(0, 120), noteTarget(n)).catch(() => {});
}
