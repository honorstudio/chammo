import { describe, expect, it } from 'vitest';
import { browserDock, browserKey, browserOfPick, closeAsk, closeWay, deskOffer, dockTitleOf, hqBrowserHome, paneMenuKeys, paneStatus, browserOwner, paneTarget, signedAutoPeek, signedLine, stillClosed, turnCard, turnCardAfterDone, wentAway } from './browserDock';
import { peekStep, type Live } from './agentBrowser';

const live = (o: Partial<Live> = {}): Live => ({ profile: 'shop-app', pid: 10, sessionPid: 100, url: 'http://localhost:3000/admin', title: '주문 — shop-app', tabs: [], tool: '', toolAt: 0, busy: false, ts: 0, ...o });

describe('세션 브라우저 독(시안 A — 탭 줄 아이콘)', () => {
  it('그 참모 것만 — 참모 자기 브라우저가 맨 앞, 그다음 맡긴 세션 브라우저, 브라우저 없는 세션은 없다', () => {
    const own = live({ profile: '모모-2', sessionPid: 1 });
    const d = browserDock({ name: '모모-2', live: own }, [{ name: 'shop-app', live: live() }, { name: 'todo-api' }, { name: 'docs-site', live: live({ profile: 'docs-site', pid: 11 }) }]);
    expect(d.map((x) => x.profile)).toEqual(['모모-2', 'shop-app', 'docs-site']);
    expect(d.map((x) => x.letter)).toEqual(['모', 'S', 'D']);
  });

  it('같은 프로필을 두 세션이 쥐면 한 칸', () => {
    const d = browserDock({ name: 'o' }, [{ name: 'a', live: live() }, { name: 'b', live: live({ pid: 12 }) }]);
    expect(d).toHaveLength(1);
  });

  it('점 — 사람 부름 > 사람 조작 > 세션이 도는 중, 조용하면 없음', () => {
    const one = (l: Partial<Live>) => browserDock({ name: 'o' }, [{ name: 'a', live: live(l) }])[0]!.dot;
    expect(one({ ask: { reason: '코드', at: 1 }, busy: true })).toBe('ask');
    expect(one({ takeover: { by: 'desktop', at: 1 }, busy: true })).toBe('human');
    expect(one({ busy: true })).toBe('agent');
    expect(one({})).toBe('');
  });

  it('이름표 — 세션 이름 · 지금 페이지 · 상태(아이콘만이라 title·aria 에)', () => {
    const it0 = browserDock({ name: 'o' }, [{ name: 'shop-app', live: live({ busy: true }) }])[0]!;
    expect(dockTitleOf(it0)).toBe('shop-app 브라우저 · 주문 — shop-app · 세션이 쓰는 중');
    const bare = browserDock({ name: 'o' }, [{ name: 'shop-app', live: live({ title: '', url: 'https://example.com/x' }) }])[0]!;
    expect(dockTitleOf(bare)).toBe('shop-app 브라우저 · example.com');
  });

  it('화면 키 b:<프로필> — 왕복', () => {
    expect(browserKey('shop-app')).toBe('b:shop-app');
    expect(browserOfPick('b:shop-app')).toBe('shop-app');
    expect(browserOfPick('k:photocraft')).toBeNull();
  });
});

