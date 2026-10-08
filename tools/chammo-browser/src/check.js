// 시험 열기 — 설치가 끝나면 앱이 한 번 부른다(`chammo-browser check`). 세션이 쓸 크롬을 헤드리스로 about:blank 까지 띄웠다 닫는다.
// launch() 는 플레이라이트가 만든 임시 프로필이라 사람 프로필·세션 프로필을 안 건드리고, 헤드리스라 화면에 안 뜬다
const { chromeLaunch } = require('./window');
const { featureArgs } = require('./features');
const { sessionChrome } = require('./appcopy');

function defaultLaunch(opts) {
  return require('playwright-core').chromium.launch(opts);
}

/** @returns {Promise<{ok:true, channel:string|null, version:string} | {ok:false, error:string}>} */
// 세션이 쓸 그 크롬 = 맥이면 Chammo Browser 사본 — 설치 끝의 시험 열기가 사본을 처음 만들고 한 번 띄워 본다
async function check({ pick = () => sessionChrome(chromeLaunch()), launch = defaultLaunch, timeoutMs = 90_000 } = {}) {
  const c = pick();
  if (!c.found) return { ok: false, error: 'no-chrome' };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs); });
  try {
    return await Promise.race([timeout, (async () => {
      const browser = await launch({ channel: c.channel || 'chrome', executablePath: c.executablePath || undefined, headless: true, timeout: timeoutMs, args: featureArgs() });
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        return { ok: true, channel: c.channel, version: browser.version() };
      } finally {
        await browser.close();
      }
    })()]);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { check };
