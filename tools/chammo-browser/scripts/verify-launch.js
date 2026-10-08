#!/usr/bin/env node
// 진짜 크롬으로 `chammo-browser launch` 확인 — 스크립트가 띄운 크롬이 앱 화면 상태(live)·락·명부·채널 기억을 지키나.
// 시험 데이터 폴더(임시)에서만 돈다 — 진짜 프로필·로그인은 안 건드린다. 크롬 창은 VD=<x,y,w,h>(크롬 좌표)를 주면 그 가짜 화면에
// (예: 맥 'Chammo agents' 화면), 안 주면 헤드리스. 결과 로그: ../../.shots/browser-scripts/verify-launch.log (있으면)
//
//   node scripts/verify-launch.js            # 전부
//   VD=-2910,956,1440,900 VD_PID=<chammo-vdisplay pid> node scripts/verify-launch.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const TOOL = path.join(__dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-verify-launch-'));
const ROOT = path.join(HOME, 'browser');
const env = { ...process.env, CHAMMO_HOME: HOME };
delete env.CHAMMO_BROWSER_HOME;
delete env.CHAMMO_BROWSER_CHANNEL;
const HEADLESS = !process.env.VD;
if (!HEADLESS) {
  const b = process.env.VD.split(',').map(Number);
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'vdisplay.json'), JSON.stringify({ pid: Number(process.env.VD_PID), displayID: 0, bounds: b }));
  fs.writeFileSync(path.join(HOME, 'config.json'), '{}'); // 앱이 있는 맥처럼(가짜 화면 자리를 쓴다)
}

const lines = [];
const say = (m) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`; lines.push(l); console.log(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockFile = (p) => path.join(ROOT, 'locks', `${p}.lock`);
const liveFile = (p) => path.join(ROOT, 'live', `${p}.json`);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function until(fn, ms = 15000, what = '조건') {
  for (let t = 0; t < ms; t += 200) { const v = await fn(); if (v) return v; await sleep(200); }
  throw new Error(`${what} — ${ms}ms 안에 안 됨`);
}

// 페이지 — 제목이 보이는 작은 서버
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<title>page ${req.url}</title><body style="height:3000px;background:linear-gradient(#cde,#fed)"><h1>${req.url}</h1></body>`);
});

/**
 * 시험 스크립트 하나(따로 프로세스) — 도우미로 크롬을 받고 탭을 연다. stdin 명령: goto <path> · release · exit
 * how = 'helper'(고친 길) | 'direct'(고치기 전 — launchPersistentContext 를 직접)
 */
function startScript(profile, how, base, extra = {}) {
  const code = `
    const path = require('path');
    const readline = require('readline');
    (async () => {
      let context, release = async () => {}, shared = null;
      if (${JSON.stringify(how)} === 'direct') {
        const { playwrightCore } = require(${JSON.stringify(path.join(TOOL, 'src/script'))});
        const dir = path.join(${JSON.stringify(ROOT)}, 'profiles', ${JSON.stringify(profile)});
        context = await playwrightCore().chromium.launchPersistentContext(dir, { channel: 'chrome-beta', headless: ${HEADLESS}, args: ${JSON.stringify(HEADLESS ? [] : [`--window-position=${process.env.VD.split(',').map(Number)[0] + 24},${process.env.VD.split(',').map(Number)[1] + 24}`])} });
        release = () => context.close();
      } else {
        ({ context, release, shared } = await require(${JSON.stringify(TOOL)}).launch(${JSON.stringify(profile)}, ${JSON.stringify({ headless: HEADLESS, wait: 20, ...extra })}));
      }
      const page = await context.newPage();
      await page.goto(${JSON.stringify(base)} + '/start-' + process.pid);
      console.log(JSON.stringify({ ready: true, shared, pid: process.pid }));
      readline.createInterface({ input: process.stdin }).on('line', async (l) => {
        const [cmd, arg] = l.split(' ');
        if (cmd === 'goto') { await page.goto(${JSON.stringify(base)} + arg); console.log(JSON.stringify({ at: page.url() })); }
        if (cmd === 'shot') { await page.screenshot({ fullPage: true, path: arg, timeout: 20000 }); console.log(JSON.stringify({ shot: arg })); }
        if (cmd === 'release') { await release(); console.log(JSON.stringify({ released: true })); }
        if (cmd === 'exit') process.exit(0);
      });
    })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });`;
  const child = spawn(process.execPath, ['-e', code], { env: { ...env, CLAUDE_PID: String(extra.session || 4242) }, stdio: ['pipe', 'pipe', 'inherit'] });
  const msgs = [];
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(l)); } catch { /* 다른 출력 */ } }
  });
  return {
    child,
    msgs,
    send: (l) => child.stdin.write(`${l}\n`),
    wait: (pred, ms, what) => until(() => msgs.find(pred), ms, what),
  };
}