describe('세션 브라우저 칸 더보기', () => {
  it('창 있는 크롬 — 크롬에서 보기 · 주소 복사 · (맨 안쪽) 끄기', () => {
    expect(paneMenuKeys(false, true)).toEqual(['chrome', 'copy', 'close']);
    expect(paneMenuKeys(false, false)).toEqual(['chrome', 'close']);
  });
  it('헤드리스 — 크롬 창이 없어 크롬에서 보기 대신 회색 안내 한 줄(헤드리스 표시는 여기에만)', () => {
    expect(paneMenuKeys(true, true)).toEqual(['headless', 'copy', 'close']);
  });
  // 2026-10-28 윈도우판 — 숨은 데스크톱 크롬은 창을 못 옮겨서 '크롬에서 보기' = 같은 프로필을 보이는 창으로 다시 띄우기
  it('윈도우 숨은 데스크톱 — 회색 안내 + 보이는 창으로 열기, 꺼냈으면 숨은 화면으로 돌려놓기', () => {
    expect(paneMenuKeys(false, true, { desk: true, shown: false })).toEqual(['desk', 'chrome', 'copy', 'close']);
    expect(paneMenuKeys(false, true, { desk: false, shown: true })).toEqual(['unshow', 'copy', 'close']);
    expect(paneMenuKeys(true, false, { desk: false, shown: false })).toEqual(['headless', 'close']); // 헤드리스로 물러났으면 맥과 같다
  });
  // 2026-10-28 맥 패스키 탈출구 — ad-hoc 사본엔 맥 패스키가 없어 '이번만 구글 크롬으로 열기', 바꿔 뒀으면 '참모 브라우저로 돌아가기'
  it('맥 — 바꿀 수 있는 래퍼만 구글 크롬 단추, 바꿔 뒀으면 돌아가기(크롬에서 보기는 그대로)', () => {
    expect(paneMenuKeys(false, true, undefined, { signable: true, signed: false })).toEqual(['chrome', 'signed', 'copy', 'close']);
    expect(paneMenuKeys(false, true, undefined, { signable: true, signed: true })).toEqual(['chrome', 'unsigned', 'copy', 'close']);
    expect(paneMenuKeys(false, true, undefined, { signable: false, signed: false })).toEqual(['chrome', 'copy', 'close']); // 옛 래퍼·스크립트 크롬
    expect(paneMenuKeys(true, true, undefined, { signable: true, signed: false })).toEqual(['headless', 'copy', 'close']); // 헤드리스는 크롬 창이 없다
  });
  it("'다 했어'를 누르면 그 부름 카드는 래퍼가 치우기 전에 바로 걷힌다(10-28 사용자 — 반응이 느려 여러 번 눌렀다)", () => {
    const ask = turnCard(live({ ask: { reason: '로그인', at: 5 } }), { dialog: null, chooser: null });
    expect(turnCardAfterDone(ask, 5, null)).toEqual(ask); // 아직 안 누름
    expect(turnCardAfterDone(ask, 5, 5)).toBeNull(); // 누른 부름
    expect(turnCardAfterDone(ask, 6, 5)).toEqual(ask); // 새 부름은 다시 보인다
    const dlg = turnCard(live({ ask: { reason: 'x', at: 5 } }), { dialog: { type: 'alert', message: 'y' }, chooser: null });
    expect(turnCardAfterDone(dlg, 5, 5)).toEqual(dlg); // 페이지 대화상자는 '다 했어'로 안 걷힌다
    expect(turnCardAfterDone(null, 5, 5)).toBeNull();
  });
  it('윈도우 사람 차례 — 세션이 부른 카드에 보이는 창 단추(패스키·Windows Hello·OS 파일 창은 숨은 화면에선 안 보인다)', () => {
    const ask = turnCard(live({ ask: { reason: '패스키', at: 1 } }), { dialog: null, chooser: null });
    expect(deskOffer(ask, { desk: true, shown: false })).toBe(true);
    expect(deskOffer(ask, { desk: false, shown: true })).toBe(false); // 이미 꺼냄
    expect(deskOffer(ask, undefined)).toBe(false); // 맥
    expect(deskOffer(turnCard(live(), { dialog: { type: 'alert', message: 'x' }, chooser: null }), { desk: true, shown: false })).toBe(false); // 페이지 대화상자는 칸에서 답한다
    expect(deskOffer(null, { desk: true, shown: false })).toBe(false);
  });
});

describe('사람 부름·크게 보기 → 그 브라우저 칸(모달 대신, 시안 A)', () => {
  const a = live({ profile: 'shop-app' });
  const b = live({ profile: 'todo-api', pid: 11 });
  it('그 브라우저를 독에 둔 참모 — 자기 것이든 맡긴 세션 것이든', () => {
    const rows = [{ id: 'o1', own: undefined, held: [a] }, { id: 'o2', own: b, held: [] }];
    expect(browserOwner('shop-app', rows)).toBe('o1');
    expect(browserOwner('todo-api', rows)).toBe('o2');
  });
  it('어느 참모 독에도 없으면 null — 모달로 물러난다(도우미·주인 없는 세션)', () => {
    expect(browserOwner('docs-site', [{ id: 'o1', own: undefined, held: [a] }])).toBeNull();
  });
});

