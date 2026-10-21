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
  /** ⌘⇧W — 보고 있는 창의 세션 끄기(확인을 한 번 거친다) */
  | { type: 'closePane' }
  /** ⌘⇧T — 보고 있는 프로젝트에 새 세션(참모 화면이면 새 참모) */
  | { type: 'newSession' }
  /** ⌘W — 스페이스에서 열려 있는 탭(파일·문서·세션) 닫기, 고정 탭(홈·보관함)은 안 닫힘 (2026-10-12 사용자) */
  | { type: 'closeTab' }
  /** ⌘T — 보고 있는 보관함 폴더에 빈 문서 새로 */
  | { type: 'newDoc' }
  /** ⌘⇧H·⌘⇧L — 고른 참모의 홈·보관함 고정 탭으로 */
  | { type: 'goHome' }
  | { type: 'goLocker' }
  | { type: 'widget' }
  | { type: 'memo' }
  | { type: 'toggleReader' }
  | { type: 'readerFull' }
  | { type: 'readerTab'; dir: 1 | -1 }
  | { type: 'readerClose' }
  | { type: 'settings' }
  | { type: 'maximizePane' }
  | { type: 'tour' }
  /** 하니터(하네스 보기·끄고 켜기) 열고 닫기 — 탑바 버튼·메뉴 */
  | { type: 'harnitor' }
  | { type: 'licenses' }
  | { type: 'quitAsk' }
  | { type: 'selectAll' }
  /** ⌘[ ⌘] — 스페이스 뒤로(왔던 곳)·앞으로(2026-10-04 QA D2) */
  | { type: 'nav'; dir: -1 | 1 }
  /** 고른 채팅 탭(참모)을 왼쪽·오른쪽으로 한 칸 — 순서는 domain/orchOrder(2026-10-10 사용자) */
  | { type: 'moveTab'; dir: -1 | 1 };

type KeyLike = { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };

const GOTO: Record<number, Shortcut> = { 1: { type: 'goto', to: 'orchestrator' }, 2: { type: 'goto', to: 'all' }, 3: { type: 'goto', to: 'review' }, 4: { type: 'goto', to: 'office' } };
/** 숫자 칸 → 화면 이동(스페이스를 끈 화면에서 ⌘1~4, 늘 ⌥⌘1~4) */
export const gotoOfNum = (n: number): Shortcut | null => GOTO[n] ?? null;

// 한글 입력 상태에선 같은 자리 키가 자모로 들어온다 — 영문 키로 바꿔 읽는다
// ⌘⇧ 일 땐 쌍자음으로 온다(ㅆ=⇧ㅅ, ㅉ=⇧ㅈ, ㄸ=⇧ㄷ). ㅗ·ㅣ 는 ⇧ 를 눌러도 같은 글자라 아래에서 ⇧ 로 가른다
const HANGUL_KEY: Record<string, string> = { ㅁ: 'a', ㅠ: 'b', ㅓ: 'j', ㅏ: 'k', ㅈ: 'w', ㅅ: 't', ㅡ: 'm', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅆ: 'T', ㅉ: 'W', ㅗ: 'h', ㅣ: 'l' };

/**
 * 탭 옮기기 — 크롬과 같은 ⌃⇧PageUp/PageDown(맥 자판은 fn+↑↓) + 맥 손에 맞는 ⌥⌘⇧←/→, 윈도우는 Ctrl+Alt+Shift+←/→.
 * Ctrl 조합이지만 터미널·Claude 입력칸이 안 쓰는 키라 앱이 가져간다. 한 수정키라도 빠지면 아니다(⌘← 는 입력칸 줄 처음)
 */
function tabMoveOf(e: KeyLike, win: boolean): Shortcut | null {
  const page = e.key === 'PageUp' ? -1 : e.key === 'PageDown' ? 1 : 0;
  if (page && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) return { type: 'moveTab', dir: page };
  const arrow = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  const mod = win ? e.ctrlKey && !e.metaKey : e.metaKey && !e.ctrlKey;
  if (arrow && mod && e.altKey && e.shiftKey) return { type: 'moveTab', dir: arrow };
  return null;
}

