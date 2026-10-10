import { describe, expect, it } from 'vitest';
import { askName, closedText, controlOf, takeoverLine, browserBig, browserScreen, currentSite, EMPTY_MS, frameTrouble, GONE_MS, UNSURE_MS, liveOf, paneStatus, phoneTrouble, siteOf, tabStrip, unpackFrame, type Live, stuckLine, permLine, fedcmChoices, fedcmLine, focusFailLine, peekStep } from './agentBrowser';

const live = (o: Partial<Live> = {}): Live => ({ profile: 'acme', pid: 11, sessionPid: 22, url: 'https://a.com/', title: 'A', tabs: [], tool: '이동 https://a.com/', toolAt: 1000, busy: false, ts: 1000, ...o });

describe('liveOf — 세션 ↔ 세션 브라우저(래퍼의 부모 = 세션 프로세스)', () => {
  it('procPid 가 sessionPid 와 같은 것', () => {
    const ls = [live({ profile: 'a', sessionPid: 1 }), live({ profile: 'b', sessionPid: 2 })];
    expect(liveOf({ procPid: 2 }, ls)?.profile).toBe('b');
    expect(liveOf({ procPid: 3 }, ls)).toBeUndefined();
    expect(liveOf({}, ls)).toBeUndefined();
  });
});

describe('browserBig — 브라우저 일 중이면 크게, 끝나면 터미널이 다시 커진다', () => {
  it('도구가 돌고 있으면 크게', () => expect(browserBig(live({ busy: true, toolAt: 0 }), 0, 999_999)).toBe(true));
  it('마지막 도구 호출이나 화면 변화가 45초 안이면 크게', () => {
    expect(browserBig(live({ toolAt: 100_000 }), 0, 140_000)).toBe(true);
    expect(browserBig(live({ toolAt: 0 }), 130_000, 140_000)).toBe(true);
  });
  it('둘 다 45초 넘게 조용하면 작게', () => expect(browserBig(live({ toolAt: 10_000 }), 20_000, 120_000)).toBe(false));
  it('브라우저가 없으면 작게', () => expect(browserBig(undefined, 0, 0)).toBe(false));
});

describe('tabStrip — 열린 탭 띠(지금 보여 주는 탭 표시, 제목 없으면 호스트)', () => {
  it('CDP 탭 순서대로', () => {
    const pages = [{ id: 'x', url: 'https://a.com/login', title: '' }, { id: 'y', url: 'about:blank', title: '' }, { id: 'z', url: 'https://b.com/', title: 'B 사이트' }];
    expect(tabStrip(pages, 'z')).toEqual([
      { id: 'x', label: 'a.com', url: 'https://a.com/login', active: false, dialog: false },
      { id: 'y', label: '새 탭', url: 'about:blank', active: false, dialog: false },
      { id: 'z', label: 'B 사이트', url: 'https://b.com/', active: true, dialog: false },
    ]);
  });
});

describe('unpackFrame — [순번 8바이트 LE][jpeg]', () => {
  it('순번과 그림을 나눈다', () => {
    const b = new Uint8Array([2, 1, 0, 0, 0, 0, 0, 0, 0xff, 0xd8]);
    const f = unpackFrame(b.buffer)!;
    expect(f.seq).toBe(258);
    expect([...f.jpeg]).toEqual([0xff, 0xd8]);
  });
  it('비었으면 새 프레임 없음', () => expect(unpackFrame(new ArrayBuffer(0))).toBeNull());
});

describe('B2 — 사람 필요는 닫아도 남는다', () => {
  const ask = { reason: '로그인', at: 1 };
  it('사람을 기다리는 동안은 조용해도 브라우저가 크게(작은 띠로 안 접힌다)', () => {
    expect(browserBig(live({ ask, toolAt: 0 }), 0, 999_999)).toBe(true);
  });
  it('세션 칸 상태는 \'일하는 중\' 대신 사람 필요', () => {
    expect(paneStatus('run', live({ ask }))).toBe('human');
    expect(paneStatus('wait', live({ ask }))).toBe('human');
    expect(paneStatus('run', live())).toBe('run');
    expect(paneStatus('run', undefined)).toBe('run');
    expect(paneStatus('done', live({ ask }))).toBe('done'); // 끝난 세션의 남은 상태 파일
  });
});

