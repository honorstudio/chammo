// 앱의 macOS 알림은 전부 여기로 — 정책·2분 중복 막기(domain/notify)를 한 곳에서 거친다
import { notify } from '../data/tauri';
import { nativeWhenFocused, noteKey, noteTarget, shouldNotify, type Note } from '../domain/notify';

const last = new Map<string, number>();

export function notifyOnce(n: Note) {
  const now = Date.now();
  if (!shouldNotify(n, last, now)) return;
  // 참모 창을 보고 있으면 앱 안에 이미 뜨는 것은 맥 알림을 건너뛴다 — 기록도 안 남겨, 창을 떠난 뒤 다시 생기면 그때 보낸다
  if (!nativeWhenFocused(n.kind) && document.hasFocus() && !document.hidden) return;
  last.set(noteKey(n), now);
  void notify(n.title, n.body.slice(0, 120), noteTarget(n)).catch(() => {});
}
