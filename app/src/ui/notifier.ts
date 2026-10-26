// 앱의 macOS 알림은 전부 여기로 — 정책·2분 중복 막기(domain/notify)를 한 곳에서 거친다
import { mainWatched, notify, userIdle } from '../data/tauri';
import { awayPush, heldStep, nativeWhenFocused, noteKey, noteTarget, shouldNotify, watching, type Held, type Note } from '../domain/notify';
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
  // 참모 창을 보고 있으면 앱 안에 이미 뜨는 것은 맥 알림을 건너뛴다 — 기록도 안 남겨, 창을 떠난 뒤 다시 생기면 그때 보낸다.
  // 사람 필요 알림은 붙들어 두고, 맥 입력이 그 뒤로 없거나 잠기면(자리 비움) 맥 알림 + 폰 푸시로 보낸다(2026-10-24 사용자가 밖에서 놓침)
  if (!nativeWhenFocused(n.kind) && watched) {
    if (awayPush(n.kind)) hold(n);
    return;
  }
  fire(n);
}

function fire(n: Note) {
  const now = Date.now();
  // 윈도우는 묻는 사이 같은 알림이 또 올 수 있다 — 보내기 직전에 한 번 더
  if (!shouldNotify(n, last, now)) return;
  last.set(noteKey(n), now);
  void notify(n.title, n.body.slice(0, 120), noteTarget(n)).catch(() => {});
}

// ── 보고 있어 건너뛴 사람 필요 알림 — 자리 비움이면 보낸다(domain/notify awayStep) ──
let held: Held[] = [];
let timer: number | null = null;
const HOLD_TICK_MS = 20_000;

/** 붙들어 둔 알림 중 그 카드 것을 버린다 — 자리 비움 전에 다른 기기에서 처리됐으면 나중에 보내지 않게 */
export function unhold(token: string) {
  held = held.filter((h) => !(h.n.go ?? '').endsWith(`:${token}`));
}

function hold(n: Note) {
  const k = noteKey(n);
  if (!held.some((h) => noteKey(h.n) === k)) held.push({ n, at: Date.now() });
  void check();
  if (timer === null) timer = window.setInterval(() => void check(), HOLD_TICK_MS);
}

async function check() {
  if (!held.length) return;
  let s;
  try { s = await userIdle(); } catch { s = { idle: null, locked: false }; } // 못 물으면 지금처럼 앱 안만
  const r = heldStep(held, Date.now(), s);
  held = r.keep;
  for (const n of r.send) fire(n);
  if (!held.length && timer !== null) { window.clearInterval(timer); timer = null; }
}
