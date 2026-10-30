// 사이트 로그인 — `chammo-browser login <프로필> <로그인 주소>` (2026-10-29 다른 기기 참모가 사이트 로그인을 "못 한다"며 사람에게 넘겼다).
// 계정은 그 프로젝트의 gitignore 된 CLAUDE.local.md 칸(제목에 사이트 이름 + '아이디:'·'비밀번호:' 줄)에서 이 스크립트가 읽어
// 그 프로필 크롬(세션 브라우저와 같은 크롬)에 CDP 로 친다 — 모델이 비밀번호를 도구 인자로 넘기거나 대화에 적지 않는다.
// 값은 메모리에만: 출력·오류 글은 가려서 내보내고, 화면 캡처·기록 파일을 안 남긴다.
// 2단계 인증·패스키·캡차는 사람 몫 — 세션 브라우저와 같이 쓰는 크롬이면 탭을 두고 3(세션이 browser_ask_human),
// 혼자 띄운 크롬이면 direct 카드(--kind login)를 띄우고 사람이 [다 했어]를 누를 때까지 크롬을 쥔 채 기다린다.
// 비밀번호를 한 번 보냈는데 여전히 로그인 칸이면 다시 치지 않는다(계정 잠김 막기).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CODE = { done: 0, error: 1, human: 3, noAccount: 4, refused: 5 };

/** login 인자 → { profile, url, account, from, waitSec, done } */
function parseArgs(argv) {
  const o = { profile: null, url: null, account: null, from: null, waitSec: 600, done: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s, 2) : [argv[i], undefined];
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--account') o.account = val();
    else if (flag === '--from') o.from = val();
    else if (flag === '--done') o.done = val();
    else if (flag === '--wait') {
      const v = val();
      if (!/^\d{1,5}$/.test(String(v))) throw new Error(`--wait 는 초(숫자): ${v}`);
      o.waitSec = Number(v);
    } else if (flag.startsWith('--')) throw new Error(`모르는 옵션: ${flag}`);
    else if (!o.profile) o.profile = flag;
    else if (!o.url) o.url = flag;
    else throw new Error(`인자가 너무 많아요: ${flag}`);
  }
  if (!o.profile || !o.url) throw new Error('로그인 주소가 필요해요: chammo-browser login <프로필> <로그인 주소> [--account <칸 이름>]');
  if (!/^https?:\/\//i.test(o.url)) throw new Error(`로그인 주소는 http(s) 로: ${o.url}`);
  return o;
}

// ── 사이트 가르기(0.4.5 리뷰 보안 1) — 저장된 비밀번호는 칸의 사이트와 등록 도메인이 같은 곳에만 친다.
//    등록 도메인 = 공개 접미사 바로 위 한 칸(nid.naver.com·www.naver.com → naver.com) — 서브도메인끼리는 같은 사이트, 다른 도메인은 남.
//    공개 접미사 목록(PSL)을 통째로 싣지 않아서, 목록에 없는 2단 접미사(com.ai 모양)는 못 가린다고 보고 거절한다(닫는 쪽) ──

/** 둘째 칸까지가 접미사인 것 — 등록 도메인이 한 칸 더 길다 */
const SUFFIX2 = new Set(['co.kr', 'or.kr', 'go.kr', 'ne.kr', 're.kr', 'pe.kr', 'ac.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr', 'kg.kr', 'mil.kr',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'com.br', 'com.cn', 'com.tw', 'com.hk', 'com.sg', 'co.in', 'com.mx', 'co.id', 'com.vn', 'co.th', 'com.tr', 'co.za',
  // 남이 하위 이름을 받아 쓰는 호스팅 — a.github.io 와 b.github.io 는 다른 사람
  'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'appspot.com',
  'azurewebsites.net', 'cloudfront.net', 'blogspot.com', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'onrender.com', 'fly.dev', 'supabase.co']);
const GENERIC = /^(com|net|org|co|or|ne|go|ac|edu|gov|mil|re|pe|ltd|plc|sch|nhs|gob|gouv|nic)$/;

