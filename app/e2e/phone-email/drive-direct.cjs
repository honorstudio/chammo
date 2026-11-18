// 같은 계정 바로 연결(2026-11-18 사용자 결정 A) — 진짜 입구(참모 브라우저) ↔ 로컬 중계 ↔ 진짜 맥 코드(시험 앱). node drive-direct.cjs <입구 주소> <작업 폴더>
// ① 허용 대기 폰은 숫자(바로 연결 아님) ② 메일 코드로 사람이 허용한 셈(맥이 decide) ③ 허용된 폰이 다시 고르면 숫자·메일 없이 바로 ④ 다른 새 폰(대기)은 숫자 ⑤ 뺀 폰은 못 연다
const fs = require('fs');
const path = require('path');
const { launch } = require(`${require('os').homedir()}/.honor-orchestrator/tools/chammo-browser`);
const [base, W] = process.argv.slice(2);
const G = process.env.GOOGLE, SUB = process.env.SUB, MAC = process.env.MAC_NAME, DATA = process.env.DATA;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'} ${name}${note ? ` — ${note}` : ''}`); };
const emlFiles = () => { const log = fs.readFileSync(path.join(W, 'wrangler.log'), 'utf8'); return [...log.matchAll(/(\/[^\s"']+\.eml)/g)].map((m) => m[1]); };
const codeOf = (f) => { const raw = fs.readFileSync(f, 'utf8'); const body = raw.split(/\r?\n\r?\n/)[1]; return /코드: (\d{6})/.exec(Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'))?.[1]; };
const waitMails = async (n) => { for (let i = 0; i < 40; i++) { if (emlFiles().length >= n) return true; await sleep(250); } return false; };
const flag = (on) => { const f = path.join(DATA, 'phone-link.json'); if (on) fs.writeFileSync(f, '{"email":true}'); else fs.rmSync(f, { force: true }); };
const cards = () => { try { return fs.readFileSync(path.join(DATA, 'direct.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"link"')).length; } catch { return 0; } };
const macLog = () => { try { return fs.readFileSync(path.join(DATA, 'notify.log'), 'utf8'); } catch { return ''; } };

(async () => {
  const { context, release } = await launch('phone-direct-e2e', { headless: true, view: false });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('PAGEERR', String(e).slice(0, 200)));
    const cdp = await context.newCDPSession(page);
    const origin = new URL(base).origin;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const snap = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(W, `direct-${n}.png`), Buffer.from(data, 'base64')); };
    const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const until = async (re, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const t = await text().catch(() => ''); if (re.test(t)) return t; await sleep(200); } return null; };
    const signIn = async () => {
      await fetch(`${G}/next-user`, { method: 'POST', body: JSON.stringify({ sub: SUB, email: `${SUB}@example.com`, name: '시험' }) });
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await page.goto(`${base}/pair?v=${Date.now()}`);
      await page.getByRole('button', { name: 'Chammo 계정으로 로그인' }).click();
      return until(/어느 컴퓨터를 열까요|기다려요/);
    };

    // ① 허용 대기 폰 — 바로 연결이 아니라 숫자(그 카드가 계정 허용도 한다)
    flag(false);
    const t0 = await signIn();
    check('새 폰은 허용 대기', !!t0 && t0.includes('기다려요'), (t0 || '').slice(0, 60));
    let c0 = cards();
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    const sas = await until(/\d{3} \d{3}/, 20000);
    check('허용 대기 폰은 숫자 확인(바로 연결 아님)', !!sas && !macLog().includes('바로 연결'));
    await sleep(800);
    check('허용 대기 폰은 맥에 숫자 카드', cards() > c0);
    await snap('1-pending-number');

    // ② 사람이 허용한 셈 — 메일 코드(맥이 그 폰을 계정에 허용)
    flag(true);
    await page.goto(`${base}/pair?v=${Date.now()}`);
    await until(/어느 컴퓨터를 열까요|기다려요/);
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    await until(/메일로 온 코드/, 20000);
    await waitMails(1);
    await page.locator('input.pw-code').fill(codeOf(emlFiles().at(-1)));
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await until(/연결하는 중|아직 꺼져|연결하지 못했어요/, 20000);
    const st1 = await page.evaluate(() => ({ token: localStorage.getItem('chammo.token'), acc: localStorage.getItem('chammo.account') }));
    check('메일 코드로 허용·연결됨', !!st1.token, '');
    flag(false);

    // ③ 허용된 폰 — 연결을 지우고 다시 고르면 숫자·메일 없이 바로
    await page.evaluate(() => { localStorage.removeItem('chammo.token'); localStorage.removeItem('chammo.relay'); localStorage.removeItem('chammo.mailLink'); });
    await page.goto(`${base}/pair?v=${Date.now()}`);
    const t3 = await until(/어느 컴퓨터를 열까요/, 20000);
    check('허용된 폰은 고르는 화면(설명 줄 없음)', !!t3 && !t3.includes('확인을 시작해요'), (t3 || '').slice(0, 60));
    await snap('3-pick');
    const c3 = cards(), m3 = emlFiles().length;
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    const o3 = await until(/연결하는 중|아직 꺼져|연결하지 못했어요|\d{3} \d{3}/, 20000);
    check('허용된 폰은 숫자 없이 바로 연다', !!o3 && !/\d{3} \d{3}/.test(o3), (o3 || '').slice(0, 50));
    const st3 = await page.evaluate(() => ({ token: localStorage.getItem('chammo.token'), link: localStorage.getItem('chammo.relay') }));
    check('바로 연결 → 토큰·링크 저장', !!st3.token && !!st3.link);
    await sleep(1500);
    check('바로 연결은 숫자 카드를 안 만든다', cards() === c3);
    check('바로 연결은 메일을 안 보낸다', emlFiles().length === m3);
    check('맥 기록에 바로 연결 한 줄', macLog().includes('같은 계정 폰 바로 연결'));
    await sleep(3000);
    const shell = await page.evaluate(async () => { const r = await (await caches.open('chammo-relay-ui')).match('/__shell'); return r ? (await r.text()).length : 0; });
    check('터널로 맥 화면 껍데기를 받았다', shell > 100, `${shell}자`);
    await snap('3-direct-open');
    const phoneDev = JSON.parse(st3.link).device;

    // ④ 같은 계정의 다른 새 폰(대기) — 숫자로
    const t4 = await signIn();
    check('다른 새 폰은 허용 대기', !!t4 && t4.includes('기다려요'));
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    const s4 = await until(/\d{3} \d{3}|연결하는 중/, 20000);
    check('다른 새 폰은 바로 연결이 아니라 숫자', !!s4 && /\d{3} \d{3}/.test(s4));
    await snap('4-other-pending');
    fs.writeFileSync(path.join(W, 'direct-phone-dev.txt'), phoneDev);
    console.log(JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
  } finally { await release(); }
})().catch((e) => { console.error(e); console.log(JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: ['멈춤: ' + String(e).slice(0, 200), ...results.filter((r) => !r.ok).map((r) => r.name)] })); process.exit(1); });
