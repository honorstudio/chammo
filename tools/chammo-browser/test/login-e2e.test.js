// 사이트 로그인 E2E — 가짜 로그인 사이트(로컬 http)에 진짜 크롬(헤드리스·임시 데이터 폴더)으로. 진짜 사이트·계정 없음.
// 크롬이 있는 맥에서만: CHAMMO_LOGIN_E2E=1 node --test test/login-e2e.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');

const ON = process.env.CHAMMO_LOGIN_E2E === '1';
const ID = 'e2e-user@example.test';
const PW = 'Zq9!e2e pw "x"';
// 켰을 때만 임시 폴더를 만들고 끝나면 지운다 — 건너뛰는 실행이 빈 폴더를 남기지 않게
const tmp = ON ? fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-login-')) : '';
if (ON) {
  process.env.CHAMMO_HOME = tmp; // launch 가 부르는 CLI 도 이 폴더만 쓴다
  process.env.CHAMMO_BROWSER_HOME = path.join(tmp, 'browser');
}
const L = require('../src/login');

const seen = { posts: [], stay: [], ipsec: [], verified: false };
const page = (body, script = '') => `<!doctype html><meta charset=utf-8><body>${body}<script>${script}</script></body>`;
const FORM = (extra = '') => `<form method=post action=/login><input name=id placeholder=아이디><input type=password name=pw>
  <input type=checkbox id=loginStay name=stay style="display:none"><label for=loginStay>로그인 상태 유지</label>
  <input type=checkbox id=ipsec name=ipsec checked><label for=ipsec>IP보안</label>${extra}<button>로그인</button></form>`;
let server;
let base;

function body(req) {
  return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(new URLSearchParams(b))); });
}

