import { describe, expect, it } from 'vitest';
import { clampFont, dedupeMs, gotoOfNum, menuAction, onceWithin, shortcutFor } from './shortcuts';

const k = (key: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) => ({
  key,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  ctrlKey: mods.ctrl ?? false,
});

describe('shortcutFor — 앱 단축키', () => {
  // 2026-09-30 사용자: 스페이스가 기본이 되며 ⌘1~9 = 채팅 탭. 화면 이동은 ⌥⌘1~4(스페이스를 끄면 ⌘1~4 도 예전처럼 — App 이 가른다)
  it('⌘1~9 는 숫자 칸(채팅 탭 N번)', () => {
    expect(shortcutFor(k('1', { meta: true }))).toEqual({ type: 'num', n: 1 });
    expect(shortcutFor(k('9', { meta: true }))).toEqual({ type: 'num', n: 9 });
  });

  it('⌥⌘1 참모 · ⌥⌘2 전체 보기 · ⌥⌘3 리뷰 · ⌥⌘4 사무실 — ⌥ 로 글자가 바뀌어도 키 자리(code)로', () => {
    const alt = (code: string) => ({ ...k('¡', { meta: true, alt: true }), code });
    expect(shortcutFor(alt('Digit1'))).toEqual({ type: 'goto', to: 'orchestrator' });
    expect(shortcutFor(alt('Digit2'))).toEqual({ type: 'goto', to: 'all' });
    expect(shortcutFor(alt('Digit3'))).toEqual({ type: 'goto', to: 'review' });
    expect(shortcutFor(alt('Digit4'))).toEqual({ type: 'goto', to: 'office' });
    expect(shortcutFor(alt('Digit5'))).toBeNull();
  });

  it('숫자 칸 → 스페이스를 끈 화면에선 예전 화면 이동', () => {
    expect(gotoOfNum(1)).toEqual({ type: 'goto', to: 'orchestrator' });
    expect(gotoOfNum(4)).toEqual({ type: 'goto', to: 'office' });
    expect(gotoOfNum(5)).toBeNull();
  });

  it('⌘= / ⌘+ 글자 키우기 (Shift를 눌러 +로 쳐도)', () => {
    expect(shortcutFor(k('=', { meta: true }))).toEqual({ type: 'font', delta: 1 });
    expect(shortcutFor(k('+', { meta: true, shift: true }))).toEqual({ type: 'font', delta: 1 });
  });

  it('⌘- 줄이기, ⌘0 원래 크기', () => {
    expect(shortcutFor(k('-', { meta: true }))).toEqual({ type: 'font', delta: -1 });
    expect(shortcutFor(k('0', { meta: true }))).toEqual({ type: 'fontReset' });
  });

  it('⌘B 사이드바, ⌘J 작업 패널 열고 닫기', () => {
    expect(shortcutFor(k('b', { meta: true }))).toEqual({ type: 'toggleSidebar' });
    expect(shortcutFor(k('j', { meta: true }))).toEqual({ type: 'toggleTasks' });
  });

  it('⌘K 검색, ⌘W 보고 있는 창의 세션 끄기', () => {
    expect(shortcutFor(k('k', { meta: true }))).toEqual({ type: 'search' });
    // ⌘F = 찾기(문서가 열려 있으면 문서 찾기 — README 에 적은 대로, 공개 2차 검증에서 안 붙어 있던 것), 한글 입력이면 ㄹ
    expect(shortcutFor(k('f', { meta: true }))).toEqual({ type: 'search' });
    expect(shortcutFor(k('ㄹ', { meta: true }))).toEqual({ type: 'search' });
    expect(shortcutFor(k('w', { meta: true }))).toEqual({ type: 'closePane' });
  });

  it('⌘ 없이는 아무것도 아니다 — 터미널 입력을 뺏으면 안 된다', () => {
    expect(shortcutFor(k('1'))).toBeNull();
    expect(shortcutFor(k('b', { ctrl: true }))).toBeNull();
  });

  it('⌘C·⌘V는 건드리지 않는다 (복사·붙여넣기)', () => {
    expect(shortcutFor(k('c', { meta: true }))).toBeNull();
    expect(shortcutFor(k('v', { meta: true }))).toBeNull();
  });

  it('⌘⌥1 처럼 다른 수식키가 섞이면 무시', () => {
    expect(shortcutFor(k('1', { meta: true, alt: true }))).toBeNull();
  });
});

describe('clampFont — 글자 크기 범위', () => {
  it('9~24 사이로 묶는다', () => {
    expect(clampFont(8)).toBe(9);
    expect(clampFont(30)).toBe(24);
    expect(clampFont(13)).toBe(13);
  });

  it('⌘T 보고 있는 프로젝트(또는 참모)에 새 세션', () => {
    expect(shortcutFor(k('t', { meta: true }))).toEqual({ type: 'newSession' });
  });

  it('⌘M 보고 있는 창의 프로젝트 메모 (한글 상태 ⌘ㅡ 도)', () => {
    expect(shortcutFor(k('m', { meta: true }))).toEqual({ type: 'memo' });
    expect(shortcutFor(k('ㅡ', { meta: true }))).toEqual({ type: 'memo' });
    expect(menuAction('memo')).toEqual({ type: 'memo' });
  });

  it('한글 입력 상태여도 같은 자리 키로 동작 (⌘ㅅ=⌘T, ⌘ㅈ=⌘W)', () => {
    expect(shortcutFor(k('ㅅ', { meta: true }))).toEqual({ type: 'newSession' });
    expect(shortcutFor(k('ㅈ', { meta: true }))).toEqual({ type: 'closePane' });
    expect(shortcutFor(k('ㅏ', { meta: true }))).toEqual({ type: 'search' });
  });
});

