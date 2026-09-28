// 앱 단축키. ⌘ 단독 조합만 쓴다 — Ctrl·Alt 조합은 터미널(Claude 입력칸) 몫이라 뺏으면 안 된다.

export type Shortcut =
  | { type: 'goto'; to: 'orchestrator' | 'all' | 'tama' | 'review' | 'office' }
  | { type: 'font'; delta: 1 | -1 }
  | { type: 'fontReset' }
  | { type: 'toggleSidebar' }
  | { type: 'toggleTasks' }
  | { type: 'search' }
  | { type: 'closePane' }
  | { type: 'newSession' }
  | { type: 'widget' }
  | { type: 'memo' }
  | { type: 'toggleReader' }
  | { type: 'readerFull' }
  | { type: 'readerTab'; dir: 1 | -1 }
  | { type: 'readerClose' }
  | { type: 'settings' }
  | { type: 'maximizePane' }
  | { type: 'tour' }
  | { type: 'quitAsk' };

type KeyLike = { key: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };

// 한글 입력 상태에선 같은 자리 키가 자모로 들어온다 — 영문 키로 바꿔 읽는다
const HANGUL_KEY: Record<string, string> = { ㅠ: 'b', ㅓ: 'j', ㅏ: 'k', ㅈ: 'w', ㅅ: 't', ㅡ: 'm', ㄷ: 'e', ㄸ: 'E' };

export function shortcutFor(e: KeyLike): Shortcut | null {
  if (!e.metaKey || e.altKey || e.ctrlKey) return null;
  switch (HANGUL_KEY[e.key] ?? e.key) {
    case '1':
      return { type: 'goto', to: 'orchestrator' };
    case '2':
      return { type: 'goto', to: 'all' };
    case '3':
      return { type: 'goto', to: 'review' };
    case '4':
      return { type: 'goto', to: 'office' }; // 사무실 뷰 — ⌘1 은 참모 터미널 격자
    case '=':
    case '+':
      return { type: 'font', delta: 1 };
    case '-':
      return { type: 'font', delta: -1 };
    case '0':
      return { type: 'fontReset' };
    case 'b':
      return { type: 'toggleSidebar' };
    case 'j':
      return { type: 'toggleTasks' };
    case 'k':
      return { type: 'search' };
    case 'w':
      return { type: 'closePane' }; // 보고 있는 창의 세션을 끈다 (대화는 남는다)
    case 't':
      return { type: 'newSession' }; // 보고 있는 프로젝트(또는 참모)에 세션 하나 더
    case 'm':
      return { type: 'memo' }; // 보고 있는 창 위에 그 프로젝트 메모
    case 'e':
      return { type: 'toggleReader' }; // 작업 패널 왼쪽 리더 패널
    case 'E':
      return { type: 'readerFull' }; // ⌘⇧E 리더 크게·작게
    case 'Enter':
      return { type: 'maximizePane' }; // ⌘Enter · ⌘⇧Enter(iTerm2·Warp 관례) — 보고 있는 창 크게/되돌리기
    case '/':
      return { type: 'tour' }; // 둘러보기 다시 보기
    case ',':
      return { type: 'settings' }; // macOS 관례 — 설정 화면
    default:
      return null;
  }
}

export const DEFAULT_FONT = 12;
export const clampFont = (n: number) => Math.min(24, Math.max(9, n));

/** 메뉴바 항목 id(Rust main.rs 메뉴) → 동작. 단축키는 메뉴에 걸려 있어 메뉴에서 보이고, 같은 동작으로 돈다 */
const MENU: Record<string, Shortcut> = {
  goto_orch: { type: 'goto', to: 'orchestrator' },
  goto_all: { type: 'goto', to: 'all' },
  goto_review: { type: 'goto', to: 'review' },
  goto_office: { type: 'goto', to: 'office' },
  goto_tama: { type: 'goto', to: 'tama' },
  open_dex: { type: 'goto', to: 'tama' },
  sidebar: { type: 'toggleSidebar' },
  tasks: { type: 'toggleTasks' },
  search: { type: 'search' },
  font_up: { type: 'font', delta: 1 },
  font_down: { type: 'font', delta: -1 },
  font_reset: { type: 'fontReset' },
  new_session: { type: 'newSession' },
  close_pane: { type: 'closePane' },
  widget_toggle: { type: 'widget' },
  memo: { type: 'memo' },
  reader_toggle: { type: 'toggleReader' },
  reader_full: { type: 'readerFull' },
  reader_next: { type: 'readerTab', dir: 1 },
  reader_prev: { type: 'readerTab', dir: -1 },
  reader_close: { type: 'readerClose' },
  settings: { type: 'settings' },
  pane_max: { type: 'maximizePane' },
  tour: { type: 'tour' },
  app_quit_all: { type: 'quitAsk' },
};
export const menuAction = (id: string): Shortcut | null => MENU[id] ?? null;

/** 같은 동작으로 칠 시간. 토글은 두 갈래(메뉴·키 입력)가 150ms 넘게 벌어져 와도 열었다 바로 닫히면 안 된다(⌘M 실측).
 *  글자 크기만 연달아 누를 수 있게 짧게. 리더 Ctrl+Tab 은 한 길(keys_mac)로만 와서 거르지 않는다(빠르게 누르면 씹혔다, 2026-09-28) */
export const dedupeMs = (sc: Shortcut) => (sc.type === 'readerTab' ? 0 : sc.type === 'font' ? 150 : 400);

/** 메뉴 단축키와 웹뷰 키 입력이 둘 다 오면(맥이 어느 쪽을 먼저 주는지는 키마다 다르다) 한 번만 — 토글이 두 번 돌면 제자리 */
export function onceWithin(ms: number) {
  const last = new Map<string, number>();
  return (key: string, now: number) => {
    const prev = last.get(key);
    last.set(key, now);
    return prev === undefined || now - prev >= ms;
  };
}