before(async () => {
  if (!ON) return;
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (html) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
    const go = (to) => { res.writeHead(302, { location: to }); res.end(); };
    if (u.pathname === '/plain' || u.pathname === '/otp' || u.pathname === '/wrong' || u.pathname === '/slow') return send(page(FORM(`<input type=hidden name=next value=${u.pathname}>`)));
    if (u.pathname === '/login' && req.method === 'POST') {
      const f = await body(req);
      seen.posts.push({ id: f.get('id') === ID, pw: f.get('pw') === PW });
      seen.stay.push(f.get('stay') === 'on');
      seen.ipsec.push(f.get('ipsec') === 'on');
      const next = f.get('next');
      if (next === '/wrong' || f.get('pw') !== PW) return send(page(`<p>비밀번호가 일치하지 않습니다</p>${FORM('<input type=hidden name=next value=/wrong>')}`));
      if (next === '/otp') return go('/otp-code');
      // 보낸 뒤 0.8초 빈 화면(로딩) → 2단계 칸 — '됨'으로 일찍 판정하면 안 된다
      if (next === '/slow') return send(page('<div id=w></div>', "setTimeout(() => { w.innerHTML = '<input autocomplete=one-time-code>'; }, 800)"));
      return go('/home');
    }
    // 두 단계(이메일 → 다음 → 비밀번호)
    if (u.pathname === '/two') return send(page('<form method=post action=/two-next><input type=email name=identifier autocomplete=username><button>다음</button></form>'));
    if (u.pathname === '/two-next') {
      const f = await body(req);
      seen.posts.push({ id: f.get('identifier') === ID });
      return send(page('<form method=post action=/login><input type=password name=pw autocomplete=current-password><button>다음</button></form>'));
    }
    if (u.pathname === '/otp-code') {
      return send(page('<p>2단계 인증 — 문자로 받은 코드를 넣어 주세요</p><input autocomplete=one-time-code name=code>',
        "setInterval(() => fetch('/state').then((r) => r.text()).then((t) => { if (t === 'ok') location = '/home'; }), 300)"));
    }
    // 폼 없이 JS 로만 도는 '로그인' 단추 — Enter 로는 안 넘어간다
    if (u.pathname === '/btn') {
      return send(page('<div><input name=id placeholder=아이디><input type=password name=pw><button type=button id=b>로그인</button></div>',
        "b.onclick = () => fetch('/login', { method: 'POST', body: new URLSearchParams({ id: document.querySelector('[name=id]').value, pw: document.querySelector('[name=pw]').value }) }).then((r) => { location = r.url; })"));
    }
    // 다른 사이트(localhost ≠ 127.0.0.1)의 로그인 칸으로 넘긴다 — 프롬프트 주입·열린 리다이렉트 흉내
    if (u.pathname === '/hop') return go(`http://localhost:${server.address().port}/plain`);
    if (u.pathname === '/state') return send(seen.verified ? 'ok' : 'no');
    if (u.pathname === '/home') return send(page('<h1>환영합니다</h1>'));
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) server.close();
  // 쓴 크롬이 다 닫히길 잠깐 — 남은 지킴이가 없게
  await new Promise((r) => setTimeout(r, 1500));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function accountDir(md) {
  const d = fs.mkdtempSync(path.join(tmp, 'acct-'));
  fs.writeFileSync(path.join(d, 'CLAUDE.local.md'), md);
  return d;
}
// 칸에 로그인 주소 줄 — 제목(테스트몰)만으론 127.0.0.1 사이트인지 모른다(사이트 확인, 0.4.5 리뷰 보안 1)
const MD = () => `## 테스트몰 계정\n- 아이디: \`${ID}\`\n- 비밀번호: \`${PW}\`\n- 로그인 주소: ${base}/\n`;
const outs = [];
async function run(args, extra = {}) {
  const lines = [];
  const r = await L.runLogin(L.parseArgs(args), { typeDelay: 5, log: (s) => lines.push(s), out: (s) => lines.push(s), headless: true, ...extra });
  const text = lines.join('\n');
  outs.push(text);
  return { ...r, text };
}

/** 가짜 direct — 받은 인자를 적고, 사람이 누른 것처럼 상태를 '답함'으로 */
function fakeDirect(onAsk) {
  const log = path.join(tmp, `direct-${Date.now()}.log`);
  const f = path.join(tmp, `direct-${Date.now()}.js`);
  fs.writeFileSync(f, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === 'ask') { console.log('ab12cd34'); process.exit(0); }
if (a[0] === 'status') { const n = fs.readFileSync(${JSON.stringify(log)}, 'utf8').split('\\n').filter((l) => l.includes('"status"')).length;
  console.log(n >= 2 ? 'ab12cd34 · login\\n상태: 답함 — 다 했어 (19:00)' : 'ab12cd34 · login\\n상태: 기다림'); process.exit(0); }
process.exit(0);
`, { mode: 0o755 });
  return { file: f, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []), onAsk };
}

test('아이디·비밀번호 칸 한 화면 — 파일에서 읽어 넣고, 로그인 유지는 켜고, IP 보안은 끈다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const r = await run(['e2e-a', `${base}/plain`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(seen.posts.at(-1), { id: true, pw: true });
  assert.equal(seen.stay.at(-1), true, '로그인 상태 유지');
  assert.equal(seen.ipsec.at(-1), false, 'IP 보안은 꺼서 보낸다');
  assert.match(r.text, /로그인 됐어/);
});

test('두 단계(이메일 → 다음 → 비밀번호)', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const n = seen.posts.length;
  const r = await run(['e2e-b', `${base}/two`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md'), '--done', '/home']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(seen.posts.slice(n), [{ id: true }, { id: false, pw: true }]);
});

test('Enter 로 안 넘어가는 화면 — 로그인 단추를 누른다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const n = seen.posts.length;
  const r = await run(['e2e-i', `${base}/btn`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md'), '--done', '/home']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(seen.posts.slice(n), [{ id: true, pw: true }], '한 번만 보냈다');
});

test('비밀번호가 틀리면 한 번만 보내고 멈춘다(잠김 막기)', { skip: !ON }, async () => {
  const cwd = accountDir(`## 테스트몰\n- 아이디: ${ID}\n- 비밀번호: not-the-pw\n- 로그인 주소: ${base}/\n`);
  const n = seen.posts.length;
  const r = await run(['e2e-c', `${base}/wrong`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 5, r.text);
  assert.equal(seen.posts.length - n, 1, '다시 치지 않는다');
});

test('로그인 주소가 다른 사이트로 넘어가면 아이디·비밀번호를 안 친다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const n = seen.posts.length;
  const r = await run(['e2e-j', `${base}/hop`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 5, r.text);
  assert.match(r.text, /localhost/);
  assert.equal(seen.posts.length, n, '아무것도 안 보냈다');
});

test('칸의 사이트가 아닌 주소로 부르면 크롬도 안 연다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const r = await run(['e2e-k', `http://localhost:${server.address().port}/plain`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 5, r.text);
  assert.match(r.text, /다른 사이트/);
});