/** 호스트의 등록 도메인 — IP·localhost 는 호스트 그대로, 못 가리면 null */
function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  if (/^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.')) return h;
  const parts = h.split('.');
  const n = SUFFIX2.has(parts.slice(-2).join('.')) ? 3 : 2;
  if (parts.length < n) return null;
  const site = parts.slice(-n);
  if (n === 2 && GENERIC.test(site[0])) return null;
  return site.join('.');
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

/** 주소의 본 이름 — nid.example.com → example, www.example.co.kr → example (칸 제목 기본 찾기 말). 못 가리면 '' */
function siteKey(url) {
  const s = siteOf(hostOf(url));
  if (!s) return '';
  return /^[\d.]+$/.test(s) || s.includes(':') || !s.includes('.') ? s : s.split('.')[0];
}

/** 낱말 비교용 — 글자·숫자 밖은 띄어 쓰고 양끝에 칸 하나 */
const words = (s) => ` ${String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** 제목에 이름이 낱말째 들었나 — 'ab' 는 'Gitlab' 에 안 든다 */
const named = (heading, name) => { const w = words(name).trim(); return !!w && words(heading).includes(` ${w} `); };

const ID_KEY = /^(아이디|계정|이메일|id|user ?name|username|user|login|email|e-mail)$/i;
const PW_KEY = /^(비밀번호|비번|패스워드|password|passwd|pw|pass)$/i;
const URL_KEY = /^(로그인 ?주소|주소|url|login ?url)$/i;

/** CLAUDE.local.md 글 → 제목에 names 중 하나가 낱말째 든 첫 칸의 { heading, id, pw, url } (아이디·비밀번호가 다 있는 칸만), 없으면 null */
function findAccount(md, names) {
  const want = names.filter(Boolean);
  const lines = String(md || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!h || !want.some((n) => named(h[2], n))) continue;
    const got = { heading: h[2], id: null, pw: null, url: null };
    for (let j = i + 1; j < lines.length; j++) {
      const n = /^(#{1,6})\s/.exec(lines[j]);
      if (n && n[1].length <= h[1].length) break;
      const m = /^\s*(?:[-*+]\s+)?(?:\*\*)?([^:：=*`]+?)(?:\*\*)?\s*[:：=]\s*(?:\*\*)?\s*(.+?)\s*$/.exec(lines[j]);
      if (!m) continue;
      const key = m[1].trim();
      const v = m[2].replace(/^`(.*)`$/, '$1').trim();
      if (!v) continue;
      if (!got.id && ID_KEY.test(key)) got.id = v;
      else if (!got.pw && PW_KEY.test(key)) got.pw = v;
      else if (!got.url && URL_KEY.test(key) && /^https?:\/\//.test(v)) got.url = v;
    }
    if (got.id && got.pw) return got;
  }
  return null;
}

/** 이 칸 계정을 이 주소에 쳐도 되나 — 칸의 '로그인 주소' 와 등록 도메인이 같을 때, 주소 줄이 없으면 제목 낱말이 그 사이트 이름(naver)·도메인(naver.com)일 때만.
 *  → { site } | { why } */
function siteCheck(acc, url) {
  const host = hostOf(url);
  const site = siteOf(host);
  if (!site) return { why: `${host || url} 는 어느 사이트인지 못 가려서 계정을 안 쳐` };
  if (acc.url) {
    const own = siteOf(hostOf(acc.url));
    return own === site ? { site } : { why: `칸 '${acc.heading}' 의 로그인 주소(${own || '?'})와 ${host} 는 다른 사이트야 — 계정을 안 쳤어` };
  }
  if (named(acc.heading, siteKey(url)) || named(acc.heading, site)) return { site };
  return { why: `칸 '${acc.heading}' 에 로그인 주소 줄이 없고 제목에 이 사이트 이름(${siteKey(url)})도 없어 — 계정을 안 쳤어. 사람에게 그 칸에 '- 로그인 주소: https://${host}/…' 한 줄을 넣어 달라고 해` };
}

