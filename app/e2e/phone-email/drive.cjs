// 폰 쪽 — 참모 브라우저로 진짜 입구를 몬다. 코드는 로컬 중계가 남긴 .eml 에서 읽는다. node drive.cjs <입구 주소> <작업 폴더>
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { launch } = require(`${require('os').homedir()}/.honor-orchestrator/tools/chammo-browser`);
const [base, W] = process.argv.slice(2);
const G = process.env.GOOGLE, SUB = process.env.SUB, MAC = process.env.MAC_NAME, DATA = process.env.DATA;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'} ${name}${note ? ` — ${note}` : ''}`); };
const emlFiles = () => { const log = fs.readFileSync(path.join(W, 'wrangler.log'), 'utf8'); return [...log.matchAll(/(\/[^\s"']+\.eml)/g)].map((m) => m[1]); };
const readMail = (f) => { const raw = fs.readFileSync(f, 'utf8'); const [head, body] = raw.split(/\r?\n\r?\n/); const text = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'); return { to: /^To: <([^>]+)>/m.exec(head)?.[1], text, code: /코드: (\d{6})/.exec(text)?.[1] }; };
const waitMails = async (n) => { for (let i = 0; i < 40; i++) { if (emlFiles().length >= n) return true; await sleep(250); } return false; };
const flag = (on) => { const f = path.join(DATA, 'phone-link.json'); if (on) fs.writeFileSync(f, '{"email":true}'); else fs.rmSync(f, { force: true }); };
const cards = () => { try { return fs.readFileSync(path.join(DATA, 'direct.jsonl'), 'utf8').split('\n').filter((l) => l.includes('link')).length; } catch { return 0; } };

(async () => {
  const { context, release } = await launch('phone-email-e2e', { headless: true, view: false });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('PAGEERR', String(e).slice(0, 200)));
    const cdp = await context.newCDPSession(page);
    const origin = new URL(base).origin;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const snap = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(W, `shot-${n}.png`), Buffer.from(data, 'base64')); };
    const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const until = async (re, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const t = await text().catch(() => ''); if (re.test(t)) return t; await sleep(200); } return null; };
    const fresh = async () => {
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await page.goto(`${base}/pair?v=${Date.now()}`);
    };
    const signIn = async () => {
      await fetch(`${G}/next-user`, { method: 'POST', body: JSON.stringify({ sub: SUB, email: `${SUB}@example.com`, name: '시험' }) });
      await fresh();
      await page.getByRole('button', { name: 'Chammo 계정으로 로그인' }).click();
      return until(/어느 컴퓨터를 열까요|기다려요/);
    };
    const putCode = async (c) => { await page.locator('input.pw-code').fill(c); await page.getByRole('button', { name: '확인', exact: true }).click(); };

    // ① 끈 맥 — 숫자 그대로, 메일 없음
    flag(false);
    const t0 = await signIn();
    check('로그인 뒤 내 컴퓨터가 보인다', t0 && t0.includes(MAC), (t0 || '').slice(0, 90));
    check('안내 글이 맥 허용으로 읽히지 않는다', t0 && !t0.includes('다른 기기 카드에서 허용해도 돼요'));
    await snap('1-mine');
    const c0 = cards();
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    const sas = await until(/\d{3} \d{3}/, 20000);
    check('끈 맥은 숫자 확인', !!sas, (sas || '').slice(0, 40));
    check('끈 맥은 메일이 안 나간다', emlFiles().length === 0);
    await sleep(1000);
    check('끈 맥은 맥에 숫자 카드', cards() > c0);
    await snap('1-off-number');

    // ② 켠 맥 — 메일, 앱 전환·새로고침 뒤 복귀, 틀린 코드, 맞는 코드
    flag(true);
    await page.goto(`${base}/pair?v=${Date.now()}`);
    await until(/어느 컴퓨터를 열까요|기다려요/);
    const c1 = cards();
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    const t1 = await until(/메일로 온 코드/, 20000);
    check('켠 맥은 메일 코드 화면', !!t1, (t1 || '').slice(0, 80));
    await snap('2-code');
    check('메일이 한 통 나갔다', await waitMails(1));
    const m1 = readMail(emlFiles()[0]);
    check('받는 주소 = 계정 메일', m1.to === `${SUB}@example.com`, m1.to);
    check('본문에 코드·기기·무시 안내', !!m1.code && m1.text.includes('기기:') && m1.text.includes('무시'));
    check('켠 맥은 숫자 카드를 안 만든다', cards() === c1);
    // 앱 전환 흉내 — 다른 페이지로 갔다 돌아온다(소켓·메모리 다 사라짐)
    await page.goto('about:blank');
    await sleep(1500);
    await page.goto(`${base}/pair?v=${Date.now()}`);
    check('메일 앱에 다녀와도 코드 화면으로 돌아온다', !!(await until(/메일로 온 코드/, 10000)));
    await putCode(m1.code === '000000' ? '000001' : '000000');
    const w1 = await until(/코드가 달라요/, 15000);
    check('틀린 코드는 남은 횟수를 알린다', w1 && w1.includes('4번'), (w1 || '').slice(0, 70));
    await snap('2-wrong');
    await page.reload();
    await until(/메일로 온 코드/, 10000);
    await page.getByRole('button', { name: '메일 다시 받기' }).click();
    const w2 = await until(/초 뒤 다시 받을 수|다시 보냈어요/, 15000);
    check('재전송은 간격 제한', w2 && w2.includes('초 뒤'), (w2 || '').slice(0, 80));
    check('간격 안엔 메일이 더 안 나간다', emlFiles().length === 1);
    await putCode(m1.code);
    const openT = await until(/연결하는 중|연결하지 못했어요|아직 꺼져/, 20000);
    const st = await page.evaluate(() => ({ token: localStorage.getItem('chammo.token'), link: localStorage.getItem('chammo.relay'), mail: localStorage.getItem('chammo.mailLink') }));
    check('맞는 코드 → 토큰·링크 저장', !!st.token && !!st.link, (openT || '').slice(0, 50));
    check('진행 기록은 지워진다', st.mail === null);
    await sleep(3000);
    const deep = await page.evaluate(async () => {
      const shell = await (await caches.open('chammo-relay-ui')).match('/__shell');
      const { linkedKeys } = await import('/src/phone-web/keys.ts');
      const { call } = await import('/src/phone-web/relayClient.ts');
      const l = JSON.parse(localStorage.getItem('chammo.relay'));
      const self = await call(l.relay, await linkedKeys(), l.device, 'GET', '/v0/me/self');
      return { shell: !!shell && (await shell.text()).length, status: self.json && self.json.status };
    });
    check('터널로 맥 화면 껍데기를 받았다', deep.shell > 100, `${deep.shell}자`);
    check('중계에서 이 폰이 허용됐다', deep.status === 'approved', deep.status);
    await snap('2-open');
    // 같은 코드 다시 — 새 폰으로 다시 로그인해 앞 코드를 넣어 본다(한 번만)
    const old = m1.code;

    // ③ 새 폰 — 앞 코드는 못 쓴다, 틀린 코드 5번이면 잠김, 잠기면 새 메일 안 나감
    await signIn();
    await page.getByRole('button', { name: new RegExp(MAC) }).click();
    await until(/메일로 온 코드/, 20000);
    check('새 폰도 메일을 받는다', await waitMails(2));
    await snap('3-new-phone');
    const m2 = readMail(emlFiles()[1]);
    if (old !== m2.code) { await putCode(old); check('앞 폰 코드는 다른 폰에 안 먹는다', !!(await until(/코드가 달라요/, 15000))); }
    for (let i = 0; i < 4 + (old === m2.code ? 1 : 0); i++) {
      const bad = m2.code === String(100000 + i) ? String(200000 + i) : String(100000 + i);
      await putCode(bad);
      await until(/코드가 달라요|5번 틀렸어요/, 15000);
      await sleep(300);
    }
    const lock = await text();
    check('다섯 번 틀리면 잠긴다', lock.includes('5번 틀렸어요'), lock.slice(0, 80));
    await snap('3-locked');
    await putCode(m2.code);
    const after = await until(/5번 틀렸어요/, 15000);
    check('잠기면 맞는 코드도 안 된다', !!after);
    const n = emlFiles().length;
    await page.getByRole('button', { name: '메일 다시 받기' }).click();
    const l2 = await until(/코드를 5번 틀렸어요/, 15000);
    check('잠긴 동안 새 메일이 안 나간다', !!l2 && emlFiles().length === n);
    await snap('3-locked-screen');
    console.log(JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  } finally { await release(); }
})().catch((e) => { console.error(e); console.log(JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: ['멈춤: ' + String(e).slice(0, 200), ...results.filter((r) => !r.ok).map((r) => r.name)] })); process.exit(1); });