describe('paneTarget — 사람 부르기 카드를 누르면 스페이스가 갈 참모(10-28 사용자 "카드를 눌렀을 때 스페이스가 안 바뀜")', () => {
  const a = live({ profile: 'project-a' });
  it('카드가 놓인 참모(hint)가 맨 먼저 — 카드를 받는 규칙(forwardTo)과 독 규칙(holderMap)이 갈려도 누른 채팅 참모를 따라간다', () => {
    const rows = [{ id: 'o1', own: undefined, held: [a] }, { id: 'o2', own: undefined, held: [] }];
    expect(paneTarget('project-a', rows, 'o2')).toBe('o2');
  });
  it('독에 없는 브라우저여도 hint 참모가 있으면 거기로 — 예전엔 null 이라 모달로 물러났다', () => {
    expect(paneTarget('project-a', [{ id: 'o2', own: undefined, held: [] }], 'o2')).toBe('o2');
  });
  it('hint 가 없거나 이미 꺼진 참모면 독 주인으로, 그것도 없으면 null', () => {
    const rows = [{ id: 'o1', own: undefined, held: [a] }];
    expect(paneTarget('project-a', rows)).toBe('o1');
    expect(paneTarget('project-a', rows, 'gone')).toBe('o1');
    expect(paneTarget('docs', rows, 'gone')).toBeNull();
  });
});

describe('사람 차례 카드(시안 A — 칸 아래 작은 카드, 모달 없이)', () => {
  it('없으면 null', () => {
    expect(turnCard(live(), { dialog: null, chooser: null })).toBeNull();
  });
  it('세션이 부름 — 이유 + 한마디 + 다 했어', () => {
    expect(turnCard(live({ ask: { reason: '휴대폰으로 온 6자리를 넣어 줘', at: 5 } }), { dialog: null, chooser: null })).toEqual({ kind: 'ask', text: '휴대폰으로 온 6자리를 넣어 줘' });
  });
  it('페이지 대화상자가 가장 먼저 — 그동안 페이지가 굳어 있다', () => {
    const c = turnCard(live({ ask: { reason: 'x', at: 5 } }), { dialog: { type: 'confirm', message: '삭제할까요?' }, chooser: null });
    expect(c).toEqual({ kind: 'dialog', text: '삭제할까요?', prompt: false });
  });
  it('파일 고르기 — 앱 창에 붙는 시트가 뜨는 동안', () => {
    expect(turnCard(live(), { dialog: null, chooser: 'multiple' })?.kind).toBe('file');
  });
  it('패스키 — 재서명 사본(signable)은 맥 암호 앱 패스키를 못 써서 휴대폰 QR·보안 키로 안내, 크롬 창은 꺼내서', () => {
    const c = turnCard(live({ popup: true, popupKind: 'passkey' }), { dialog: null, chooser: null }, { signable: true, signed: false });
    expect(c?.kind).toBe('passkey');
    expect(c?.text).toMatch(/QR/);
    expect(turnCard(live({ popup: true, popupKind: 'window' }), { dialog: null, chooser: null })?.kind).toBe('window');
  });
  // 2026-10-29 — 구글 서명 크롬으로 바꿔 둔 동안엔 맥 암호 앱 패스키가 된다(uvpa=true 실측). '이 크롬에선 안 돼'는 틀린 말이었다
  it('패스키 — 구글 크롬으로 바꿔 둔 동안엔 Touch ID·암호 앱으로 안내', () => {
    const c = turnCard(live({ popup: true, popupKind: 'passkey' }), { dialog: null, chooser: null }, { signable: true, signed: true, auto: true });
    expect(c?.kind).toBe('passkey');
    expect(c?.text).toMatch(/Touch ID/);
    expect(c?.text).not.toMatch(/안 돼/);
  });
  // 끄는 스위치(CHAMMO_BROWSER_ACCESSORY=0)의 구글 서명 사본(signable 아님)은 처음부터 Touch ID·암호 앱이 된다
  it('패스키 — 서명 사본(signable 아님) 크롬이면 Touch ID·암호 앱으로 안내', () => {
    const c = turnCard(live({ popup: true, popupKind: 'passkey' }), { dialog: null, chooser: null }, { signable: false, signed: false });
    expect(c?.text).toMatch(/Touch ID/);
    expect(c?.text).not.toMatch(/안 돼/);
  });
});

