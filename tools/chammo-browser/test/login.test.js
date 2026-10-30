const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../src/login');

test('login 인자 — 프로필·주소·칸 이름·계정 파일·기다림·끝 주소', () => {
  assert.deepEqual(L.parseArgs(['shop', 'https://example.com/login']), { profile: 'shop', url: 'https://example.com/login', account: null, from: null, waitSec: 600, done: null });
  const a = L.parseArgs(['shop', 'https://example.com/login', '--account', '예시 계정', '--from=/x/CLAUDE.local.md', '--wait', '30', '--done', '/home']);
  assert.deepEqual(a, { profile: 'shop', url: 'https://example.com/login', account: '예시 계정', from: '/x/CLAUDE.local.md', waitSec: 30, done: '/home' });
  assert.throws(() => L.parseArgs(['shop']), /주소/);
  assert.throws(() => L.parseArgs(['shop', 'ftp://x']), /http/);
  assert.throws(() => L.parseArgs(['shop', 'https://x', '--wait', 'z']), /--wait/);
  assert.throws(() => L.parseArgs(['shop', 'https://x', '--pw', 'z']), /모르는/);
});

test('사이트 이름 — 주소의 본 이름', () => {
  assert.equal(L.siteKey('https://nid.example.com/login'), 'example');
  assert.equal(L.siteKey('https://www.example.co.kr/a'), 'example');
  assert.equal(L.siteKey('http://127.0.0.1:8123/login'), '127.0.0.1');
  assert.equal(L.siteKey('http://localhost:8123/login'), 'localhost');
});

const MD = `# 프로젝트 — 로컬 전용

## 예시몰 계정 (거래처용)

* 아이디: \`shop-user\`
* 비밀번호: \`p@ss word!\`
* 등록일: 2026-01-01

### 2단계 인증
문자로 온다.

## 다른 사이트
- **ID**: other
- **Password**：other-secret
- 로그인 주소: https://other.example.org/signin

## 반쪽 칸
- 아이디: half

## 반쪽 칸 두 번째
- 이메일: half2@example.com
- 비번: half-pw
`;

test('계정 칸 읽기 — 제목에 이름이 든 칸의 아이디·비밀번호(모양 여러 가지)', () => {
  assert.deepEqual(L.findAccount(MD, ['예시몰']), { heading: '예시몰 계정 (거래처용)', id: 'shop-user', pw: 'p@ss word!', url: null });
  assert.deepEqual(L.findAccount(MD, ['DIFFERENT', '다른']), { heading: '다른 사이트', id: 'other', pw: 'other-secret', url: 'https://other.example.org/signin' });
  // 비밀번호가 없는 칸은 건너뛰고 다음 맞는 칸
  assert.deepEqual(L.findAccount(MD, ['반쪽']), { heading: '반쪽 칸 두 번째', id: 'half2@example.com', pw: 'half-pw', url: null });
  assert.equal(L.findAccount(MD, ['없는곳']), null);
  assert.equal(L.findAccount('', ['x']), null);
  // 하위 제목(###) 안의 줄도 그 칸, 같은 급 제목에서 끝난다
  assert.equal(L.findAccount('## a\n### b\n- 아이디: i\n- 비밀번호: p\n## c\n', ['a']).pw, 'p');
  assert.equal(L.findAccount('## a\n- 아이디: i\n## c\n- 비밀번호: p\n', ['a']), null);
});

test('화면 판정 — 사람 차례·아직 로그인 칸·끝·틀림', () => {
  const base = { url: 'https://x/login', pw: false, user: false, otp: false, captcha: false, text: '' };
  assert.equal(L.classify({ ...base, otp: true }), 'human');
  assert.equal(L.classify({ ...base, captcha: true, pw: true }), 'human');
  assert.equal(L.classify({ ...base, text: '2단계 인증 — 휴대폰에서 승인해 주세요' }), 'human');
  assert.equal(L.classify({ ...base, text: 'Use your passkey to sign in' }), 'human');
  assert.equal(L.classify({ ...base, text: "I'm not a robot" }), 'human');
  assert.equal(L.classify({ ...base, pw: true, user: true }), 'form');
  assert.equal(L.classify({ ...base, user: true }), 'form');
  assert.equal(L.classify({ ...base, pw: true, text: '비밀번호가 일치하지 않습니다' }), 'wrong');
  assert.equal(L.classify({ ...base, pw: true, text: 'Wrong password. Try again' }), 'wrong');
  assert.equal(L.classify(base), 'done');
  // 끝 주소를 줬으면 그 주소여야 끝
  assert.equal(L.classify({ ...base, url: 'https://x/wait' }, /\/home/), 'form');
  assert.equal(L.classify({ ...base, url: 'https://x/home' }, /\/home/), 'done');
});

test('가리기 — 계정 값은 어떤 모양으로도 출력에 안 남는다', () => {
  const r = L.redactor(['p@ss word!', 'shop-user', 'ab']);
  const out = r('err: typed p@ss word! / p%40ss%20word! / "p@ss word!" shop-user ab');
  assert.ok(!out.includes('p@ss word!') && !out.includes('p%40ss%20word!') && !out.includes('shop-user'), out);
  assert.ok(out.includes('ab'), '너무 짧은 값은 안 가린다');
});

test('주소 줄 — 물음표 뒤(토큰이 들 수 있다)는 안 보인다', () => {
  assert.equal(L.pageLine('https://x.example.com/cb?code=abc#t'), 'https://x.example.com/cb');
  assert.equal(L.pageLine('not a url'), '');
});