describe('⌘A — 보고 있는 곳만 전체 선택 (사용자 2026-09-29)', () => {
  it('⌘A · 한글 입력 상태 ⌘ㅁ', () => {
    expect(shortcutFor(k('a', { meta: true }))).toEqual({ type: 'selectAll' });
    expect(shortcutFor(k('ㅁ', { meta: true }))).toEqual({ type: 'selectAll' });
    expect(shortcutFor(k('a', { meta: true, shift: true }))).toBeNull();
  });
  it('메뉴 전체 선택도 같은 동작, 키와 메뉴가 둘 다 와도 한 번', () => {
    expect(menuAction('select_all')).toEqual({ type: 'selectAll' });
    expect(dedupeMs({ type: 'selectAll' })).toBeGreaterThan(0);
  });
});

describe('menuAction — 메뉴바 항목 → 앱 동작 (단축키와 같은 동작)', () => {
  it('보기·세션·다마고치 메뉴', () => {
    expect(menuAction('goto_orch')).toEqual({ type: 'goto', to: 'orchestrator' });
    expect(menuAction('goto_all')).toEqual({ type: 'goto', to: 'all' });
    expect(menuAction('goto_review')).toEqual({ type: 'goto', to: 'review' });
    expect(menuAction('goto_office')).toEqual({ type: 'goto', to: 'office' });
    expect(menuAction('goto_tama')).toEqual({ type: 'goto', to: 'tama' });
    expect(menuAction('open_dex')).toEqual({ type: 'goto', to: 'tama' });
    expect(menuAction('sidebar')).toEqual({ type: 'toggleSidebar' });
    expect(menuAction('tasks')).toEqual({ type: 'toggleTasks' });
    expect(menuAction('search')).toEqual({ type: 'search' });
    expect(menuAction('font_up')).toEqual({ type: 'font', delta: 1 });
    expect(menuAction('font_down')).toEqual({ type: 'font', delta: -1 });
    expect(menuAction('font_reset')).toEqual({ type: 'fontReset' });
    expect(menuAction('new_session')).toEqual({ type: 'newSession' });
    expect(menuAction('close_pane')).toEqual({ type: 'closePane' });
    expect(menuAction('widget_toggle')).toEqual({ type: 'widget' });
    expect(menuAction('settings')).toEqual({ type: 'settings' });
  });
  it('모르는 항목은 null', () => {
    expect(menuAction('nope')).toBeNull();
  });
});

describe('onceWithin — 메뉴 단축키와 키 입력이 같이 와도 한 번만', () => {
  it('같은 동작이 150ms 안에 또 오면 건너뛴다, 다른 동작은 통과', () => {
    const gate = onceWithin(150);
    expect(gate('toggleSidebar', 1000)).toBe(true);
    expect(gate('toggleSidebar', 1100)).toBe(false);
    expect(gate('toggleTasks', 1120)).toBe(true);
    expect(gate('toggleSidebar', 1300)).toBe(true);
  });
});

describe('dedupeMs — 메뉴·키 입력 두 갈래가 늦게 와도 토글이 두 번 돌지 않게', () => {
  it('토글(메모·사이드바·작업 패널…)은 400ms', () => {
    expect(dedupeMs({ type: 'memo' })).toBe(400);
    expect(dedupeMs({ type: 'toggleSidebar' })).toBe(400);
  });
  it('글자 크기는 연달아 누를 수 있게 150ms', () => expect(dedupeMs({ type: 'font', delta: 1 })).toBe(150));
  it('리더 탭 넘기기는 거르지 않는다(0) — 앱 전체 키 감시 한 길로만 와서, 빠르게 연달아 눌러도 다 넘어가야', () => expect(dedupeMs({ type: 'readerTab', dir: 1 })).toBe(0));
});

describe('설정 — 메뉴 Chammo > 설정…(⌘,)', () => {
  it('메뉴 항목과 ⌘, 둘 다 설정 화면', () => {
    expect(menuAction('settings')).toEqual({ type: 'settings' });
    expect(shortcutFor({ key: ',', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toEqual({ type: 'settings' });
  });
});

describe('⌘₩(⌘`) — 보고 있는 창 크게·되돌리기 (2026-09-30: ⌘Enter 는 채팅 끊고 보내기로)', () => {
  it('한글 입력 상태의 ⌘₩', () => expect(shortcutFor(k('₩', { meta: true }))).toEqual({ type: 'maximizePane' }));
  it('영문 입력 상태의 ⌘`', () => expect(shortcutFor(k('`', { meta: true }))).toEqual({ type: 'maximizePane' }));
  it('⌘Enter 는 더 이상 창 크게가 아니다(채팅 입력칸 몫)', () => {
    expect(shortcutFor(k('Enter', { meta: true }))).toBeNull();
    expect(shortcutFor(k('Enter', { meta: true, shift: true }))).toBeNull();
  });
  it('⌥·⌃ 가 섞이면 안 잡는다(터미널 몫)', () => expect(shortcutFor(k('₩', { meta: true, alt: true }))).toBeNull());
  it('메뉴 항목에서도 같은 동작', () => expect(menuAction('pane_max')).toEqual({ type: 'maximizePane' }));
});

describe('종료 — ⌘Q 는 Rust 가 독에서 빼고(웹뷰로 안 옴), ⌥⌘Q "완전히 종료"만 묻는다', () => {
  it('완전히 종료는 묻기', () => expect(menuAction('app_quit_all')).toEqual({ type: 'quitAsk' }));
  it('⌘Q 는 웹뷰 동작이 아니다', () => expect(menuAction('app_quit')).toBeNull());
});