export function shortcutFor(input: KeyLike, win = IS_WIN): Shortcut | null {
  const move = tabMoveOf(input, win);
  if (move) return move;
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
  // ⌘[ ⌘] = 뒤로·앞으로 — 입력기에 따라 글자가 바뀌니(「) 키 자리로. ⌘⇧[ ] 는 안 잡는다
  if (!e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.key === '[' || e.key === ']')) {
    return { type: 'nav', dir: e.code === 'BracketRight' || e.key === ']' ? 1 : -1 };
  }
  const raw = HANGUL_KEY[e.key] ?? e.key;
  // ⌘⇧W·T·H·L — 글자가 소문자로 와도(한글 ㅗ·ㅣ) ⇧ 가 눌렸으면 대문자 칸, ⇧ 없는 ⌘H·⌘L 은 앱이 안 쓴다(⌘H 는 macOS 숨기기)
  // CapsLock 으로 대문자가 와도 ⇧ 가 없으면 ⇧ 없는 쪽 — 세션 끄기(⌘⇧W)가 CapsLock ⌘W 로 눌리면 안 된다
  const key = raw.length === 1 && 'wthl'.includes(raw.toLowerCase()) ? (e.shiftKey ? raw.toUpperCase() : raw.toLowerCase()) : raw;
  switch (key) {
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
      return { type: 'closeTab' }; // 스페이스에서 열려 있는 탭 닫기
    case 't':
      return { type: 'newDoc' }; // 보관함에 빈 문서 새로
    case 'W':
      return { type: 'closePane' }; // 보고 있는 창의 세션을 끈다 (대화는 남는다) — 확인 창을 거친다
    case 'T':
      return { type: 'newSession' }; // 보고 있는 프로젝트(또는 참모)에 세션 하나 더
    case 'H':
      return { type: 'goHome' };
    case 'L':
      return { type: 'goLocker' };
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
  close_tab: { type: 'closeTab' },
  new_doc: { type: 'newDoc' },
  go_home: { type: 'goHome' },
  go_locker: { type: 'goLocker' },
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
  harnitor: { type: 'harnitor' },
  licenses: { type: 'licenses' },
  app_quit_all: { type: 'quitAsk' },
};
export const menuAction = (id: string): Shortcut | null => MENU[id] ?? null;

/** 같은 동작으로 칠 시간. 토글은 두 갈래(메뉴·키 입력)가 150ms 넘게 벌어져 와도 열었다 바로 닫히면 안 된다(⌘M 실측).
 *  글자 크기만 연달아 누를 수 있게 짧게. 리더 Ctrl+Tab 은 한 길(keys_mac)로만 와서 거르지 않는다(빠르게 누르면 씹혔다, 2026-09-28) */
export const dedupeMs = (sc: Shortcut) => (sc.type === 'readerTab' || sc.type === 'nav' || sc.type === 'moveTab' ? 0 : sc.type === 'font' ? 150 : 400);

/**
 * ⌘A 용 — 같은 누름이 메뉴·키 입력 두 갈래로 오면 한 번만, 같은 갈래로 연달아 온 건 다 산다.
 * 문서 편집기 ⌘A 는 누를 때마다 칸 → 문서로 넓혀서(ui/space/selectAllStep), onceWithin 처럼 400ms 안의 두 번째 키를 버리면 빠르게 두 번 눌러도 안 넓어졌다
 */
export function onceAcross(ms: number) {
  let last: { src: 'key' | 'menu'; at: number } | null = null;
  return (src: 'key' | 'menu', now: number) => {
    const dup = last !== null && last.src !== src && now - last.at < ms;
    last = dup ? null : { src, at: now };
    return !dup;
  };
}

/** 메뉴 단축키와 웹뷰 키 입력이 둘 다 오면(맥이 어느 쪽을 먼저 주는지는 키마다 다르다) 한 번만 — 토글이 두 번 돌면 제자리 */
export function onceWithin(ms: number) {
  const last = new Map<string, number>();
  return (key: string, now: number) => {
    const prev = last.get(key);
    last.set(key, now);
    return prev === undefined || now - prev >= ms;
  };
}

/** ⌘+ ⌘- ⌘0 을 받을 곳 — 화면 영역(포커스 또는 마지막으로 누른 곳) */
export type ZoomArea = 'chat' | 'term' | 'tab' | 'none';

/**
 * 글자 크기(font)냐 스페이스 탭 확대(tab)냐 — 포커스가 채팅·터미널이면 글자, 탭이면 탭, 포커스가 어디도 아니면 마지막으로 누른 곳,
 * 그것도 모르면 지금처럼 탭 먼저(확대할 탭이 없으면 App 이 글자로). 문서 탭을 띄운 채 채팅에서 눌러도 탭만 커져 '안 된다'로 보였다(2026-10-22 사용자 제보)
 */
export function zoomTarget(active: ZoomArea, last: ZoomArea): 'font' | 'tab' {
  const at = active === 'none' ? last : active;
  return at === 'chat' || at === 'term' ? 'font' : 'tab';
}

/** html 탭(iframe)이 hodoc 다리로 넘긴 확대 키 — 확대 셋(1·-1·0)만. 그 페이지(남의 html)가 흉내 내도 자기 확대만 바뀌게 다른 건 다 버린다 */
export function frameZoomCmd(data: unknown): 1 | -1 | 0 | null {
  const d = data as { hodoc?: unknown; c?: unknown } | null;
  if (!d || d.hodoc !== 'zoom') return null;
  return d.c === 1 || d.c === -1 || d.c === 0 ? d.c : null;
}
