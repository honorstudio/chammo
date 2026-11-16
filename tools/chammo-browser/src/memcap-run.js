// 메모리 상한 감시(src/memcap.js)를 진짜 크롬에 건다 — MCP 래퍼와 스크립트 지킴이가 그 프로필 락을 쥐는 동안 하나씩 돌린다.
//   trim  CDP 로 붙어 탭을 본 뒤 제일 큰 렌더러를 SIGKILL — 그 렌더러를 쓰던 탭(crash)을 닫고 주소를 돌려준다. CDP 가 없으면 끊기만
//   kill  그 프로필 크롬 본체만 SIGTERM, 5초 뒤에도 살아 있으면 SIGKILL — 자식(렌더러·GPU)은 본체와 같이 끝난다
const fs = require('fs');
const http = require('http');
const path = require('path');
const memcap = require('./memcap');
const paths = require('./paths');
const liveMod = require('./live');

/** 주소는 쿼리·조각을 뗀다(토큰이 붙어 오는 일이 많다) — 기록·알림에 남으니까 */
function bare(u) {
  try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return ''; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function listTabs(port) {
  return new Promise((resolve) => {
    if (!port) return resolve([]);
    const req = http.get({ host: '127.0.0.1', port: port.port, path: '/json/list', timeout: 3000 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b).filter((t) => t.type === 'page').map((t) => bare(t.url)).filter(Boolean)); } catch { resolve([]); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve([]));
  });
}

/** 시간 안에 안 끝나면 null — 맥이 바쁠 때 CDP 가 늦어도 끊기는 늦추지 않는다 */
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/**
 * 렌더러 하나 끊고 그 탭을 닫는다 — 닫은 탭 주소들(프레임·확장만 쓰던 렌더러면 []).
 * 끊기가 먼저다: CDP 가 없거나 connectMs 안에 못 붙으면 주소 없이 바로 끊는다(11-16 실측 — 부하 30+ 에서 붙기가 늦어 1분 넘게 못 잘랐다)
 */
async function trimRenderer(port, pid, { waitMs = 3000, connectMs = 4000, connect } = {}) {
  const cut = () => { try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 끝남 */ } };
  if (!port) { cut(); return []; }
  const open = connect || ((ws) => require('./script').playwrightCore().chromium.connectOverCDP(ws, { timeout: connectMs }));
  const b = await within(Promise.resolve().then(() => open(`ws://127.0.0.1:${port.port}${port.wsPath}`)).catch(() => null), connectMs + 500);
  if (!b) { cut(); return []; }
  try {
    const pages = b.contexts().flatMap((c) => c.pages());
    const crashed = [];
    const done = new Promise((r) => { const t = setTimeout(r, waitMs); pages.forEach((p) => p.once('crash', () => { crashed.push(p); if (crashed.length === pages.length) { clearTimeout(t); r(); } })); });
    cut();
    await done;
    const urls = crashed.map((p) => bare(p.url())).filter(Boolean);
    for (const p of crashed) await within(p.close().catch(() => {}), 2000);
    return urls;
  } finally {
    await within(b.close().catch(() => {}), 2000); // CDP 로 붙은 것 — 끊기만 한다(크롬은 그대로)
  }
}

async function killChrome(pid, { graceMs = 5000 } = {}) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let t = 0; t < graceMs && alive(pid); t += 250) await new Promise((r) => setTimeout(r, 250));
  if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* 끝남 */ }
}

/** 크롬이 그 프로필을 쓰는 중인가 — SingletonLock 은 없는 곳을 가리키는 링크라 lstat 으로 */
function chromeRunning(profileDir) {
  try { fs.lstatSync(path.join(profileDir, 'SingletonLock')); return true; } catch { return false; }
}

/** 감시를 켠다 — { takeNote, tick, stop }. when = 지금 내가 감시할 차례인가(MCP 래퍼: 내 락·내 크롬일 때만) */
function attach({ profile, sessionPid = 0, via = '', log = (m) => console.error(m), everyMs, when = () => true } = {}) {
  const profileDir = paths.profileDir(profile);
  const port = () => liveMod.readPort(profileDir);
  const w = memcap.createWatch({
    profile,
    profilesDir: paths.profilesDir,
    eventsFile: path.join(paths.ROOT, 'run', 'memcap.jsonl'),
    sessionPid,
    via, // script = 지킴이(앱이 세션에도 한 줄) · mcp = 래퍼(도구 결과 꼬리로 이미 안다)
    running: () => when() && chromeRunning(profileDir),
    ps: memcap.psText,
    caps: () => memcap.readCaps(paths.dataDir()),
    trim: (pid) => trimRenderer(port(), pid),
    tabs: () => listTabs(port()),
    kill: (pid) => killChrome(pid),
    now: Date.now,
    log,
    everyMs,
  });
  const stop = w.start();
  return { ...w, stop };
}

module.exports = { attach, trimRenderer, killChrome, listTabs, chromeRunning, bare };