// 10-29 fix/dock-hide-back — 서랍 '참모 브라우저'(지킴이)도 재서명 사본이면 signable 을 적는다. 같이 쓰는 손님이 있어 못 바꾸면 QR 안내가 맞다(전엔 signable 이 없어 'Touch ID 됨'으로 틀렸다)
describe('서랍 지킴이 사본', () => {
  it('바꿀 수 있는 사본(signable)이 아직 안 바뀌었으면 QR·보안 키, 바뀌었으면 Touch ID', () => {
    const pk = live({ popup: true, popupKind: 'passkey' });
    expect(turnCard(pk, { dialog: null, chooser: null }, { signable: true, signed: false })?.text).toMatch(/QR/);
    expect(turnCard(pk, { dialog: null, chooser: null }, { signable: true, signed: true, auto: true })?.text).toMatch(/Touch ID/);
  });
});

describe('패스키 자동(2026-10-29) — 래퍼가 패스키를 보고 스스로 구글 크롬으로 바꿨으면 칸에 한 줄과 돌아오기', () => {
  it('자동이면 까닭을, 사람이 고른 것이면 지금 상태를, 아니면 없음', () => {
    expect(signedLine({ signable: true, signed: true, auto: true })).toMatch(/패스키 때문에 크롬 창에서 열었어/);
    expect(signedLine({ signable: true, signed: true })).toMatch(/구글 크롬/);
    expect(signedLine({ signable: true, signed: false, auto: false })).toBeNull();
    expect(signedLine(undefined)).toBeNull(); // 윈도우
  });
});

describe('브라우저 끄기(10-28 사용자 "아예 닫는 게 너무 어렵다")', () => {
  it('마지막 탭 X — 세션이 쓰는 브라우저면 한 줄 확인, 사람 혼자 쓰는 참모 브라우저면 바로', () => {
    expect(closeWay(live(), 1)).toBe('confirm');
    expect(closeWay(live({ sessionPid: 0 }), 1)).toBe('close');
    expect(closeWay(live(), 2)).toBe('tab');
    expect(closeWay(live(), 0)).toBe('confirm'); // 탭 목록을 아직 모름 = 마지막
  });
  it('독 X = 브라우저 끄기 확인 — 세션·참모가 쓰는 중이면 누가 쓰는지와 끊긴다는 말, 사람이 연 거면 닫을지만', () => {
    expect(closeAsk({ name: 'shop-app', live: live() })).toEqual({ title: 'shop-app이(가) 사용 중이에요', body: '닫으면 하던 브라우저 일이 끊겨요' });
    expect(closeAsk({ name: '모모-2 · 앱 고치기', live: live({ sessionPid: 7 }) }).title).toBe('모모-2 · 앱 고치기가 사용 중이에요'); // 받침 없음
    expect(closeAsk({ name: '고객사D 담당', live: live() }).title).toBe('고객사D 담당이 사용 중이에요');
    expect(closeAsk({ name: '참모-2', live: live({ sessionPid: 0, scripts: 1 }) }).title).toBe('참모-2이(가) 사용 중이에요'); // 같이 쓰는 스크립트도 쓰는 중
    expect(closeAsk({ name: '참모-2', live: live({ sessionPid: 0 }) })).toEqual({ title: '브라우저를 닫을까요?' });
  });
  it('끈 브라우저는 래퍼가 알아채기 전에도 탭 줄에서 바로 뺀다 — 같은 크롬(pid)일 동안만', () => {
    const closed = { 'shop-app': 10 };
    expect(stillClosed(closed, live())).toBe(true);
    expect(stillClosed(closed, live({ pid: 11 }))).toBe(false); // 세션이 다시 띄움
    expect(stillClosed({}, live())).toBe(false);
  });
  it('보던 브라우저가 사라졌을 때만 칸을 닫는다 — 처음부터 없던 건(목록을 아직 못 읽음) 그대로', () => {
    expect(wentAway(true, false)).toBe(true);
    expect(wentAway(false, false)).toBe(false);
    expect(wentAway(true, true)).toBe(false);
  });
});