const cli = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(TOOL, 'bin/chammo-browser.js'), ...a], { env }).toString().trim().split('\n').pop());

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  say(`시험 데이터 폴더 ${HOME} · ${HEADLESS ? '헤드리스' : `가짜 화면 ${process.env.VD}`}`);

  // ① 고치기 전 — 스크립트가 크롬을 직접 띄우면 앱이 읽는 상태 파일도 락도 없다
  {
    const s = startScript('before', 'direct', base);
    await s.wait((m) => m.ready || m.error, 30000, '직접 띄운 크롬');
    assert.ok(!s.msgs.some((m) => m.error), JSON.stringify(s.msgs));
    assert.equal(fs.existsSync(liveFile('before')), false, '상태 파일이 없어야 (앱 화면에 안 뜸)');
    assert.equal(fs.existsSync(lockFile('before')), false, '락도 없어야');
    say('① 재현: 직접 띄운 크롬 → live/before.json 없음 · locks/before.lock 없음 = 앱 화면에 안 뜨고 잠금도 없음');
    s.send('exit');
    await until(() => !alive(s.child.pid), 10000, '직접 띄운 스크립트 끝');
  }

  // ② 고친 뒤 — 같은 스크립트를 도우미로: 락 · 상태 파일(세션 pid·포트·지금 주소) · 앱이 붙을 포트
  let first;
  {
    first = startScript('shop', 'helper', base, { session: 28753 });
    const r = await first.wait((m) => m.ready || m.error, 40000, '도우미 크롬');
    assert.ok(r.ready, JSON.stringify(first.msgs));
    assert.equal(r.shared, false);
    const lock = await until(() => readJson(lockFile('shop')), 5000, '락');
    assert.equal(lock.by, 'script');
    assert.equal(lock.owner, first.child.pid);
    const live = await until(() => { const l = readJson(liveFile('shop')); return l && l.url.includes('/start-') && l; }, 10000, '상태 파일에 지금 주소');
    assert.equal(live.sessionPid, 28753, '세션 pid = CLAUDE_PID');
    assert.equal(live.pid, lock.pid, '상태 파일 주인 = 지킴이');
    assert.ok(live.tabs.some((t) => t.current && t.url.includes('/start-')), '탭 목록');
    assert.equal(live.tabs.length, 1, `지킴이가 연 빈 탭이 남으면 안 됨: ${JSON.stringify(live.tabs)}`);
    assert.match(live.tool, /^스크립트 /);
    assert.equal((fs.statSync(liveFile('shop')).mode & 0o777).toString(8), '600');
    const ver = await (await fetch(`http://127.0.0.1:${live.port}/json/version`)).json();
    assert.ok(ver.Browser, '앱이 붙을 포트가 산다');
    if (process.platform === 'darwin') {
      // 맥이면 래퍼와 같은 'Chammo Browser' 사본으로 떠야 한다(src/appcopy.js — Dock 에서 사용자 크롬과 갈리게)
      const cpid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${live.port}`, '-sTCP:LISTEN']).toString().trim().split('\n')[0];
      const exe = execFileSync('/bin/ps', ['-o', 'comm=', '-p', cpid]).toString().trim();
      assert.match(exe, /Chammo Browser\.app/, `사본이 아님: ${exe}`);
      say(`② 크롬 = ${exe.replace(HOME, '<시험 폴더>')}`);
    }
    say(`② 고친 뒤: 락(by script, owner ${lock.owner}) · live/shop.json(sessionPid ${live.sessionPid}, port ${live.port}, url ${live.url}) · ${ver.Browser}`);
    first.send('goto /second');
    await until(() => (readJson(liveFile('shop')) || {}).url?.endsWith('/second'), 10000, '이동이 상태 파일에');
    say('② 이동하면 상태 파일 주소도 바뀜(/second)');
    // 앱처럼 다른 CDP 손님이 화면을 받는 동안 fullPage 캡처(아이맥에서 30초 멈췄다던 것)
    const shot = path.join(HOME, 'full.png');
    const t0 = Date.now();
    first.send(`shot ${shot}`);
    await first.wait((m) => m.shot, 25000, 'fullPage 캡처');
    say(`② fullPage 캡처 ${Date.now() - t0}ms`);
  }

  // ③ 같은 프로필 두 스크립트 동시 — 둘째는 같은 크롬을 같이 쓴다. 첫째가 끝나도 둘째가 쓰는 동안 크롬이 산다
  {
    const holder = readJson(lockFile('shop')).pid;
    const second = startScript('shop', 'helper', base);
    const r = await second.wait((m) => m.ready || m.error, 30000, '둘째 스크립트');
    assert.equal(r.shared, true, JSON.stringify(second.msgs));
    say(`③ 둘째 스크립트 shared=true (지킴이 ${holder} 그대로)`);
    first.send('exit');
    await until(() => !alive(first.child.pid), 10000, '첫째 끝');
    await sleep(2500);
    assert.equal(alive(holder), true, '둘째가 쓰는 동안 지킴이·크롬이 산다');
    second.send('goto /still');
    await second.wait((m) => m.at && m.at.endsWith('/still'), 10000, '둘째가 계속 쓴다');
    say('③ 첫째가 끝나도(2.5초) 크롬 그대로 — 둘째가 /still 로 이동');
    second.send('release');
    await second.wait((m) => m.released, 10000, '둘째 release');
    await until(() => !alive(holder) && !fs.existsSync(lockFile('shop')) && !fs.existsSync(liveFile('shop')), 8000, 'release 뒤 닫힘');
    say('③ 마지막 사용자 release → 지킴이 끝 · 락 · 상태 파일 정리');
    second.send('exit');
  }

  // ⑤ 스크립트가 죽어도(kill -9) 락 반납
  {
    const s = startScript('crash', 'helper', base);
    await s.wait((m) => m.ready || m.error, 30000, '크래시 시험 스크립트');
    const holder = readJson(lockFile('crash')).pid;
    const t0 = Date.now();
    s.child.kill('SIGKILL');
    await until(() => !fs.existsSync(lockFile('crash')) && !alive(holder), 8000, 'kill -9 뒤 락 반납');
    say(`⑤ 스크립트 kill -9 → ${Date.now() - t0}ms 만에 지킴이 끝·락 반납·상태 파일 ${fs.existsSync(liveFile('crash')) ? '남음(!)' : '정리'}`);
    assert.equal(fs.existsSync(liveFile('crash')), false);
    // 지킴이가 죽어도(kill -9) 다음 launch 가 남은 락을 치우고 띄운다
    const s2 = startScript('crash', 'helper', base);
    await s2.wait((m) => m.ready || m.error, 30000, '다시 띄움');
    const h2 = readJson(lockFile('crash')).pid;
    process.kill(h2, 'SIGKILL');
    await sleep(1500);
    s2.send('exit');
    await until(() => !alive(s2.child.pid), 8000, '스크립트 끝');
    const s3 = startScript('crash', 'helper', base);
    const r3 = await s3.wait((m) => m.ready || m.error, 30000, '죽은 지킴이 뒤 다시');
    assert.ok(r3.ready, JSON.stringify(s3.msgs));
    say('⑤ 지킴이를 kill -9 해도 다음 launch 가 남은 락을 치우고 다시 띄움');
    s3.send('exit');
    await until(() => !fs.existsSync(lockFile('crash')), 20000, '정리');
  }

  // ④ 채널 기억 — 정품으로 만든 프로필은 정품으로, 베타로 만든 것은 베타로(직접 고르지 않아도)
  {
    const { installedVersions } = require('../src/channel');
    const v = installedVersions();
    say(`④ 깔린 크롬: ${JSON.stringify(v)}`);
    if (v.chrome && v['chrome-beta']) {
      // 정품으로 프로필 만들기(아이맥 project-x 처럼 스크립트가 channel:'chrome' 로 직접 만든 것 — 기억 파일 없음)
      const { playwrightCore } = require('../src/script');
      const dir = path.join(ROOT, 'profiles', 'stable-made');
      const c = await playwrightCore().chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true });
      await c.close();
      assert.equal(fs.readFileSync(path.join(dir, 'Last Version'), 'utf8').split('.')[0], v.chrome.split('.')[0]);
      const s = startScript('stable-made', 'helper', base);
      await s.wait((m) => m.ready || m.error, 30000, '정품 프로필');
      const live = await until(() => readJson(liveFile('stable-made')), 10000, '상태 파일');
      const ver = await (await fetch(`http://127.0.0.1:${live.port}/json/version`)).json();
      assert.equal(ver.Browser.split('/')[1].split('.')[0], v.chrome.split('.')[0], `정품 판으로 열려야: ${ver.Browser}`);
      assert.equal(fs.readFileSync(path.join(dir, 'ChammoChannel'), 'utf8').trim(), 'chrome');
      say(`④ 정품으로 만든 프로필(Last Version ${v.chrome.split('.')[0]}) → ${ver.Browser} 로 열림 · ChammoChannel=chrome`);
      s.send('exit');
      await until(() => !fs.existsSync(lockFile('stable-made')), 20000, '정리');
      // 새 프로필은 기본(베타)으로 열고 기억한다
      const n = startScript('fresh', 'helper', base);
      await n.wait((m) => m.ready || m.error, 30000, '새 프로필');
      const nl = await until(() => readJson(liveFile('fresh')), 10000, '상태 파일');
      const nv = await (await fetch(`http://127.0.0.1:${nl.port}/json/version`)).json();
      say(`④ 새 프로필 → ${nv.Browser} · ChammoChannel=${fs.readFileSync(path.join(ROOT, 'profiles/fresh/ChammoChannel'), 'utf8').trim()}`);
      n.send('exit');
      await until(() => !fs.existsSync(lockFile('fresh')), 20000, '정리');
    } else {
      say('④ 정품·베타가 다 깔려 있지 않아 건너뜀');
    }
  }

  // ⑥ 세션 브라우저 도구(MCP 래퍼)가 띄운 크롬을 스크립트가 같이 쓴다 — 쓰는 동안 래퍼의 유휴 닫기가 미뤄진다
  {
    const mcp = spawn(process.execPath, [path.join(TOOL, 'bin/chammo-browser-mcp.js'), 'mcpshare', '--idle-minutes=0.05', ...(HEADLESS ? ['--headless'] : [])], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    mcp.stdout.on('data', (c) => { out += c; });
    const rpc = (id, method, params) => mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
    await until(() => out.includes('"id":1'), 20000, 'MCP initialize');
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    rpc(2, 'tools/call', { name: 'browser_navigate', arguments: { url: `${base}/mcp` } });
    await until(() => out.includes('"id":2'), 40000, 'MCP navigate');
    const wrapperPid = readJson(lockFile('mcpshare')).pid;
    assert.equal(wrapperPid, mcp.pid);
    const s = startScript('mcpshare', 'helper', base);
    const r = await s.wait((m) => m.ready || m.error, 30000, 'MCP 크롬 같이 쓰기');
    assert.equal(r.shared, true, JSON.stringify(s.msgs));
    await sleep(6000); // 유휴 3초가 두 번 지나도
    assert.ok(!out.includes('chammo-idle'), '유휴 닫기 안 함');
    s.send('goto /during-idle');
    await s.wait((m) => m.at && m.at.endsWith('/during-idle'), 10000, '유휴 시간 지나도 스크립트가 쓴다');
    say('⑥ MCP 래퍼 크롬을 스크립트가 같이 씀(shared=true) — 유휴 3초×2 지나도 안 닫힘');
    s.send('release');
    await s.wait((m) => m.released, 10000, '스크립트 release');
    const tabs = await (await fetch(`http://127.0.0.1:${readJson(path.join(ROOT, 'live', 'mcpshare.json')).port}/json/list`)).json();
    assert.ok(!tabs.some((t) => t.url.includes('/during-idle') || t.url.includes('/start-')), `스크립트 탭이 남음: ${tabs.map((t) => t.url)}`);
    assert.ok(tabs.some((t) => t.url.endsWith('/mcp')), `세션 탭이 닫힘: ${tabs.map((t) => t.url)}`);
    rpc(3, 'tools/call', { name: 'browser_navigate', arguments: { url: `${base}/mcp-again` } });
    await until(() => out.includes('"id":3'), 20000, 'release 뒤에도 세션 브라우저 도구가 그대로');
    assert.ok(!/"id":3[^\n]*"isError":true/.test(out), 'release 뒤 세션 도구 실패');
    say('⑥ 스크립트 release → 스크립트가 연 탭만 닫히고 세션 브라우저(MCP)는 그대로 씀');
    s.send('exit');
    await until(() => !fs.existsSync(lockFile('mcpshare')), 15000, '스크립트가 끝난 뒤 래퍼 유휴 닫기');
    say('⑥ 스크립트가 끝나자 래퍼가 유휴 닫기로 락 반납');
    // 래퍼가 새로 떠도 남(스크립트 지킴이)의 상태 파일을 안 지운다
    const k = startScript('mcpshare', 'helper', base);
    await k.wait((m) => m.ready || m.error, 30000, '스크립트 지킴이');
    const before = readJson(liveFile('mcpshare'));
    const mcp2 = spawn(process.execPath, [path.join(TOOL, 'bin/chammo-browser-mcp.js'), 'mcpshare'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    await sleep(3000);
    mcp2.stdin.end();
    await until(() => !alive(mcp2.pid), 10000, '두 번째 래퍼 끝');
    const after = readJson(liveFile('mcpshare'));
    assert.ok(after && after.pid === before.pid, '래퍼가 켜고 꺼져도 지킴이 상태 파일 그대로');
    assert.ok(fs.existsSync(path.join(ROOT, 'profiles/mcpshare/DevToolsActivePort')), '포트 파일도 그대로');
    say('⑥ 브라우저를 안 쓴 세션 래퍼가 켜졌다 꺼져도 스크립트 크롬의 상태·포트 파일 그대로');
    k.send('exit');
    mcp.stdin.end();
    await until(() => !fs.existsSync(lockFile('mcpshare')), 10000, '정리');
  }

  // ⑦ 잠금 없이 직접 띄운 크롬(옛 스크립트)이 프로필을 쥐고 있으면 launch 는 기다리다 한 줄로 알리고, 그 크롬이 끝나면 띄운다
  {
    const legacy = startScript('legacy', 'direct', base);
    await legacy.wait((m) => m.ready || m.error, 30000, '옛 스크립트 크롬');
    const owner = spawn('/bin/sleep', ['60']);
    let busy;
    try { execFileSync(process.execPath, [path.join(TOOL, 'bin/chammo-browser.js'), 'launch', 'legacy', '--owner', String(owner.pid), '--wait', '3', '--headless'], { env }); } catch (e) { busy = e; }
    assert.equal(busy && busy.status, 2, '바쁨(code 2)');
    const r = JSON.parse(busy.stdout.toString().trim());
    assert.match(r.error, /잠금 없이/);
    assert.equal(r.error.split('\n').length, 1);
    say(`⑦ 옛 스크립트 크롬이 쥔 프로필 → launch 3초 기다리고 code 2: ${r.error}`);
    legacy.send('exit');
    await until(() => !alive(legacy.child.pid), 10000, '옛 스크립트 끝');
    const ok = JSON.parse(execFileSync(process.execPath, [path.join(TOOL, 'bin/chammo-browser.js'), 'launch', 'legacy', '--owner', String(owner.pid), '--wait', '15', '--headless'], { env }).toString().trim());
    assert.equal(ok.ok, true, JSON.stringify(ok));
    say('⑦ 옛 크롬이 끝나자 launch 성공');
    owner.kill();
    await until(() => !fs.existsSync(lockFile('legacy')), 20000, '정리');
  }

  // 남은 지킴이·크롬 없음
  const left = execFileSync('/bin/ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(HOME) && !l.includes('verify-launch'));
  assert.equal(left.length, 0, `남은 프로세스:\n${left.join('\n')}`);
  say('남은 지킴이·크롬 없음');
  say(`launch/release 출력 예: ${JSON.stringify(cli('release', 'shop', '--owner', String(process.pid)))}`);
}

main().then(() => { say('통과'); finish(0); }, (e) => { say(`실패: ${e.stack || e.message}`); finish(1); });

function finish(code) {
  server.close();
  const shots = path.join(TOOL, '..', '..', '.shots', 'browser-scripts');
  try { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, 'verify-launch.log'), `${lines.join('\n')}\n`); } catch { /* 없음 */ }
  // 남은 시험 프로세스 정리(시험 폴더를 쓰는 것만)
  try { execFileSync('/usr/bin/pkill', ['-f', HOME]); } catch { /* 없음 */ }
  setTimeout(() => { fs.rmSync(HOME, { recursive: true, force: true }); process.exit(code); }, 1500);
}
