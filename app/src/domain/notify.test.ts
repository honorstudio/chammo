import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { blockedBody, cardTarget, cardToken, nativeWhenFocused, toWithdraw, NOTIFY_GAP_MS, noteKey, noteTarget, readNoteTarget, shouldNotify, wants, type Note } from './notify';

describe('wants — 어떤 알림을 보내나 (사용자 2026-09-27 "필요한 것만")', () => {
  it('결정 대기(task ask·로그인 오류)·권한 창 자동 허용 실패는 늘 보낸다', () => {
    for (const k of ['decide', 'login', 'allowFail', 'lost'] as const) { // lost = 재시작으로 꺼진 세션을 참모에게 세 번 못 알림
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
  it('갈 곳(go)을 따로 주면 그것 — 결정·직접 카드는 그 카드가 있는 참모 채팅의 그 카드로(2026-10-23 폰 알림)', () => {
    expect(noteTarget(n({ kind: 'decide', session: 'task:1:ts', go: cardTarget('5e55a0d1', 'w:1001-0900-ab12') }))).toBe('card:5e55a0d1:w:1001-0900-ab12');
    expect(noteTarget(n({ kind: 'human', session: 'sub1', go: cardTarget('o1', 'd:card9') }))).toBe('card:o1:d:card9');
  });
});

describe('readNoteTarget — 눌린 알림에서 돌아온 글자를 되읽기', () => {
  it('왕복', () => {
    expect(readNoteTarget('inbox')).toEqual({ to: 'inbox' });
    expect(readNoteTarget('session:abc')).toEqual({ to: 'session', id: 'abc' });
    expect(readNoteTarget('card:5e55a0d1-ab30:w:1001-0900-ab12')).toEqual({ to: 'card', orch: '5e55a0d1-ab30', card: 'w:1001-0900-ab12' });
    expect(readNoteTarget('team:room-1')).toEqual({ to: 'team', room: 'room-1' });
    expect(readNoteTarget('latest')).toEqual({ to: 'latest' });
  });
  it('카드 갈 곳은 참모·카드가 다 있어야 — 하나라도 비면 null', () => {
    expect(readNoteTarget('card:o1')).toBeNull();
    expect(readNoteTarget('card::w:1')).toBeNull();
    expect(readNoteTarget('card:o1:')).toBeNull();
    expect(readNoteTarget('team:')).toBeNull();
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
  it('참모 물어봄·확인창·결정·로그인 오류·컨텍스트는 앱 안에 뜨니까 보고 있으면 안 보냄(컨텍스트는 보관함 활동 줄 끝, 알림 N1)', () => {
    for (const k of ['asks', 'blocked', 'decide', 'login', 'ctx'] as const) expect(nativeWhenFocused(k)).toBe(false);
  });
  it('권한 자동 허용 실패·계정은 앱 안에 따로 안 뜨니 보고 있어도 보냄', () => {
    for (const k of ['allowFail', 'accounts'] as const) expect(nativeWhenFocused(k)).toBe(true);
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

// 2026-10-24 사용자가 밖에 있을 때 놓침 — 맥 창을 앞에 둔 채 자리를 비우면 '보고 있음'으로 쳐서 사람 필요 알림이 폰 푸시까지 안 나갔다
import { AWAY_SECS, awayPush, awayStep, heldStep, HOLD_MAX_SECS } from './notify';
describe('자리 비움 — 보고 있어도 맥 입력이 없거나 잠겼으면 사람 필요 알림은 폰으로도', () => {
  const at = (idle: number | null, locked = false) => ({ idle, locked });
  it('사람 필요(사람 부르기·직접 카드·결정·물어봄·로그인)만 — 컨텍스트·확인창 같은 건 안 쏟아지게', () => {
    for (const k of ['human', 'decide', 'asks', 'login'] as const) expect(awayPush(k)).toBe(true);
    for (const k of ['ctx', 'blocked', 'allowFail', 'accounts', 'lost'] as const) expect(awayPush(k)).toBe(false);
  });
  it('보고 있음 — 막 만졌으면(입력 30초 전) 기다림, 자리 비움 시간을 넘으면 보낸다', () => {
    expect(awayStep(0, at(30))).toBe('wait');
    expect(awayStep(0, at(AWAY_SECS))).toBe('send');
    expect(awayStep(0, at(AWAY_SECS + 600))).toBe('send');
  });
  it('화면 잠김이면 입력 시간과 상관없이 바로 보낸다', () => {
    expect(awayStep(0, at(2, true))).toBe('send');
    expect(awayStep(0, at(null, true))).toBe('send');
  });
  it('알림이 온 뒤 사람이 맥을 만졌으면(입력이 알림보다 나중) 앱에서 본 것 — 버린다', () => {
    expect(awayStep(60, at(10))).toBe('drop');
  });
  it('알림이 온 뒤로 손을 안 댔으면 자리 비움 시간이 차는 대로 보낸다(오고 나서 자리를 떠난 경우)', () => {
    expect(awayStep(60, at(100))).toBe('wait');
    expect(awayStep(200, at(AWAY_SECS + 50))).toBe('send');
  });
  it('입력 시간을 모르면(윈도우·읽기 실패) 지금처럼 앱 안만 — 버린다', () => {
    expect(awayStep(0, at(null))).toBe('drop');
  });
  it('붙든 지 오래된 건 보내지 않는다', () => {
    expect(awayStep(HOLD_MAX_SECS + 1, at(HOLD_MAX_SECS + 100))).toBe('drop');
  });
  it('heldStep — 붙든 알림마다 갈라 보낼 것과 남길 것', () => {
    const n = (session: string): Note => ({ kind: 'human', session, orch: false, title: 't', body: 'b' });
    const now = 1_000_000;
    const held = [{ n: n('a'), at: now - 60_000 }, { n: n('b'), at: now - 5_000 }];
    const r = heldStep(held, now, at(50));
    expect(r.send.map((x) => x.session)).toEqual([]);
    expect(r.keep.map((x) => x.n.session)).toEqual(['b']); // a 는 온 뒤에 만졌다(60초 전 알림, 50초 전 입력) → 버림
    const r2 = heldStep(r.keep, now + AWAY_SECS * 1000, at(AWAY_SECS + 5));
    expect(r2.send.map((x) => x.session)).toEqual(['b']);
    expect(r2.keep).toEqual([]);
  });
});

describe('카드가 닫히면 알림을 거둔다(10-26 "인증했으면 다른 기기 알림만 없어지면 된다")', () => {
  it('알린 카드가 답·닫힘·사라짐이면 거둘 꼬리 — 아직 기다리는 카드·안 알린 카드는 그대로', () => {
    const told = new Set(['a1', 'b2', 'c3']);
    const cards = [{ id: 'a1', wait: true }, { id: 'b2', wait: false }, { id: 'z9', wait: false }];
    expect(toWithdraw(told, cards, (c) => c.wait)).toEqual(['b2', 'c3']);
  });
  it('꼬리는 카드 알림 갈 곳의 끝과 맞는다', () => {
    expect(cardTarget('orch-1', `d:${'ab12cd34'}`).endsWith(`:${cardToken('ab12cd34')}`)).toBe(true);
  });
});