test('계정 칸이 없으면 4 — 사람에게 넘길 말', { skip: !ON }, async () => {
  const cwd = accountDir('## 다른 것\n- 아이디: x\n');
  const r = await run(['e2e-d', `${base}/plain`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 4, r.text);
  assert.match(r.text, /칸/);
});

test('커밋되는 파일의 계정은 안 쓴다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const g = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  g('init', '-q');
  g('add', 'CLAUDE.local.md');
  const r = await run(['e2e-e', `${base}/plain`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
  assert.equal(r.code, 4, r.text);
  assert.match(r.text, /커밋/);
});

test('2단계 화면(혼자 띄운 크롬) — direct 카드를 띄우고 사람이 끝낼 때까지 기다렸다 이어 간다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const d = fakeDirect();
  // 카드가 뜬 뒤 사람이 폰에서 승인한 셈
  const human = setInterval(() => { if (d.calls().some((c) => c[0] === 'ask')) seen.verified = true; }, 300);
  const r = await run(['e2e-f', `${base}/otp`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md'), '--wait', '60'], { direct: d.file, pollMs: 700 });
  clearInterval(human);
  seen.verified = false;
  assert.equal(r.code, 0, r.text);
  const calls = d.calls();
  assert.equal(calls[0][0], 'ask');
  assert.ok(calls[0].includes('--kind') && calls[0][calls[0].indexOf('--kind') + 1] === 'login', JSON.stringify(calls[0]));
  assert.ok(calls.some((c) => c[0] === 'done'), '끝나면 카드를 처리됨으로');
  assert.ok(!JSON.stringify(calls).includes(PW) && !JSON.stringify(calls).includes(ID), '카드에 계정 값 없음');
});

test('보낸 뒤 잠깐 빈 화면이어도 끝으로 안 친다', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const d = fakeDirect();
  const r = await run(['e2e-h', `${base}/slow`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md'), '--wait', '1'], { direct: d.file, pollMs: 300 });
  assert.equal(r.code, 3, r.text);
  assert.equal(d.calls()[0][0], 'ask', '2단계 칸을 보고 카드를 띄웠다');
});

test('2단계 화면(세션 브라우저와 같이 쓰는 크롬) — 탭을 두고 3 + browser_ask_human 안내', { skip: !ON }, async () => {
  const cwd = accountDir(MD());
  const cli = path.join(__dirname, '..', 'bin', 'chammo-browser.js');
  // 세션 브라우저 도구 대신 다른 주인이 먼저 크롬을 쥐고 있는 셈
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  try {
    const l = spawnSync(process.execPath, [cli, 'launch', 'e2e-g', '--owner', String(holder.pid), '--headless'], { encoding: 'utf8', env: process.env, timeout: 60000 });
    const ws = JSON.parse(l.stdout.trim().split('\n').at(-1)).wsEndpoint;
    assert.ok(ws, l.stderr);
    const r = await run(['e2e-g', `${base}/otp`, '--account', '테스트몰', '--from', path.join(cwd, 'CLAUDE.local.md')]);
    assert.equal(r.code, 3, r.text);
    assert.match(r.text, /browser_ask_human/);
    // 탭은 그대로 2단계 화면
    const port = new URL(ws).port;
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    assert.ok(tabs.some((t) => t.type === 'page' && t.url.endsWith('/otp-code')), JSON.stringify(tabs.map((t) => t.url)));
  } finally {
    holder.kill();
  }
});

test('계정 값이 출력·데이터 폴더 어디에도 안 남는다', { skip: !ON }, async () => {
  const all = outs.join('\n');
  assert.ok(outs.length >= 5);
  assert.ok(!all.includes(PW) && !all.includes(ID), '출력에 계정 값');
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('acct-')) walk(p); continue; }
      try { if (fs.readFileSync(p, 'latin1').includes(PW)) hits.push(p); } catch { /* 소켓 등 */ }
    }
  };
  walk(tmp);
  assert.deepEqual(hits, [], '래퍼·지킴이 기록에 비밀번호');
});