describe('B3 — 모달 머리의 사이트는 진짜 주소(CDP 탭 url)에서, 페이지가 못 속이게', () => {
  it('https 는 호스트만, 안전', () => expect(siteOf('https://accounts.google.com/signin?x=1')).toEqual({ host: 'accounts.google.com', secure: true }));
  it('http 는 안전하지 않음', () => expect(siteOf('http://a.com/login')).toEqual({ host: 'a.com', secure: false }));
  it('포트도 보인다', () => expect(siteOf('https://a.com:8443/')?.host).toBe('a.com:8443'));
  it('사용자 정보로 속이기(google.com@evil.com)는 진짜 호스트', () => expect(siteOf('https://google.com@evil.com/')?.host).toBe('evil.com'));
  it('닮은 글자(키릴 а) 도메인은 퓨니코드로', () => expect(siteOf('https://аpple.com/')?.host).toMatch(/^xn--/));
  it('대소문자·끝 점은 주소 그대로 표준화', () => expect(siteOf('https://ACCOUNTS.Google.com/')?.host).toBe('accounts.google.com'));
  it('data·about·file 은 호스트 대신 그 종류(가짜 로그인 페이지를 data: 로 띄워도 보인다)', () => {
    expect(siteOf('data:text/html,<form>')).toEqual({ host: 'data:', secure: false });
    expect(siteOf('about:blank')).toEqual({ host: 'about:blank', secure: false });
    expect(siteOf('file:///Users/x/a.html')).toEqual({ host: 'file:', secure: false });
  });
  it('blob 은 만든 사이트', () => expect(siteOf('blob:https://a.com/1234-5678')).toEqual({ host: 'a.com', secure: true }));
  it('모르는 주소·없음은 null(화면에 \'주소 확인 중\')', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf(null)).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});

describe('B3 — 어느 세션 브라우저인지', () => {
  const ss = [{ procPid: 20, name: 'qa-web-1', cwd: '/Users/x/dev/demo-a' }, { procPid: 30, name: '', cwd: '/Users/x/dev/demo-b/' }, { procPid: 40, name: 'demo-c', cwd: '/Users/x/dev/demo-c' }];
  it('프로젝트 · 세션 이름', () => expect(askName(live({ sessionPid: 20 }), ss)).toBe('demo-a · qa-web-1'));
  it('이름이 없거나 프로젝트와 같으면 프로젝트만', () => {
    expect(askName(live({ sessionPid: 30 }), ss)).toBe('demo-b');
    expect(askName(live({ sessionPid: 40 }), ss)).toBe('demo-c');
  });
  it('세션을 못 찾으면 브라우저 프로필', () => expect(askName(live({ sessionPid: 99 }), ss)).toBe('acme'));
});

describe('경계 — 머리 주소는 입력이 가는 탭(current)을 따른다', () => {
  const pages = [{ id: 'main', url: 'https://shop.com/cart', title: '쇼핑' }, { id: 'pop', url: 'about:blank', title: '' }];
  it('사이트가 띄운 팝업으로 넘어가면 팝업 주소 — 처음엔 about:blank', () => {
    expect(currentSite(pages, 'pop')).toEqual({ host: 'about:blank', secure: false });
  });
  it('팝업이 결제·로그인 사이트로 이동하면 그 호스트', () => {
    expect(currentSite([pages[0]!, { id: 'pop', url: 'https://pay.example.com/auth', title: '쇼핑 로그인' }], 'pop')?.host).toBe('pay.example.com');
  });
  it('페이지 제목이 \'Google 로그인\'이어도 주소로만', () => {
    expect(currentSite([{ id: 'x', url: 'http://g00gle-login.test/', title: 'Google 로그인' }], 'x')).toEqual({ host: 'g00gle-login.test', secure: false });
  });
  it('지금 탭을 아직 모르거나(붙는 중) 닫혔으면 null', () => {
    expect(currentSite(pages, null)).toBeNull();
    expect(currentSite(pages, 'closed')).toBeNull();
    expect(currentSite([], 'main')).toBeNull();
  });
});

