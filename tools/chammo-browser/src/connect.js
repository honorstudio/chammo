// node 스크립트용 한 줄 — chromium.launchPersistentContext 대신 이걸로 크롬을 받는다(락·앱 화면 연결·채널 기억은 chammo-browser 가).
//
//   const { launch } = require(`${process.env.CHAMMO_HOME || `${require('os').homedir()}/.chammo`}/tools/chammo-browser`);
//   const { context, release } = await launch('project-x');          // 로그인 유지된 프로필 크롬
//   const page = await context.newPage();                        // 내 탭은 내가 연다 — 같이 쓰는 스크립트 탭은 건드리지 않는다
//   …
//   await release();                                             // 내 연결만 끊는다. 마지막 사용자면 크롬이 닫힌다
//
// release 는 내가 연 탭을 닫고 연결을 끊는다. 스크립트가 release 없이 끝나거나 죽어도 1초 안에 크롬을 닫고 락을 돌려준다(같이 쓰는 이가
// 없으면). context.close()·browser.close() 는 크롬을 끄지 않고 연결만 끊는다(CDP 로 붙은 브라우저 — 2026-10-06 실측). 옵션: { chromium(내 playwright 의 chromium — 없으면 이 도구 것), channel, headless, view, wait(초) }
const { execFile } = require('child_process');
const { CLI, playwrightCore } = require('./script');

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: process.env, maxBuffer: 1 << 20 }, (err, stdout) => {
      const line = String(stdout || '').trim().split('\n').pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: (err && err.message) || line || 'chammo-browser 가 답하지 않았어요' }); }
    });
  });
}

async function launch(profile, { chromium, channel, headless = false, view = true, wait } = {}) {
  const args = ['launch', profile, '--owner', String(process.pid)];
  if (channel) args.push('--channel', channel);
  if (headless) args.push('--headless');
  if (!view) args.push('--no-view');
  if (wait != null) args.push('--wait', String(wait));
  const r = await run(args);
  if (!r.ok) throw Object.assign(new Error(`[chammo-browser] ${r.error}`), { code: r.code });
  if (r.warn) console.error(`[chammo-browser] ${r.warn}`);
  const pw = chromium || playwrightCore().chromium;
  let browser;
  try {
    browser = await pw.connectOverCDP(r.wsEndpoint);
  } catch (e) {
    await run(['release', profile, '--owner', String(process.pid)]);
    throw e;
  }
  const context = browser.contexts()[0];
  // 내가 연 탭(newPage)과 거기서 뜬 팝업 — release 때 닫는다. 같이 쓰는 크롬(세션 브라우저 도구 등)에 남으면 앱 화면이 그 탭을 따라간다.
  // 남(세션·다른 스크립트)이 연 탭은 안 건드린다
  const mine = new Set();
  const newPage = context.newPage.bind(context);
  // 새로 띄운 크롬이면 지킴이가 연 빈 탭을 첫 newPage 로 쓴다 — 앱 탭 띠에 about:blank 가 남지 않게
  let blank = !r.shared && context.pages().length === 1 && context.pages()[0].url() === 'about:blank' ? context.pages()[0] : null;
  context.newPage = async (...a) => {
    const p = blank && !blank.isClosed() ? blank : await newPage(...a);
    blank = null;
    mine.add(p);
    return p;
  };
  context.on('page', (p) => { p.opener().then((o) => { if (o && mine.has(o)) mine.add(p); }, () => {}); });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all([...mine].map((p) => p.close().catch(() => {})));
    await browser.close().catch(() => {}); // CDP 로 붙은 브라우저라 연결만 끊긴다(크롬은 지킴이가 닫는다)
    await run(['release', profile, '--owner', String(process.pid)]);
  };
  return { browser, context, release, wsEndpoint: r.wsEndpoint, shared: r.shared, holder: r.holder };
}

module.exports = { launch };
