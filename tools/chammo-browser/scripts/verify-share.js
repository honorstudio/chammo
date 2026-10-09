#!/usr/bin/env node
// 진짜 크롬으로 '스크립트 지킴이 + 세션 브라우저 도구 같이 쓰기' 확인(roadmap 부채 browser-scripts ①).
// 시험 데이터 폴더(임시)·헤드리스에서만 돈다. 결과 로그: ../../.shots/<가지>/verify-share.log 로 옮겨 둔다
//
//   node scripts/verify-share.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOOL = path.join(__dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-verify-share-'));
const ROOT = path.join(HOME, 'browser');
const env = { ...process.env, CHAMMO_HOME: HOME, CHAMMO_BROWSER_IDLE_MINUTES: '0', CHAMMO_BROWSER_COPY: '0' }; // 앱 사본(새 번들 첫 실행 검사로 1분 넘게)은 이 시험 몫이 아님
delete env.CHAMMO_BROWSER_HOME;
delete env.CHAMMO_BROWSER_CHANNEL;
const P = 'shop';

const say = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockFile = path.join(ROOT, 'locks', `${P}.lock`);
const usersDir = path.join(ROOT, 'locks', `${P}.users`);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const users = () => { try { return fs.readdirSync(usersDir).map(Number); } catch { return []; } };
async function until(fn, ms = 15000, what = '조건') {
  for (let t = 0; t < ms; t += 200) { const v = await fn(); if (v) return v; await sleep(200); }
  throw new Error(`${what} — ${ms}ms 안에 안 됨`);
}

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<title>page ${req.url}</title><h1>${req.url}</h1>`);
});

/** 줄 단위 JSON 자식 */
function lines(child) {
  const msgs = [];
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(l)); } catch { /* 다른 출력 */ } }
  });
  return msgs;
}

function startScript(base) {
  const code = `
    const readline = require('readline');
    (async () => {
      const { context, release } = await require(${JSON.stringify(TOOL)}).launch(${JSON.stringify(P)}, { headless: true, wait: 20 });
      const page = await context.newPage();
      await page.goto(${JSON.stringify(base)} + '/script');
      console.log(JSON.stringify({ ready: true, pid: process.pid }));
      readline.createInterface({ input: process.stdin }).on('line', async (l) => {
        if (l === 'pages') console.log(JSON.stringify({ pages: context.pages().map((x) => x.url()) }));
        if (l === 'release') { await release(); console.log(JSON.stringify({ released: true })); }
        if (l === 'exit') process.exit(0);
      });
    })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });`;
  const child = spawn(process.execPath, ['-e', code], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  return { child, msgs: lines(child), send: (l) => child.stdin.write(`${l}\n`) };
}

function startWrapper() {
  const child = spawn(process.execPath, [path.join(TOOL, 'bin/chammo-browser-mcp.js'), P, '--headless'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  const msgs = lines(child);
  let id = 0;
  const rpc = async (method, params, ms = 30000) => {
    const my = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: my, method, params })}\n`);
    return until(() => msgs.find((m) => m.id === my), ms, `${method} 답`);
  };
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = ((r.result && r.result.content) || []).map((c) => c.text || '').join('\n');
    return { r, text, isError: !!(r.result && r.result.isError) || !!r.error };
  };
  return { child, msgs, rpc, tool, err: () => err, note: (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: m })}\n`) };
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  say(`시험 데이터 폴더 ${HOME} · 헤드리스`);

  const s = startScript(base);
  await until(() => s.msgs.find((m) => m.ready || m.error), 120000, '스크립트 크롬(첫 실행은 앱 사본 복사로 1분 넘게)');
  assert.ok(!s.msgs.some((m) => m.error), JSON.stringify(s.msgs));
  const holder = readJson(lockFile);
  assert.equal(holder.by, 'script');
  say(`① 스크립트 지킴이가 프로필을 쥠 — lock pid ${holder.pid}(by script)`);

  const w = startWrapper();
  const init = await w.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
  assert.ok(init.result, JSON.stringify(init));
  w.note('notifications/initialized');
  const nav = await w.tool('browser_navigate', { url: `${base}/session` });
  assert.ok(!nav.isError, `세션 도구가 실패: ${nav.text}\n${w.err()}`);
  assert.doesNotMatch(nav.text, /사용 중/);
  say(`② 세션 browser_navigate → 성공(사용 중 오류 아님): ${nav.text.split('\n').find((l) => l.includes('Page URL')) || nav.text.slice(0, 80)}`);
  s.send('pages');
  const pages = (await until(() => s.msgs.find((m) => m.pages), 5000, '스크립트 쪽 탭')).pages;
  assert.ok(pages.some((u) => u.endsWith('/session')), `같은 컨텍스트(로그인 공유)면 스크립트 쪽에 세션 탭이 보여야: ${pages}`);
  assert.ok(pages.some((u) => u.endsWith('/script')), `세션이 스크립트 탭을 옮기면 안 됨(새 탭에서): ${pages}`);
  const tabs = await w.tool('browser_tabs', { action: 'list' });
  assert.ok(users().includes(w.child.pid), `명부에 래퍼가 없음: ${users()}`);
  assert.equal(readJson(lockFile).pid, holder.pid, '락은 지킴이 그대로');
  say(`③ 같은 크롬·같은 컨텍스트 — 스크립트 쪽 탭 ${pages.map((u) => new URL(u).pathname).join(',')} · 세션 탭 목록 ${(tabs.text.match(/\/\w+\)/g) || []).join(' ')} · 명부 ${users().join(',')} · 락 주인 그대로 ${holder.pid}`);

  s.send('release');
  await until(() => s.msgs.find((m) => m.released), 10000, '스크립트 release');
  await sleep(2500);
  assert.ok(alive(holder.pid) && readJson(lockFile), '세션이 같이 쓰는 동안 지킴이가 크롬을 닫으면 안 됨');
  say('④ 스크립트가 다 써도 세션이 명부에 있어 지킴이가 안 닫음');

  const close = await w.tool('browser_close');
  assert.ok(!close.isError, close.text);
  assert.match(close.text, /스크립트/);
  await until(() => !readJson(lockFile), 10000, '세션이 놓은 뒤 지킴이가 닫음');
  assert.ok(!users().includes(w.child.pid));
  say(`⑤ 세션 browser_close → "${close.text.slice(0, 40)}…" · 명부에서 빠지자 지킴이가 닫고 락을 돌려줌`);

  const own = await w.tool('browser_navigate', { url: `${base}/own` });
  assert.ok(!own.isError, own.text);
  assert.equal(readJson(lockFile).pid, w.child.pid, '이번엔 래퍼가 락을 잡아야');
  say(`⑥ 다음 호출은 래퍼가 자기 락(pid ${w.child.pid})으로 띄움`);
  await w.tool('browser_close');
  await until(() => !readJson(lockFile), 10000, '래퍼 close');

  w.child.stdin.end();
  s.send('exit');
  await sleep(500);
  server.close();
  say('통과');
}

main().then(() => process.exit(0), (e) => { say(`실패: ${e.stack || e.message}`); process.exit(1); });
