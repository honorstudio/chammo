// 폰 입구 설치(PWA) 판정 — 빌드한 입구(dist-phone)를 127.0.0.1 에 띄우고 헤드리스 크롬을 폰처럼(안드로이드·아이폰·아이패드) 흉내 내 연다.
// 크롬이 보는 설치 조건(Page.getInstallabilityErrors·manifest)·beforeinstallprompt·첫 화면 글을 적는다. 운영·진짜 계정에 안 닿는다.
// node run.cjs <입구 dist> <캡처 폴더> [이름표]   → 끝 줄 JSON, 실패가 있으면 종료 1
const fs = require('fs');
const http = require('http');
const path = require('path');
const { launch } = require(`${require('os').homedir()}/.honor-orchestrator/tools/chammo-browser`);
const [DIST, OUT, TAG = 'run'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/' || p === '/pair') p = p === '/' ? '/index.html' : '/pair.html';
  const f = path.join(DIST, path.normalize(p));
  if (!f.startsWith(path.resolve(DIST)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  r.end(fs.readFileSync(f));
});
const DEVICES = {
  android: { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', w: 412, h: 915, touch: 5, platform: 'Android' },
  iphone: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1', w: 390, h: 844, touch: 5, platform: 'iPhone' },
  // iPadOS 사파리는 데스크톱 맥 UA 를 보낸다 — 손가락 수로만 갈린다
  // 설치 창이 안 오는 크롬(한 번 닫음·판) — 메뉴 그림으로 · 설치한 앱으로 연 것(display-mode standalone) — 로그인
  'android-noprompt': { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', w: 412, h: 915, touch: 5, platform: 'Android', noPrompt: true },
  'android-app': { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', w: 412, h: 915, touch: 5, platform: 'Android', app: true },
  // 탭에서 로그인만 해 둔 안드로이드(계정은 있고 컴퓨터 연결은 없음) — 그래도 설치부터
  'android-acc': { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', w: 412, h: 915, touch: 5, platform: 'Android', acc: true },
  ipad: { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', w: 820, h: 1180, touch: 5, platform: 'MacIntel' },
};
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'} ${name}${note ? ` — ${note}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const { context, release } = await launch(`phone-install-${TAG}`, { headless: true, view: false });
  const report = {};
  try {
    for (const [name, d] of Object.entries(DEVICES)) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: d.ua, platform: d.platform });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: 2, mobile: true });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: d.touch });
      await page.addInitScript((no) => { window.__bip = 0; addEventListener('beforeinstallprompt', (e) => { window.__bip++; if (no) e.stopImmediatePropagation(); }, true); }, !!d.noPrompt);
      // 헤드리스 크롬은 display-mode 흉내(setEmulatedMedia)를 안 받는다 — 설치 앱으로 연 셈은 matchMedia 를 덮어 흉내
      if (d.acc) await page.addInitScript(() => { if (!localStorage.getItem('chammo.account')) localStorage.setItem('chammo.account', JSON.stringify({ email: 'me@gmail.com', device: 'dev-phone' })); });
      if (d.app) await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q)); });
      await page.goto(`${base}/pair?v=${Date.now()}`);
      await sleep(2500);
      const errs = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId);
      const man = await cdp.send('Page.getAppManifest').catch(() => ({}));
      const st = await page.evaluate(async () => ({
        bip: window.__bip,
        sw: !!(await navigator.serviceWorker.getRegistration()),
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
        buttons: [...document.querySelectorAll('#app button')].map((b) => b.textContent),
        android: document.documentElement.dataset.os ?? '',
      }));
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${TAG}-${name}.png`), Buffer.from(data, 'base64'));
      report[name] = { installErrors: errs, manifestErrors: (man.errors ?? []).map((e) => e.message), ...st };
      console.log(name, JSON.stringify(report[name]));
      await page.close();
    }
  } finally { await release(); srv.close(); }
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(report, null, 2));
  if (process.env.EXPECT === 'after') {
    const a = report.android, i = report.iphone, p = report.ipad;
    check('안드로이드 — 크롬 설치 조건 오류 없음', a.installErrors.length === 0, a.installErrors.join(','));
    check('안드로이드 — manifest 오류 없음', a.manifestErrors.length === 0, a.manifestErrors.join(','));
    check('안드로이드 — beforeinstallprompt 가 온다', a.bip > 0);
    check('안드로이드 — 설치 안 된 탭은 설치가 첫 단추', a.buttons[0] === '설치' && !a.buttons.includes('Chammo 계정으로 로그인'), a.buttons.join('|'));
    const n = report['android-noprompt'], app = report['android-app'];
    check('안드로이드 — 설치 창이 안 오면 크롬 메뉴 그림', n.text.includes('참모 앱을 설치해 주세요') && n.text.includes('홈 화면에 추가') && n.buttons.length === 0, n.text.slice(0, 60));
    check('안드로이드 — 설치한 앱으로 열면 로그인이 첫 단추', app.buttons[0] === 'Chammo 계정으로 로그인', app.buttons.join('|'));
    check('안드로이드 — 탭에서 로그인만 해 둔 사람도 설치부터', report['android-acc'].buttons[0] === '설치', report['android-acc'].buttons.join('|'));
    check('아이폰 — 홈 화면에 추가 안내(안드로이드 설치 단추 없음)', i.text.includes('홈 화면에 추가') && !i.buttons.includes('설치'), i.text.slice(0, 40));
    check('아이패드 — 아이폰처럼 홈 화면에 추가(안드로이드로 안 봄)', p.text.includes('홈 화면에 추가') && !p.buttons.includes('설치'), p.text.slice(0, 40));
  }
  console.log(JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