// 2026-10-28 — 칸을 누르면 저절로 개입이 켜지는데 돌려주는 길이 상태줄에 없었고, 사람 차례 띠와 아래 줄이 같은 걸 두 번('사람 차례 — undefined') 말했다
describe('칸 아래 상태줄 — 차례 표시는 띠 하나, 사람이 쥐면 늘 돌려주기', () => {
  it('사람이 쥐면(개입) 누가 쥐었나 한 줄 + 돌려주기', () => {
    const s = paneStatus(live({ takeover: { by: 'desktop', at: 1 }, gate: true, held: 5, tool: '누름 x' }));
    expect(s.giveBack).toBe(true);
    expect(s.text).toContain('사람이 조작 중');
  });
  it('세션이 부른 동안엔 띠(카드)가 차례를 말한다 — 아래 줄은 되풀이 않고 돌려주기는 띠의 다 했어', () => {
    const s = paneStatus(live({ ask: { reason: '6자리 넣어 줘', at: 5 }, takeover: { by: 'desktop', at: 1 }, tool: '화면 읽기' }));
    expect(s).toEqual({ text: '', giveBack: false });
  });
  it('세션이 쓰는 중이면 하는 일 한 줄만', () => {
    expect(paneStatus(live({ tool: '이동 https://a.com' }))).toEqual({ text: '이동 https://a.com', giveBack: false });
  });
  it('이유가 빈 부름도 undefined 를 안 찍는다', () => {
    const c = turnCard(live({ ask: { at: 5 } as unknown as { reason: string; at: number } }), { dialog: null, chooser: null });
    expect(c?.kind).toBe('ask');
    expect(c?.text).not.toContain('undefined');
  });
});

// 2026-10-29 사용자 — 서랍 '참모 브라우저'(사람이 연 것, sessionPid 0)가 모든 참모 탭 줄에 뜨고, 보던 참모 이름으로 '참모 업데이트 브라우저 · 직접 조작 중'
// HQ 참모들은 같은 폴더라 프로필 하나를 나눠 쓴다 — 아이콘은 쥔 세션 기준 한 곳에만
describe('hqBrowserHome — 참모들이 나눠 쓰는 HQ 프로필 브라우저를 둘 참모 하나', () => {
  const hq = (o: Partial<Live> = {}) => live({ profile: 'my-hq', sessionPid: 0, ...o });
  const rows = (own: Record<string, Live | undefined> = {}) => ['a', 'b', 'c'].map((id) => ({ id, own: own[id], held: [] as (Live | undefined)[] }));

  it('사람이 서랍에서 연 것(sessionPid 0) — 누른 참모 한 곳에 내가 연 것', () => {
    expect(hqBrowserHome(hq(), rows(), 'b')).toEqual({ id: 'b', who: 'me' });
  });
  it('누른 참모를 모르면(앱 다시 켬·그 참모 꺼짐) 첫 참모 한 곳 — 모든 참모에 뿌리지 않는다', () => {
    expect(hqBrowserHome(hq(), rows())).toEqual({ id: 'a', who: 'me' });
    expect(hqBrowserHome(hq(), rows(), 'gone')).toEqual({ id: 'a', who: 'me' });
  });
  it('쥔 세션이 참모 자신이면 그 참모 독이 이미 그린다 — 여기선 없음(대체로 다른 참모에 또 붙이지 않게)', () => {
    const l = hq({ sessionPid: 77 });
    expect(hqBrowserHome(l, rows({ c: l }), 'b')).toBeNull();
  });
  it('쥔 세션이 맡긴 세션이어도 그 참모 몫', () => {
    const l = hq({ sessionPid: 77 });
    expect(hqBrowserHome(l, [{ id: 'a', held: [] }, { id: 'b', held: [undefined, l] }], 'a')).toBeNull();
  });
  it('어느 참모 것도 아닌 세션이 쥐면 누른 참모 기억을 쓰지 않고 첫 참모 한 곳에 주인 모름', () => {
    expect(hqBrowserHome(hq({ sessionPid: 77 }), rows(), 'b')).toEqual({ id: 'a', who: 'unknown' });
  });
  it('브라우저가 없거나 참모가 없으면 없음', () => {
    expect(hqBrowserHome(undefined, rows(), 'a')).toBeNull();
    expect(hqBrowserHome(hq(), [], 'a')).toBeNull();
  });
  it('이름표는 보는 참모 이름을 달지 않는다 — 내가 연 것(나 배지)·주인 모름(? 배지)', () => {
    const [me] = browserDock({ name: '참모 업데이트', live: hq({ takeover: { by: 'desktop', at: 1 } }), who: 'me' }, []);
    expect(me!.letter).toBe('나');
    expect(dockTitleOf(me!)).toBe('참모 브라우저 · 내가 연 것 · 주문 — shop-app · 직접 조작 중');
    expect(closeAsk(me!)).toEqual({ title: '브라우저를 닫을까요?' }); // 사람 것 — 세션이 쓴다고 겁주지 않는다
    const [un] = browserDock({ name: '참모 업데이트', live: hq({ sessionPid: 77 }), who: 'unknown' }, []);
    expect(un!.letter).toBe('?');
    expect(dockTitleOf(un!)).toBe('참모 브라우저 · 주인 모름 · 주문 — shop-app');
    expect(closeAsk(un!).title).toBe('참모가 사용 중이에요');
    for (const x of [me!, un!]) expect([dockTitleOf(x), closeAsk(x).title].join()).not.toContain('참모 업데이트');
  });
});

