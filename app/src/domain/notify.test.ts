import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { blockedBody, nativeWhenFocused, NOTIFY_GAP_MS, noteKey, noteTarget, readNoteTarget, shouldNotify, wants, type Note } from './notify';

describe('wants — 어떤 알림을 보내나 (사용자 2026-09-27 "필요한 것만")', () => {
  it('결정 대기(task ask·로그인 오류)·권한 창 자동 허용 실패는 늘 보낸다', () => {
    for (const k of ['decide', 'login', 'allowFail'] as const) {
      expect(wants(k, false)).toBe(true);
      expect(wants(k, true)).toBe(true);
    }
  });
  it('물어봄·확인창·컨텍스트 80% 는 참모 세션만 — 하위 세션은 참모가 챙긴다', () => {
    for (const k of ['asks', 'blocked', 'ctx'] as const) {
      expect(wants(k, true)).toBe(true);
      expect(wants(k, false)).toBe(false);
    }
  });
});

describe('shouldNotify — 같은 세션·같은 종류는 2분에 한 번, 빈 본문은 안 보냄', () => {
  const NOW = 1_000_000;
  const n = (o: Partial<Note> = {}): Note => ({ kind: 'asks', session: 'b1', orch: true, title: '참모 답이 필요해', body: '머지할까?', ...o });

  it('처음 보는 알림은 보낸다', () => expect(shouldNotify(n(), new Map(), NOW)).toBe(true));
  it('2분 안에 같은 세션·같은 종류면 안 보낸다', () => {
    const last = new Map([[noteKey(n()), NOW - NOTIFY_GAP_MS + 1]]);
    expect(shouldNotify(n(), last, NOW)).toBe(false);
  });
  it('2분이 지나면 다시 보낸다', () => {
    const last = new Map([[noteKey(n()), NOW - NOTIFY_GAP_MS]]);
    expect(shouldNotify(n(), last, NOW)).toBe(true);
  });
  it('종류나 세션이 다르면 따로 센다', () => {
    const last = new Map([[noteKey(n()), NOW]]);
    expect(shouldNotify(n({ kind: 'blocked' }), last, NOW)).toBe(true);
    expect(shouldNotify(n({ session: 'b2' }), last, NOW)).toBe(true);
  });
  it('본문이 비면 안 보낸다', () => {
    expect(shouldNotify(n({ body: '' }), new Map(), NOW)).toBe(false);
    expect(shouldNotify(n({ body: '  \n ' }), new Map(), NOW)).toBe(false);
  });
  it('정책이 원하지 않는 알림(하위 세션 물어봄)은 안 보낸다', () => {
    expect(shouldNotify(n({ orch: false }), new Map(), NOW)).toBe(false);
  });
});

describe('blockedBody — 확인창 알림 본문(대화 기록의 옛 답 대신 무엇에 멈췄는지)', () => {
  it.each([
    ['permission prompt', '권한 창에서 멈췄어'],
    ['input needed', '선택지 질문에서 멈췄어'],
    ['startup prompt', '시작 확인 창에서 멈췄어'],
    [undefined, '확인창에서 멈췄어'],
  ])('%s → %s', (w, out) => expect(blockedBody(w)).toBe(out));
});

describe('noteTarget — 알림을 누르면 어디로 (macOS 알림 userInfo 에 글자로 실어 보낸다)', () => {
  const n = (o: Partial<Note>): Note => ({ kind: 'asks', session: 'b1', orch: true, title: 't', body: 'b', ...o });
  it('결정 대기·로그인 오류는 결정 대기함', () => {
    expect(noteTarget(n({ kind: 'decide', session: 'task:1:ts' }))).toBe('inbox');
    expect(noteTarget(n({ kind: 'login', session: 'login' }))).toBe('inbox');
  });
  it('물어봄·확인창·자동 허용 실패·컨텍스트는 그 세션', () => {
    for (const kind of ['asks', 'blocked', 'allowFail', 'ctx'] as const) expect(noteTarget(n({ kind, session: 'abc' }))).toBe('session:abc');
  });
});

describe('readNoteTarget — 눌린 알림에서 돌아온 글자를 되읽기', () => {
  it('왕복', () => {
    expect(readNoteTarget('inbox')).toEqual({ to: 'inbox' });
    expect(readNoteTarget('session:abc')).toEqual({ to: 'session', id: 'abc' });
  });
  it('모르는 글자·빈 세션은 null (그냥 창만 앞으로)', () => {
    expect(readNoteTarget('')).toBeNull();
    expect(readNoteTarget('session:')).toBeNull();
    expect(readNoteTarget('whatever')).toBeNull();
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('확인창 알림 본문을 영어로 — waitingFor 값은 열쇠로 그대로 읽는다', () => {
    setLang('en');
    expect(blockedBody('permission prompt')).toBe('Stopped at a permission prompt');
    expect(blockedBody()).toBe('Stopped at a prompt');
  });
});

describe('nativeWhenFocused — 참모 창을 보고 있으면 앱 안에 뜨는 것은 맥 알림을 안 보낸다(2026-10-03 사용자)', () => {
  it('참모 물어봄·확인창·결정·로그인 오류는 앱 안에 뜨니까 보고 있으면 안 보냄', () => {
    for (const k of ['asks', 'blocked', 'decide', 'login'] as const) expect(nativeWhenFocused(k)).toBe(false);
  });
  it('권한 자동 허용 실패·계정·컨텍스트는 앱 안에 따로 안 뜨니 보고 있어도 보냄', () => {
    for (const k of ['allowFail', 'accounts', 'ctx'] as const) expect(nativeWhenFocused(k)).toBe(true);
  });
});

import { nativeWhenFocused as nwf, wants as wantsK } from './notify';
describe('human — 세션 브라우저가 사람을 부름(browser_ask_human)', () => {
  it('하위 세션이어도 알리고, 앱을 보고 있으면 앱 안 모달만', () => {
    expect(wantsK('human', false)).toBe(true);
    expect(nwf('human')).toBe(false);
  });
});

import { watching } from './notify';
describe('watching — 참모 창을 보고 있나', () => {
  it('맥은 웹 값 그대로(문서 포커스·안 숨김)', () => {
    expect(watching(false, { focus: true, hidden: false })).toBe(true);
    expect(watching(false, { focus: false, hidden: false })).toBe(false);
    expect(watching(false, { focus: true, hidden: true })).toBe(false);
    // 맥은 Rust 값이 와도 안 본다(지금 동작 그대로)
    expect(watching(false, { focus: true, hidden: false }, false)).toBe(true);
  });
  it('윈도우는 Rust 창 상태만 — WebView2 는 최소화·뒤에 있어도 hasFocus=true(2026-10-05 QA)', () => {
    expect(watching(true, { focus: true, hidden: false }, false)).toBe(false);
    expect(watching(true, { focus: true, hidden: false }, true)).toBe(true);
    // Rust 를 못 물으면 보고 있지 않은 것으로 — 알림을 놓치는 쪽보다 한 번 더 보내는 쪽
    expect(watching(true, { focus: true, hidden: false }, null)).toBe(false);
    expect(watching(true, { focus: true, hidden: false })).toBe(false);
  });
});