// ── 사이트 확인(0.4.5 리뷰 보안 1) — 저장된 비밀번호는 그 칸의 사이트에만 친다 ──

test('등록 도메인 — 서브도메인은 같은 사이트, 못 가리는 접미사는 null', () => {
  assert.equal(L.siteOf('nid.naver.com'), 'naver.com');
  assert.equal(L.siteOf('www.example.co.kr'), 'example.co.kr');
  assert.equal(L.siteOf('naver.evl.io'), 'evl.io', '남의 도메인 앞에 사이트 이름을 붙여도 그 도메인');
  assert.equal(L.siteOf('naver.com.ai'), null, '목록에 없는 2단 접미사(com.ai)는 못 가린다');
  assert.equal(L.siteOf('co.kr'), null);
  assert.equal(L.siteOf('mine.github.io'), 'mine.github.io', '남이 하위 이름을 받는 호스팅은 한 칸 더');
  assert.equal(L.siteOf('127.0.0.1'), '127.0.0.1');
  assert.equal(L.siteOf('localhost'), 'localhost');
  assert.equal(L.siteKey('https://naver.evl.io/login'), 'evl');
  assert.equal(L.siteKey('https://naver.com.ai/login'), '');
});

test('칸 제목은 낱말째 — ab 가 Gitlab 칸을 고르지 않는다', () => {
  assert.equal(L.findAccount('## Gitlab\n- 아이디: i\n- 비밀번호: p\n', ['ab']), null);
  assert.equal(L.findAccount('## Gitlab 계정\n- 아이디: i\n- 비밀번호: p\n', ['gitlab']).pw, 'p');
});

test('칸 ↔ 로그인 주소 — 같은 사이트일 때만', () => {
  const acc = (heading, url = null) => ({ heading, id: 'i', pw: 'p', url });
  assert.equal(L.siteCheck(acc('예시', 'https://nid.naver.com/login'), 'https://www.naver.com/x').site, 'naver.com');
  assert.match(L.siteCheck(acc('예시', 'https://nid.naver.com/login'), 'https://evil.test/login').why, /다른 사이트/);
  assert.match(L.siteCheck(acc('예시', 'https://nid.naver.com/login'), 'https://naver.evl.io/login').why, /다른 사이트/);
  assert.equal(L.siteCheck(acc('네이버 (naver)'), 'https://nid.naver.com/login').site, 'naver.com', '주소 줄이 없으면 제목 낱말이 사이트 이름');
  assert.match(L.siteCheck(acc('예시몰'), 'https://evil.test/login').why, /로그인 주소/, '주소 줄도 이름도 없으면 안 친다');
  assert.match(L.siteCheck(acc('naver'), 'https://naver.com.ai/login').why, /못 가려/);
});

/** 크롬 없이 runLogin — 로그인 칸 화면 하나, Enter 뒤 끝. landOn = 열고 나서 실제 페이지 주소(리다이렉트 흉내) */
function fakeBrowser(landOn) {
  const typed = [];
  let sent = false;
  const launched = [];
  const page = {
    url: () => landOn,
    goto: async () => {},
    evaluate: async () => ({ url: landOn, pw: !sent, user: !sent, otp: false, captcha: false, ipOn: false, text: sent ? '환영' : '' }),
    waitForLoadState: async () => {},
    isClosed: () => false,
    locator: () => ({ first() { return this; }, click: async () => {}, fill: async () => {}, evaluate: async () => {}, count: async () => 0 }),
    keyboard: { type: async (v) => { typed.push(v); }, press: async () => { sent = true; } },
  };
  const launch = async (p) => { launched.push(p); return { shared: false, context: { pages: () => [], newPage: async () => page }, release: async () => {} }; };
  return { typed, launched, launch };
}

async function fakeRun(md, url, landOn) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-login-unit-'));
  fs.writeFileSync(path.join(d, 'CLAUDE.local.md'), md);
  const f = fakeBrowser(landOn);
  const lines = [];
  try {
    const r = await L.runLogin(L.parseArgs(['p', url, '--account', '예시몰']), { launch: f.launch, cwd: d, typeDelay: 0, out: (s) => lines.push(s), log: (s) => lines.push(s) });
    return { ...r, typed: f.typed, launched: f.launched, text: lines.join('\n') };
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

const SHOP = '## 예시몰\n- 아이디: shop-user\n- 비밀번호: shop-secret\n- 로그인 주소: https://login.shop.example/\n';

test('다른 사이트 주소로 부르면 크롬도 안 열고 거절', async () => {
  const r = await fakeRun(SHOP, 'https://evil.test/login', 'https://evil.test/login');
  assert.equal(r.code, L.CODE.refused, r.text);
  assert.deepEqual(r.launched, []);
  assert.deepEqual(r.typed, []);
  assert.ok(!r.text.includes('shop-secret'));
});

test('같은 사이트 주소가 다른 사이트로 넘어가면 치기 직전에 멈춘다', async () => {
  const r = await fakeRun(SHOP, 'https://www.shop.example/login', 'https://evil.test/login');
  assert.equal(r.code, L.CODE.refused, r.text);
  assert.equal(r.state, 'other-site');
  assert.deepEqual(r.typed, [], '아이디도 비밀번호도 안 쳤다');
});

test('같은 사이트(서브도메인)면 친다', async () => {
  const r = await fakeRun(SHOP, 'https://www.shop.example/login', 'https://login.shop.example/form');
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.typed, ['shop-user', 'shop-secret']);
});