describe('B6 — 대화상자가 떠 있는 탭은 띠에 표시(다른 탭을 보는 동안에도 어디서 기다리는지)', () => {
  it('dialogTabs 에 든 탭만', () => {
    const pages = [{ id: 'a', url: 'https://a.com/', title: 'A' }, { id: 'b', url: 'https://b.com/', title: 'B' }];
    const t = tabStrip(pages, 'b', ['a']);
    expect(t.map((x) => x.dialog)).toEqual([true, false]);
    expect(tabStrip(pages, 'b').every((x) => !x.dialog)).toBe(true);
  });
});

describe('frameTrouble — 화면 받기 실패 이유(Rust 일꾼 error)를 사람이 알 말로(2026-10-05 QA 5: 이유 없이 "화면 받는 중"에 멈춤)', () => {
  it('이유가 없으면 없음', () => {
    expect(frameTrouble('')).toBeNull();
    expect(frameTrouble(undefined)).toBeNull();
  });
  it('연결 거절·상태 파일 없음·끊김은 브라우저가 꺼진 것', () => {
    expect(frameTrouble('Connection refused (os error 61)')).toBe('off');
    expect(frameTrouble('no live browser')).toBe('off');
    expect(frameTrouble('IO error: Connection reset by peer (os error 54)')).toBe('off');
    expect(frameTrouble('Trying to work with closed connection')).toBe('off');
  });
  it('그 밖은 못 받음(이유는 툴팁에)', () => {
    expect(frameTrouble('HTTP error: 404 Not Found')).toBe('fail');
  });
});

describe('2026-10-05 사용자 실사용 — 닫힌 브라우저의 마지막 화면을 진짜 화면으로 착각했다(사진 위를 눌러도 안 먹음)', () => {
  const base = { goneMs: 0, error: '', attached: true, pages: 1, emptyMs: 0, current: true, unsureMs: 0 };
  it('평소 — 그대로, 입력 받음', () => {
    expect(browserScreen(base)).toEqual({ kind: 'ok', why: '', blocked: false });
  });
  it('목록에서 빠짐(래퍼가 크롬이 꺼진 걸 보고 숨김) — 닫힘, 입력 막음', () => {
    expect(browserScreen({ ...base, goneMs: GONE_MS, attached: false, pages: 0, current: false, unsureMs: 60_000 })).toMatchObject({ kind: 'closed', blocked: true });
  });
  it('포트에 못 붙음(연결 거절) — 화면이 있어도 닫힘. 예전엔 화면이 있으면 이유를 안 그렸다', () => {
    expect(browserScreen({ ...base, error: 'Connection refused (os error 61)', attached: false, pages: 0, current: false })).toMatchObject({ kind: 'closed', blocked: true });
  });
  it('크롬은 살았는데 탭이 0개(맥 크롬은 마지막 창을 닫아도 프로세스·포트가 남는다) — 닫힘. 예전엔 오류 없이 \'주소 확인 중\'만', () => {
    expect(browserScreen({ ...base, pages: 0, emptyMs: EMPTY_MS, current: false, unsureMs: EMPTY_MS })).toMatchObject({ kind: 'closed', blocked: true });
  });
  it('그 밖의 실패 — 화면 못 받음, 입력 막음', () => {
    expect(browserScreen({ ...base, error: 'Target.getTargets: no answer', attached: false, current: false })).toMatchObject({ kind: 'fail', blocked: true });
  });
  it('경계 — 탭 이동 중 잠깐 지금 탭을 모름: 막지 않는다(친 건 Rust 가 버리고 띠로 알린다)', () => {
    expect(browserScreen({ ...base, current: false, unsureMs: UNSURE_MS - 1 })).toMatchObject({ kind: 'checking', why: '', blocked: false });
  });
  it('경계 — 막 붙는 중(일꾼이 아직 탭 목록 전): 잠깐은 기다림', () => {
    expect(browserScreen({ ...base, attached: false, pages: 0, current: false, unsureMs: 100 })).toMatchObject({ kind: 'checking', blocked: false });
  });
  it('\'주소 확인 중\'이 몇 초 넘게 이어지면 이유를 보이고 막는다 — 붙는 중', () => {
    const r = browserScreen({ ...base, attached: false, pages: 0, current: false, unsureMs: UNSURE_MS });
    expect(r.kind).toBe('checking');
    expect(r.why).not.toBe('');
    expect(r.blocked).toBe(true);
  });
  it('\'주소 확인 중\'이 몇 초 넘게 — 탭은 있는데 지금 탭을 못 정함', () => {
    const r = browserScreen({ ...base, current: false, unsureMs: UNSURE_MS + 5000 });
    expect(r).toMatchObject({ kind: 'checking', blocked: true });
    expect(r.why).not.toBe(browserScreen({ ...base, attached: false, pages: 0, current: false, unsureMs: UNSURE_MS }).why);
  });
  it('목록에서 빠진 게 먼저 — 오류·탭보다 앞선다', () => {
    expect(browserScreen({ ...base, goneMs: GONE_MS }).kind).toBe('closed');
  });
  // 리뷰 — 바쁜 맥에서 포트 확인이 한 번 늦거나(목록에서 한 틱 빠짐), 탭 닫기·새로 열기가 겹쳐 잠깐 0개면 덮개가 깜빡이며 입력을 막았다
  it('경계 — 목록에서 한 틱(1.5초) 빠진 건 닫힘이 아니다: 입력도 그대로(Rust 는 상태 파일로 보낸다)', () => {
    expect(browserScreen({ ...base, goneMs: GONE_MS - 1 })).toMatchObject({ kind: 'ok', blocked: false });
    expect(GONE_MS).toBeGreaterThan(1500);
  });
  it('경계 — 탭이 잠깐 0개(세션이 탭을 바꾸며 닫고 열기·꺼낸 창 닫힘 뒤 빈 탭 다시 열기)는 닫힘이 아니다', () => {
    expect(browserScreen({ ...base, pages: 0, emptyMs: EMPTY_MS - 1, current: false, unsureMs: EMPTY_MS - 1 })).toMatchObject({ kind: 'checking', blocked: false });
  });
});