const HUMAN_TEXT = /2단계|2-?step|two-?step|2fa|verification code|인증 ?(번호|코드)|보안 ?코드|security code|승인해 주세요|기기에서 승인|approve (the )?sign|check your phone|휴대폰에서|passkey|패스키|보안 ?키|security key|captcha|자동 ?입력 ?방지|로봇이 아닙니다|not a robot|verify (it'?s|that) you/i;
const WRONG_TEXT = /(비밀번호|아이디|계정)[^.\n]{0,20}(잘못|일치하지|틀렸|확인해|올바르지)|wrong password|incorrect|invalid (password|credentials|username)|couldn'?t find your/i;

/** 화면 상태 → 'human'(사람 차례) | 'wrong'(틀렸다는 글 + 아직 비밀번호 칸) | 'form'(아직 로그인 칸) | 'done' */
function classify(s, doneRe = null) {
  if (s.otp || s.captcha) return 'human';
  if (s.pw && WRONG_TEXT.test(s.text || '')) return 'wrong';
  // 로그인 칸이 보이면 글은 안 본다 — 로그인 화면에도 '패스키로 로그인'·'2단계 인증 안내' 같은 링크 글이 있다
  if (s.pw || s.user) return 'form';
  if (HUMAN_TEXT.test(s.text || '')) return 'human';
  if (doneRe && !doneRe.test(s.url || '')) return 'form';
  return 'done';
}

/** 계정 값 가리개 — 그대로·URL 인코딩·JSON 이스케이프·+ 모양까지. 3글자 미만은 안 가린다 */
function redactor(values) {
  const forms = new Set();
  for (const v of values.filter((x) => typeof x === 'string' && x.length >= 3)) {
    for (const f of [v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1), v.replace(/ /g, '+'), encodeURIComponent(v).replace(/%20/g, '+')]) forms.add(f);
  }
  const list = [...forms].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = list.length ? new RegExp(list.join('|'), 'g') : null;
  return (text) => (re ? String(text).replace(re, '●●●●') : String(text));
}

/** 출력에 쓸 주소 — 물음표·# 뒤(토큰이 들 수 있다)는 뺀다 */
function pageLine(u) {
  try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return ''; }
}

