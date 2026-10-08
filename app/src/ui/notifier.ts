// 앱의 macOS 알림은 전부 여기로 — 정책·2분 중복 막기(domain/notify)를 한 곳에서 거친다
import { mainWatched, notify } from '../data/tauri';
import { nativeWhenFocused, noteKey, noteTarget, shouldNotify, watching, type Note } from '../domain/notify';
import { IS_WIN } from '../domain/reader';

const last = new Map<string, number>();

export function notifyOnce(n: Note) {
  if (!shouldNotify(n, last, Date.now())) return;
  const doc = { focus: document.hasFocus(), hidden: document.hidden };
  if (nativeWhenFocused(n.kind) || !IS_WIN) return send(n, watching(IS_WIN, doc));
  // 윈도우는 창 상태를 Rust 에 묻는다(WebView2 의 hasFocus 는 최소화돼도 true)
  void mainWatched().then((w) => send(n, watching(true, doc, w)), () => send(n, watching(true, doc, null)));
}

function send(n: Note, watched: boolean) {
  // 참모 창을 보고 있으면 앱 안에 이미 뜨는 것은 맥 알림을 건너뛴다 — 기록도 안 남겨, 창을 떠난 뒤 다시 생기면 그때 보낸다
  if (!nativeWhenFocused(n.kind) && watched) return;
  const now = Date.now();
  // 윈도우는 묻는 사이 같은 알림이 또 올 수 있다 — 보내기 직전에 한 번 더
  if (!shouldNotify(n, last, now)) return;
  last.set(noteKey(n), now);
  void notify(n.title, n.body.slice(0, 120), noteTarget(n)).catch(() => {});
}
