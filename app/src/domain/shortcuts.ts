// 앱 단축키. ⌘ 단독 조합만 쓴다 — Ctrl·Alt 조합은 터미널(Claude 입력칸) 몫이라 뺏으면 안 된다.
import { winToMac } from './keys';
import { IS_WIN } from './reader';

export type Shortcut =
  | { type: 'goto'; to: 'orchestrator' | 'all' | 'tama' | 'review' | 'office' }
  /** ⌘1~9 — 스페이스면 채팅 탭 N번, 아니면 gotoOfNum(예전 화면 이동) */
  | { type: 'num'; n: number }
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
  | { type: 'quitAsk' }
  | { type: 'selectAll' };

type KeyLike = { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };

const GOTO: Record<number, Shortcut> = { 1: { type: 'goto', to: 'orchestrator' }, 2: { type: 'goto', to: 'all' }, 3: { type: 'goto', to: 'review' }, 4: { type: 'goto', to: 'office' } };
/** 숫자 칸 → 화면 이동(스페이스를 끈 화면에서 ⌘1~4, 늘 ⌥⌘1~4) */
export const gotoOfNum = (n: number): Shortcut | null => GOTO[n] ?? null;

// 한글 입력 상태에선 같은 자리 키가 자모로 들어온다 — 영문 키로 바꿔 읽는다
const HANGUL_KEY: Record<string, string> = { ㅁ: 'a', ㅠ: 'b', ㅓ: 'j', ㅏ: 'k', ㅈ: 'w', ㅅ: 't', ㅡ: 'm', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f' };

export function shortcutFor(input: KeyLike, win = IS_WIN): Shortcut | null {
  // 윈도우는 Ctrl(+Shift) 조합을 맥 ⌘ 조합으로 바꿔 읽는다(domain/keys)
  const e = win ? winToMac(input) : input;
  if (!e) return null;
  // ⌥⌘1~4 = 화면 이동. ⌥ 를 누르면 글자가 바뀌니(¡™£¢) 키 자리로 읽는다
  if (e.metaKey && e.altKey && !e.ctrlKey) {
    const d = e.code?.match(/^Digit([1-9])$/);
    return d ? gotoOfNum(Number(d[1])) : null;
  }
  if (!e.metaKey || e.altKey || e.ctrlKey) return null;
  if (/^[1-9]$/.test(e.key) && !e.shiftKey) return { type: 'num', n: Number(e.key) }; // ⌘1~9 = 채팅 탭(2026-09-30 사용자)
  switch (HANGUL_KEY[e.key] ?? e.key) {
    case '=':
    case '+':
      return { type: 'font', delta: 1 };
    case '-':
      return { type: 'font', delta: -1 };
    case '0':
      return { type: 'fontReset' };
    case 'a':
      return e.shiftKey ? null : { type: 'selectAll' }; // 보고 있는 곳(터미널 창·리더 문서·입력칸)만
    case 'b':
      return { type: 'toggleSidebar' };
    case 'j':
      return { type: 'toggleTasks' };
    case 'k':
    case 'f': // ⌘F — 문서가 열려 있으면 문서 찾기, 아니면 ⌘K 와 같은 검색(App 'search')
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
    case '`':
    case '₩':
      return { type: 'maximizePane' }; // ⌘₩(한글 입력)·⌘` — 보고 있는 창 크게/되돌리기. ⌘Enter 는 채팅 '끊고 보내기'에 내줬다(2026-09-30 사용자)
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
  select_all: { type: 'selectAll' },
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