// 화면을 읽고 칠 칸에 표를 단다(data-chammo-login) — 값은 안 읽어 온다. 본 프레임만(iframe 안 로그인 칸은 못 다룬다)
const PROBE = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !e.disabled && !e.readOnly; };
  for (const e of document.querySelectorAll('[data-chammo-login]')) e.removeAttribute('data-chammo-login');
  const all = [...document.querySelectorAll('input')];
  const shown = all.filter(vis);
  const hint = (e) => [e.name, e.id, e.getAttribute('aria-label'), e.placeholder, e.autocomplete].join(' ');
  const pw = shown.find((e) => e.type === 'password');
  const texty = (e) => ['text', 'email', 'tel', ''].includes(e.getAttribute('type') ? e.type : '');
  const otp = shown.some((e) => texty(e) && (/one-time-code/.test(e.autocomplete) || /otp|totp|one.?time|verif|2fa|mfa|passcode|smscode|auth.?code|인증/i.test(hint(e))));
  const named = (e) => /username|email/.test(e.autocomplete) || e.type === 'email' || /(^|[^a-z])(id|user|login|email|identifier|account|userid|loginid|mb_id)([^a-z]|$)|아이디|이메일/i.test(hint(e));
  let user = shown.find((e) => texty(e) && named(e) && !/search|query|검색/i.test(hint(e)));
  if (!user && pw) user = shown.filter((e) => texty(e) && (e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING)).pop();
  if (pw) pw.setAttribute('data-chammo-login', 'pw');
  if (user && !otp) user.setAttribute('data-chammo-login', 'user');
  const label = (e) => ((e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || (e.parentElement && e.parentElement.innerText) || '').slice(0, 60);
  let ipOn = false;
  for (const c of all.filter((e) => e.type === 'checkbox')) {
    const t = label(c);
    if (/ip ?보안|ip ?security|ip ?보호/i.test(t)) { if (c.checked) { c.setAttribute('data-chammo-login', 'ipoff'); ipOn = true; } }
    else if (!c.checked && /로그인 ?상태 ?유지|로그인 ?유지|자동 ?로그인|remember me|keep me (signed|logged) in|stay signed in/i.test(t)) c.setAttribute('data-chammo-login', 'stay');
  }
  // Enter 로 안 넘어가는 화면(제출 단추 없는 폼·JS 로만 도는 단추)용 — 칸이 든 폼의 제출 단추, 없으면 이름이 '로그인'·'다음' 인 보이는 단추
  const field = pw || user;
  const btns = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(vis);
  const own = field && field.form ? btns.find((e) => e.form === field.form && (e.type === 'submit' || e.tagName === 'BUTTON' && !e.getAttribute('type'))) : null;
  const go = own || btns.find((e) => /^(로그인|다음|계속|확인|log ?in|sign ?in|next|continue)$/i.test((e.innerText || e.value || '').trim()));
  if (go) go.setAttribute('data-chammo-login', 'submit');
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="arkoselabs"], .g-recaptcha, .h-captcha, .cf-turnstile');
  return { url: location.href, pw: !!pw, user: !!(user && !otp), otp, captcha, ipOn, text: (document.body ? document.body.innerText : '').slice(0, 4000) };
}`;

/** 계정 파일 — --from, 아니면 지금 폴더부터 위로 세 칸까지 CLAUDE.local.md */
function accountFile(from, cwd) {
  if (from) return path.resolve(cwd, from);
  let d = cwd;
  for (let i = 0; i < 4; i++) {
    const f = path.join(d, 'CLAUDE.local.md');
    if (fs.existsSync(f)) return f;
    if (path.dirname(d) === d) break;
    d = path.dirname(d);
  }
  return path.join(cwd, 'CLAUDE.local.md');
}

/** git 이 이 파일을 커밋해 두고 있나 — 그러면 계정을 두면 안 되는 자리다 */
function tracked(file) {
  const r = spawnSync('git', ['-C', path.dirname(file), 'ls-files', '--error-unmatch', path.basename(file)], { stdio: 'ignore', timeout: 5000, windowsHide: true });
  return r.status === 0;
}

/** direct 위치 — CHAMMO_DIRECT, 아니면 <데이터 폴더>/config.json 의 hqDir/scripts/direct */
function directPath(env, dataDir) {
  if (env.CHAMMO_DIRECT) return env.CHAMMO_DIRECT;
  try {
    const hq = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).hqDir;
    const f = hq && path.join(hq, 'scripts', 'direct');
    return f && fs.existsSync(f) ? f : null;
  } catch { return null; }
}

/** 화면이 바뀌었나 볼 표 — 주소·칸이 그대로면 같은 화면 */
const sig = (s) => (s ? [s.url, s.pw, s.user, s.otp, s.captcha, s.text.length].join('|') : '');

const ASK_LINE = (host) => `${host} 로그인에 사람 차례(2단계 인증·패스키·캡차)가 나왔어 — 탭은 그대로 뒀어. browser_ask_human 을 불러(reason: "${host} 로그인 2단계 인증을 해 줘 — 폰 승인·문자 코드·패스키·캡차"), 끝나면 이 명령을 한 번 더 돌려 확인해. 사람에게 비밀번호를 치게 하지 마`;

/**
 * 본체. deps: { launch, env, cwd, direct, pollMs, typeDelay, headless, log(stderr 줄), out(stdout 줄) } — 테스트가 갈아 끼운다
 * → { code, state }
 */
async function runLogin(o, deps = {}) {
  const env = deps.env || process.env;
  const cwd = deps.cwd || process.cwd();
  const say = deps.out || ((s) => process.stdout.write(s + '\n'));
  const warn = deps.log || ((s) => process.stderr.write(s + '\n'));
  const host = hostOf(o.url) || o.url;
  const file = accountFile(o.from, cwd);
  const names = [o.account, siteKey(o.url)];
  let lastUrl = '';
  const finish = (code, state, line, hide = (x) => x) => {
    say(hide(line));
    say(JSON.stringify({ ok: code === 0, state, account: names.filter(Boolean)[0], page: hide(pageLine(lastUrl)) }));
    return { code, state };
  };
  if (fs.existsSync(file) && tracked(file)) return finish(CODE.noAccount, 'tracked', `${file} 는 git 이 커밋하는 파일이야 — 계정을 거기 두면 안 된다. gitignore 된 CLAUDE.local.md 로 옮기라고 사람에게 알려(값은 대화에 적지 말고)`);
  let md = '';
  try { md = fs.readFileSync(file, 'utf8'); } catch { /* 없음 */ }
  const acc = findAccount(md, names);
  if (!acc) {
    return finish(CODE.noAccount, 'no-account', `${file} 에 '${names.filter(Boolean).join("' / '")}' 이름이 든 제목 아래 '아이디:'·'비밀번호:' 두 줄이 있는 칸이 없어. ` +
      '사람에게 그 칸을 채워 달라고 하거나(채팅에 비밀번호를 받지 말고 그 파일에 직접), 이번 한 번 직접 로그인해 달라고 해(browser_ask_human) — 로그인은 프로필에 남는다');
  }
  const hide = redactor([acc.pw, acc.id]);
  // 칸의 사이트가 아니면 크롬도 안 연다 — 프롬프트 주입된 세션이 남의 주소로 불러도 비밀번호가 안 나간다
  const { site, why } = siteCheck(acc, o.url);
  if (!site) return finish(CODE.refused, 'other-site', why, hide);
  const launch = deps.launch || require('./connect').launch;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let b;
  try {
    b = await launch(o.profile, { headless: !!deps.headless });
  } catch (e) {
    return finish(e.code === 2 ? 2 : CODE.error, 'browser', `브라우저를 못 받았어: ${e.message}`, hide);
  }
  const doneRe = o.done ? new RegExp(o.done.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;
  try {
    // 같이 쓰는 크롬이면 세션이 보던 탭에서(release 가 내가 연 탭을 닫으니 사람 차례 화면이 남게), 아니면 새 탭
    const open = b.shared ? b.context.pages().filter((p) => !p.isClosed()) : [];
    const page = open.find((p) => { try { return new URL(p.url()).hostname === host; } catch { return false; } }) || open[0] || (await b.context.newPage());
    const probe = async () => {
      const s = await page.evaluate(`(${PROBE})()`).catch(() => null);
      if (s) lastUrl = s.url;
      return s;
    };
    const settle = async (before, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await sleep(400);
        const s = await probe();
        if (s && sig(s) !== sig(before)) { await page.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(300); return probe(); }
      }
      return probe();
    };
    const typeInto = async (mark, value) => {
      // 치기 직전 — 리다이렉트·스크립트로 다른 사이트에 와 있으면 안 친다
      const now = hostOf(page.url());
      if (siteOf(now) !== site) throw Object.assign(new Error('other-site'), { otherSite: now || '?' });
      const loc = page.locator(`[data-chammo-login=${mark}]`).first();
      await loc.click({ timeout: 5000 });
      await loc.fill('');
      await page.keyboard.type(value, { delay: deps.typeDelay ?? 70 });
    };
    const clickLabel = (mark) => page.locator(`[data-chammo-login=${mark}]`).first().evaluate((el) => ((el.labels && el.labels[0]) || el).click()).catch(() => {});
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 칸이 늦게 그려지는 화면 — 5초까지 칸을 기다린다
    let s = await probe();
    for (let t = 0; t < 10 && s && !s.pw && !s.user && classify(s, doneRe) !== 'human'; t++) { await sleep(500); s = await probe(); }
    let sentPw = 0;
    let sentUser = 0;
    for (let round = 0; round < 6 && s; round++) {
      let v = classify(s, doneRe);
      // 보낸 뒤 칸이 잠깐 사라진 것(로딩·화면 바꾸는 중)일 수 있다 — 1.5초 뒤 한 번 더 보고 확정
      if (v === 'done' && round > 0) {
        await sleep(1500);
        s = (await probe()) || s;
        v = classify(s, doneRe);
      }
      if (v === 'done') return finish(CODE.done, round === 0 ? 'already' : 'done', round === 0 ? `이미 로그인돼 있어(${host})` : `로그인 됐어(${host}) — 프로필에 남는다`, hide);
      if (v === 'wrong' || (v === 'form' && s.pw && sentPw)) {
        return finish(CODE.refused, 'refused', `${host} 가 로그인을 안 받았어 — 비밀번호를 한 번 보냈고 다시 치지 않았다(잠김 막기). 칸의 계정이 맞는지 사람에게 한 줄로 알려`, hide);
      }
      if (v === 'human') break;
      if (s.ipOn) await clickLabel('ipoff');
      if (s.pw) {
        if (s.user) await typeInto('user', acc.id);
        await clickLabel('stay');
        // 보내기 직전 IP 보안이 꺼졌나 다시 본다 — 못 끄면 보내지 않는다(다른 기기·회선의 로그인이 깨진다)
        const chk = await probe();
        if (chk && chk.ipOn) return finish(CODE.refused, 'ip-security', `${host} 의 IP 보안 칸을 못 꺼서 보내지 않았어`, hide);
        await typeInto('pw', acc.pw);
        sentPw += 1;
      } else if (s.user) {
        if (sentUser >= 2) break;
        await typeInto('user', acc.id);
        sentUser += 1;
      } else break;
      await page.keyboard.press('Enter');
      const was = s;
      s = await settle(was, 6000);
      if (s && sig(s) === sig(was) && (await page.locator('[data-chammo-login=submit]').count())) {
        await page.locator('[data-chammo-login=submit]').first().click({ timeout: 5000 }).catch(() => {});
        s = await settle(was);
      }
      if (s && sig(s) === sig(was)) return finish(CODE.error, 'stuck', `${host} 에서 Enter·로그인 단추를 눌러도 화면이 그대로야 — browser_snapshot 으로 보고 단추를 직접 눌러(비밀번호는 다시 이 명령으로)`, hide);
    }
    if (!s) return finish(CODE.error, 'page', `${host} 화면을 못 읽었어`, hide);
    if (classify(s, doneRe) === 'done') return finish(CODE.done, 'done', `로그인 됐어(${host}) — 프로필에 남는다`, hide);
    if (classify(s, doneRe) !== 'human') return finish(CODE.error, 'stuck', `${host} 로그인 화면을 끝까지 못 넘겼어 — browser_snapshot 으로 화면을 보고 이어서 해(비밀번호는 다시 이 명령으로)`, hide);
    // 사람 차례
    if (b.shared) return finish(CODE.human, 'human', ASK_LINE(host), hide);
    const direct = deps.direct || directPath(env, require('./paths').dataDir());
    if (!direct) return finish(CODE.human, 'human', `${host} 로그인에 사람 차례(2단계 인증·패스키·캡차)가 나왔는데 카드를 띄울 direct 를 못 찾았어 — 세션 브라우저 도구로 그 주소를 연 뒤 이 명령을 다시 돌리면 browser_ask_human 으로 넘길 수 있다`, hide);
    // 윈도우는 확장자 없는 스크립트를 바로 못 띄운다 — direct 머리가 sh 로 읽혀 맞는 파이썬을 고른다
    const dx = (...a) => (process.platform === 'win32' ? spawnSync('sh', [direct, ...a], { encoding: 'utf8', env, timeout: 30000, windowsHide: true })
      : spawnSync(direct, a, { encoding: 'utf8', env, timeout: 30000, windowsHide: true }));
    const ask = dx('ask', `${host} 로그인에 2단계 인증이 필요해 — 폰 승인·문자 코드·패스키·캡차를 마저 해 주고 [다 했어]를 눌러 줘(앱의 세션 브라우저 칸에 그 화면이 있어)`, '--kind', 'login', '--what', `${host} 로그인(계정은 이미 넣었어)`);
    const id = (/\(id ([0-9a-f]{8})\)/.exec(ask.stdout || '') || /\b([0-9a-f]{8})\b/.exec(ask.stdout || '') || [])[1];
    if (!id) return finish(CODE.human, 'human', `카드를 못 띄웠어(direct ask): ${(ask.stderr || ask.stdout || '').trim().slice(0, 200)} — 이 지시를 보낸 세션에 알려`, hide);
    warn(`카드를 띄웠어(${id}) — 사람이 [다 했어]를 누를 때까지 ${o.waitSec}초 크롬을 쥐고 기다린다`);
    const until = Date.now() + o.waitSec * 1000;
    while (Date.now() < until) {
      await sleep(deps.pollMs ?? 2000);
      const st = dx('status', id).stdout || '';
      if (/상태: (답함|처리됨)|State: (answered|done)/.test(st)) {
        // 사람이 끝냈다 — 화면이 넘어가길 잠깐 기다렸다 확인
        for (let t = 0; t < 30; t++) {
          s = (await probe()) || s;
          if (classify(s, doneRe) !== 'human') break;
          await sleep(500);
        }
        const ok = classify(s, doneRe) === 'done';
        dx('done', id, ok ? `${host} 로그인 됐어` : `${host} 아직 로그인 화면`);
        return ok ? finish(CODE.done, 'done', `사람이 2단계를 마쳤고 로그인 됐어(${host})`, hide)
          : finish(CODE.human, 'human', `사람이 [다 했어]를 눌렀는데 아직 ${host} 로그인 화면이야 — browser_snapshot 으로 보고 이어서 해`, hide);
      }
      if (/상태: (거둠|지난 질문)|State: (withdrawn|replaced)/.test(st)) return finish(CODE.human, 'human', `카드가 거둬졌어(${id}) — 다시 하려면 이 명령을 다시`, hide);
    }
    dx('cancel', id);
    return finish(CODE.human, 'timeout', `${o.waitSec}초 동안 사람이 2단계를 안 끝냈어 — 카드는 거뒀다. 다시 하려면 이 명령을 다시(--wait 로 더 길게)`, hide);
  } catch (e) {
    if (e.otherSite) return finish(CODE.refused, 'other-site', `로그인 화면이 ${e.otherSite} 로 넘어갔어 — ${site} 가 아니라서 계정을 안 쳤어`, hide);
    return finish(CODE.error, 'error', `로그인 중 오류: ${e.message}`, hide);
  } finally {
    await b.release().catch(() => {});
  }
}

module.exports = { parseArgs, siteOf, siteKey, siteCheck, findAccount, classify, redactor, pageLine, runLogin, accountFile, CODE, PROBE };