// 2026-10-30 사용자 — 구글 크롬으로 바꾼 뒤 Touch ID 시트가 숨은 크롬 창에 붙어 칸에서 안 보였다. 래퍼가 패스키 때문에 바꾼 동안(auto)엔
// 사람이 칸을 만지지 않았어도 모달처럼 크롬 창을 작게 꺼낸다. 사람이 고른 구글 크롬·안 바꾼 사본은 지금처럼 단추만
describe('패스키로 바꾼 구글 크롬 — 시트 꺼내기', () => {
  it('래퍼가 패스키 때문에 바꾼 동안만 저절로 꺼낸다', () => {
    expect(signedAutoPeek({ signable: true, signed: true, auto: true })).toBe(true);
    expect(signedAutoPeek({ signable: true, signed: true })).toBe(false);
    expect(signedAutoPeek({ signable: true, signed: false, auto: true })).toBe(false);
    expect(signedAutoPeek(undefined)).toBe(false);
  });
  // 10-30 실측(pk-test, webauthn.io) — 서명 크롬 패스키 창은 크롬 pid 의 448x300 창('문제가 발생했습니다')으로 가짜 화면 위 가려진 창 안 위 83 에 떠서
  // 이름으로 패스키라고 못 가르고 '크롬 창'(window)으로 잡혔다. 바꾼 까닭이 패스키라 종류와 상관없이 꺼내고 띠도 패스키로
  it('실측 모양 — 가려진 크롬 창(window 종류)도 사람 손 없이 꺼낸다, 사람이 고른 구글 크롬은 안 꺼낸다', () => {
    const at = { popup: true, shown: false, peeked: null, failed: false, url: 'https://accounts.google.com/v3/signin/challenge/pk' };
    expect(peekStep({ ...at, active: signedAutoPeek({ signable: true, signed: true, auto: true }) })).toBe('peek');
    expect(peekStep({ ...at, active: signedAutoPeek({ signable: true, signed: true }) })).toBeNull();
    const c = turnCard(live({ popup: true, popupKind: 'window' }), { dialog: null, chooser: null }, { signable: true, signed: true, auto: true });
    expect(c).toEqual({ kind: 'passkey', text: '패스키 — 크롬 창에서 Touch ID' });
    expect(turnCard(live({ popup: true, popupKind: 'window' }), { dialog: null, chooser: null }, { signable: true, signed: true })?.kind).toBe('window');
  });
  it('띠 한 줄은 크롬 창에서 Touch ID', () => {
    const c = turnCard(live({ popup: true, popupKind: 'passkey' }), { dialog: null, chooser: null }, { signable: true, signed: true, auto: true });
    expect(c?.text).toBe('패스키 — 크롬 창에서 Touch ID');
  });
});