describe('사람 개입(2026-10-06 사용자) — 평소 보기만, 개입·부름 동안만 조작', () => {
  const base: Live = { profile: 'p', pid: 1, sessionPid: 2, url: '', title: '', tabs: [], tool: '', toolAt: 0, busy: false, ts: 0 };
  it('controlOf — 부름이면 ask, 개입이면 mine, 아니면 view', () => {
    expect(controlOf(undefined)).toBe('view');
    expect(controlOf(base)).toBe('view');
    expect(controlOf({ ...base, takeover: { by: 'desktop', at: 1 } })).toBe('mine');
    expect(controlOf({ ...base, ask: { reason: 'r', at: 1 }, takeover: { by: 'desktop', at: 1 } })).toBe('ask');
  });
  it('takeoverLine — 누가·세션이 기다리나·멈추지 못하는 브라우저', () => {
    expect(takeoverLine(base)).toBeNull();
    const t = { ...base, gate: true, takeover: { by: 'desktop' as const, at: 1 } };
    expect(takeoverLine(t)).toMatch(/사람이 조작 중/);
    expect(takeoverLine({ ...t, held: 5 })).toMatch(/세션은 기다리는 중/);
    expect(takeoverLine({ ...t, takeover: { by: 'phone', at: 1 } })).toMatch(/폰에서/);
    expect(takeoverLine({ ...t, gate: false })).toMatch(/멈추지 못/);
  });
  it('takeoverLine — 같이 쓰는 스크립트(chammo-browser launch)는 래퍼를 안 거쳐 못 멈춘다고 알린다(roadmap 부채 browser-takeover ①)', () => {
    const t = { ...base, gate: true, takeover: { by: 'desktop' as const, at: 1 } };
    expect(takeoverLine({ ...t, scripts: 0 })).not.toMatch(/스크립트/);
    const two = takeoverLine({ ...t, held: 5, scripts: 2 })!;
    expect(two).toMatch(/세션은 기다리는 중/);
    expect(two).toMatch(/스크립트 2개.*멈추지 못/);
    // 스크립트 크롬(지킴이 상태 파일, gate 없음)도 같이 쓰는 수를
    expect(takeoverLine({ ...t, gate: false, scripts: 1 })).toMatch(/스크립트 1개/);
  });
});

describe('closedText — 닫힘 덮개 한 줄(맥 모달·폰 같은 글)', () => {
  it('옆 줄(화면을 못 받았어)과 같은 반말 — 예전엔 \'닫혔어요 … 이어져\' 로 섞였다', () => {
    expect(closedText()).toBe('브라우저가 닫혔어 — 세션이 다시 열면 이어져');
    expect(phoneTrouble(undefined, 'no such browser', 0)?.text).toBe(closedText());
  });
});

