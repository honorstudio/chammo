#!/usr/bin/env node
// 진짜 크롬으로 '앱이 붙기 전에 뜬 대화상자를 래퍼가 대신 답하기' 확인(roadmap 부채 browser-dialog ①).
// 시험 데이터 폴더(임시)·헤드리스. ① 늦게 붙은 CDP 세션이 그 대화상자에 답하면 어떻게 되나(앱이 겪는 것) ② 앱처럼 .dialog 를 쓰면 래퍼가 푸나
//
//   node scripts/verify-dialog.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOOL = path.join(__dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-verify-dialog-'));
const ROOT = path.join(HOME, 'browser');
const env = { ...process.env, CHAMMO_HOME: HOME, CHAMMO_BROWSER_IDLE_MINUTES: '0', CHAMMO_BROWSER_COPY: '0' };
delete env.CHAMMO_BROWSER_HOME;
delete env.CHAMMO_BROWSER_CHANNEL;
const P = 'shop';
const say = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
async function until(fn, ms = 15000, what = '조건') {
  for (let t = 0; t < ms; t += 200) { const v = await fn(); if (v) return v; await sleep(200); }
  throw new Error(`${what} — ${ms}ms 안에 안 됨`);
}

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<title>wait</title><script>setTimeout(() => { const a = confirm('지울까요?'); document.title = 'answer-' + a; }, 400)</script><h1>${req.url}</h1>`);
});

function startWrapper() {
  const child = spawn(process.execPath, [path.join(TOOL, 'bin/chammo-browser-mcp.js'), P, '--headless'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  const msgs = [];
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(l)); } catch { /* */ } }
  });
  let id = 0;
  const rpc = async (method, params, ms = 30000) => {
    const my = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: my, method, params })}\n`);
    return until(() => msgs.find((m) => m.id === my), ms, `${method} 답`);
  };
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    return ((r.result && r.result.content) || []).map((c) => c.text || '').join('\n');
  };
  return { child, rpc, tool, err: () => err };
}

/** 늦게 붙은 CDP 세션(앱 흉내)으로 그 탭에 Page.enable → handleJavaScriptDialog */
async function lateCdp(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === 'page' && p.url.startsWith('http'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0;
  const events = [];
  const waits = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) waits.get(m.id)(m); else if (m.method) events.push(m.method); };
  // 대화상자에 막힌 탭은 Page.enable 에도 답이 없을 수 있다 — 3초 넘으면 '답 없음'
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => r({ error: { message: `${method} 답 없음(3초)` } }), 3000).unref(); });
  await send('Page.enable');
  await sleep(500);
  const r = await send('Page.handleJavaScriptDialog', { accept: false });
  ws.close();
  return { events, r };
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  say(`시험 데이터 폴더 ${HOME} · 헤드리스`);
  const w = startWrapper();
  await w.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
  w.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await w.tool('browser_navigate', { url: `${base}/page` });
  await sleep(1200); // 대화상자가 뜬 뒤
  const live = await until(() => readJson(path.join(ROOT, 'live', `${P}.json`)), 5000, '상태 파일');
  assert.equal(live.pid, w.child.pid);

  const late = await lateCdp(live.port);
  say(`① 늦게 붙은 CDP 세션 — 받은 대화상자 사건: ${late.events.filter((e) => /Dialog/.test(e)).join(',') || '없음'} · 답: ${late.r.error ? `거절 "${late.r.error.message}"` : '받아들임'}`);

  fs.writeFileSync(path.join(ROOT, 'live', `${P}.dialog`), JSON.stringify({ pid: live.pid, accept: false, at: Date.now() }));
  const done = await until(() => readJson(path.join(ROOT, 'live', `${P}.dialog-done`)), 10000, '래퍼 결과');
  assert.ok(late.r.error ? done.ok : true, `래퍼가 못 풂: ${JSON.stringify(done)}\n${w.err()}`);
  const snap = await w.tool('browser_snapshot');
  const title = (snap.match(/Page Title: (.*)/) || [])[1];
  say(`② 앱처럼 .dialog(취소)를 쓰자 래퍼 결과 ${JSON.stringify(done)} · 페이지 제목 "${title}"`);
  if (late.r.error) assert.equal(title, 'answer-false');
  await w.tool('browser_close');
  w.child.stdin.end();
  server.close();
  say('통과');
}

main().then(() => process.exit(0), (e) => { say(`실패: ${e.stack || e.message}`); process.exit(1); });