describe('phoneTrouble — 폰 브라우저 보기가 화면을 못 받는 이유 한 줄(2026-10-09, 이유 없이 \'화면 받는 중\'에 멈춤)', () => {
  it('괜찮으면 null — 일꾼이 아직 없거나 붙어서 탭이 있으면', () => {
    expect(phoneTrouble(undefined, '', 0)).toBeNull();
    expect(phoneTrouble({ error: '', attached: false, pages: 0 }, '', 0)).toBeNull(); // 붙는 중
    expect(phoneTrouble({ error: '', attached: true, pages: 2 }, '', 0)).toBeNull();
  });
  it('크롬이 꺼졌으면(포트 거절·끊김) 닫혔다고', () => {
    const t = phoneTrouble({ error: 'WebSocket connect …: Connection refused (os error 61)', attached: false, pages: 0 }, '', 0)!;
    expect(t.kind).toBe('closed');
    expect(t.text).toMatch(/닫혔/);
  });
  it('붙었는데 탭 0개가 이어지면 닫힘, 잠깐이면 아직 아니다', () => {
    expect(phoneTrouble({ error: '', attached: true, pages: 0 }, '', EMPTY_MS - 1)).toBeNull();
    expect(phoneTrouble({ error: '', attached: true, pages: 0 }, '', EMPTY_MS)!.kind).toBe('closed');
  });
  it('그 밖의 실패는 못 받았다 + 맥이 준 이유', () => {
    const t = phoneTrouble({ error: 'Page.startScreencast: no answer', attached: true, pages: 1 }, '', 0)!;
    expect(t.kind).toBe('fail');
    expect(t.text).toMatch(/못 받았/);
    expect(t.text).toContain('Page.startScreencast: no answer');
  });
  it('폰이 프레임을 못 받은 것 — 목록에서 빠졌으면 닫힘, 그 밖은 그 이유로', () => {
    expect(phoneTrouble(undefined, 'no such browser', 0)!.kind).toBe('closed');
    const t = phoneTrouble({ error: '', attached: true, pages: 1 }, 'Load failed', 0)!;
    expect(t.kind).toBe('fail');
    expect(t.text).toContain('Load failed');
  });
});

describe('stuckLine — 앱이 붙기 전에 뜬 대화상자는 래퍼에 답을 부탁한다(roadmap 부채 browser-dialog ①)', () => {
  it('부탁 전엔 원래 안내, 부탁 뒤엔 답하는 중, 래퍼가 못 풀면 그렇다고', () => {
    expect(stuckLine(null, null)).toMatch(/멈춰 있어/);
    expect(stuckLine(100, null)).toMatch(/답하는 중/);
    expect(stuckLine(100, { at: 50, ok: false, error: 'x' })).toMatch(/답하는 중/); // 지난 결과는 안 본다
    expect(stuckLine(100, { at: 150, ok: false, error: 'No dialog visible' })).toMatch(/못 풀었어/);
    expect(stuckLine(100, { at: 150, ok: true, error: '' })).toMatch(/답했어/);
  });
});

describe('permLine — 숨긴 크롬의 위치·알림 말풍선 대신 모달에서 묻는다(roadmap 부채 agent-browser-modal ②)', () => {
  it('사이트 호스트와 무엇을 묻는지', () => {
    expect(permLine({ kind: 'geolocation', origin: 'https://map.example.com:8443' })).toBe('map.example.com:8443 이(가) 위치를 쓰려고 해');
    expect(permLine({ kind: 'notifications', origin: 'https://a.com' })).toBe('a.com 이(가) 알림을 보내려고 해');
  });
});

describe('fedcmChoices — 구글 등 \'…로 계속\' 계정 고르기는 크롬 자체 창이라 그림에 안 찍혀 모달 단추로(2026-10-10)', () => {
  it('계정 고르기는 계정마다 이메일 단추 + 닫기', () => {
    const f = { dialogId: 'd1', type: 'AccountChooser', title: 'idp.example 계정으로 shop.example 에 로그인', accounts: [{ email: 'a@x.com', name: 'A' }, { email: 'b@x.com', name: 'B' }] };
    expect(fedcmChoices(f)).toEqual([{ label: 'a@x.com', account: 0 }, { label: 'b@x.com', account: 1 }, { label: '닫기', account: null }]);
    expect(fedcmLine(f)).toBe('idp.example 계정으로 shop.example 에 로그인');
  });
  it('이메일이 없으면 이름, 확인 창은 계속, 모르는 창은 닫기만', () => {
    expect(fedcmChoices({ dialogId: 'd', type: 'AccountChooser', title: '', accounts: [{ email: '', name: 'Kim' }] })[0]).toEqual({ label: 'Kim', account: 0 });
    expect(fedcmChoices({ dialogId: 'd', type: 'ConfirmIdpLogin', title: '', accounts: [] })).toEqual([{ label: '계속', account: 0 }, { label: '닫기', account: null }]);
    expect(fedcmChoices({ dialogId: 'd', type: 'Error', title: '', accounts: [] })).toEqual([{ label: '닫기', account: null }]);
    expect(fedcmLine({ dialogId: 'd', type: 'AccountChooser', title: '', accounts: [] })).toBe('사이트가 계정으로 로그인하려고 해');
  });
});

describe('focusFailLine — 크롬에서 보기가 실패하면 모달에 한 줄(2026-10-10 눌러도 아무 일 없이 조용했다)', () => {
  it('브라우저가 없으면 꺼졌다고', () => {
    expect(focusFailLine('no live browser')).toBe('브라우저가 꺼져 있어서 크롬 창을 못 꺼냈어');
    expect(focusFailLine('chrome not found')).toBe('브라우저가 꺼져 있어서 크롬 창을 못 꺼냈어');
  });
  it('창이 화면에 안 나왔으면 다시 눌러 보라고', () => {
    expect(focusFailLine('1 window(s) still off screen')).toBe('크롬 창을 화면으로 못 옮겼어 — 한 번 더 눌러 줘');
  });
  it('그 밖은 이유를 짧게 붙인다(주소는 빼고)', () => {
    const l = focusFailLine(new Error('WebSocket connect ws://127.0.0.1:9333/devtools/browser/AB: Connection refused'));
    expect(l.startsWith('크롬 창을 못 꺼냈어 — ')).toBe(true);
    expect(l).not.toContain('127.0.0.1');
    expect(focusFailLine('x'.repeat(300)).length).toBeLessThanOrEqual(100);
  });
});

describe('peekStep — 패스키 창이 뜨면 사람이 쓰는 중일 때만 크롬을 작게 꺼내고, 끝나면 되돌린다(2026-10-10 사용자)', () => {
  const base = { popup: true, shown: false, peeked: null, failed: false, active: true, url: 'https://login.example.com/' };
  it('사람이 쓰는 중이고 패스키 창이 뜨면 꺼낸다', () => {
    expect(peekStep(base)).toBe('peek');
  });
  it('사람이 안 쓰는 중이면(세션 혼자 돌다 뜸) 안 꺼낸다 — 알림·카드 몫', () => {
    expect(peekStep({ ...base, active: false })).toBeNull();
  });
  it('이미 꺼내 뒀거나(크롬에서 보기) 한 번 실패했으면 다시 안 부른다', () => {
    expect(peekStep({ ...base, shown: true })).toBeNull();
    expect(peekStep({ ...base, failed: true })).toBeNull();
  });
  it('꺼낸 뒤 창이 사라지거나 페이지가 넘어가면 되돌린다', () => {
    const peeked = { url: base.url };
    expect(peekStep({ ...base, shown: true, peeked })).toBeNull();
    expect(peekStep({ ...base, shown: true, peeked, popup: false })).toBe('unpeek');
    expect(peekStep({ ...base, shown: true, peeked, url: 'https://console.example.com/' })).toBe('unpeek');
    expect(peekStep({ ...base, shown: true, peeked, active: false })).toBeNull();
  });
  it('모달이 막 열려 지금 탭 주소를 아직 모르면 기다린다 — 모른 채 꺼냈다가 주소가 오자 넘어간 줄 알고 숨겼다(하네스 실측)', () => {
    expect(peekStep({ ...base, url: undefined })).toBeNull();
  });
  it('사람이 그 창을 직접 숨겼으면(shown 꺼짐) 더 할 일 없다', () => {
    expect(peekStep({ ...base, shown: false, peeked: { url: base.url }, popup: false })).toBe('unpeek');
  });
});
