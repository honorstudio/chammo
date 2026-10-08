// 스크립트가 쓰는 크롬 — `chammo-browser launch <프로필>` (2026-10-06 아이맥 project-x: 스크립트 5개가 크롬을 직접 띄워 앱에 안 보이고
// 프로필 락도 안 잡았다). 세션의 브라우저 도구(MCP 래퍼)와 같은 프로필·같은 락·같은 크롬 인자·같은 앱 화면 연결을 쓴다.
//
//   launch  잠금이 비었으면 '지킴이'(_hold)를 따로 띄운다 → 지킴이가 락을 잡고 크롬을 띄워 CDP 주소를 알려 주고, 앱 화면 상태 파일을 쓴다.
//           누가(다른 스크립트·세션 브라우저 도구) 이미 그 프로필 크롬을 띄워 뒀으면 그 크롬을 같이 쓴다(명부에 이름 올림, src/users.js).
//           붙을 포트가 없으면(앱에서 보기 끔) 비길 때까지 기다린다(--wait 초, 기본 120).
//   지킴이  주인 스크립트(--owner, 기본 launch 를 부른 프로세스)와 같이 쓰는 스크립트가 다 끝나거나 죽으면 크롬을 닫고 락을 돌려준다.
//           스크립트가 SIGKILL 로 죽어도 pid 가 사라지니 1초 안에 돌려준다. 지킴이가 죽으면 크롬도 같이 죽고(파이프) 락은 죽은 pid 라 다음에 치워진다
//   release 그 스크립트가 다 썼다(명부에서 뺌) — 마지막이면 지킴이가 닫는다
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const lock = require('./lock');
const paths = require('./paths');
const users = require('./users');
const liveMod = require('./live');
const channelMod = require('./channel');
const { placement, chromeLaunch, chromeArgs } = require('./window');
const { minimizePulledIn } = require('./minimize');
const { sessionChrome } = require('./appcopy');

const CLI = path.join(__dirname, '..', 'bin', 'chammo-browser.js');
const DEFAULT_WAIT = 120_000;

/** launch·_hold 인자 → { profile, owner, channel, headless, view, waitMs, session } */
function parseArgs(argv) {
  const o = { profile: null, owner: null, channel: null, headless: false, view: true, waitMs: DEFAULT_WAIT };
  const num = (flag, v) => {
    if (!/^\d{1,10}$/.test(String(v))) throw new Error(`${flag} 는 숫자여야 해요: ${v}`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s, 2) : [argv[i], undefined];
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--owner') o.owner = num(flag, val());
    else if (flag === '--session') o.session = num(flag, val());
    else if (flag === '--wait') o.waitMs = num(flag, val()) * 1000;
    else if (flag === '--channel') {
      const v = val();
      o.channel = channelMod.normalize(v);
      if (!o.channel) throw new Error(`--channel 은 chrome 또는 chrome-beta: ${v}`);
    } else if (flag === '--headless') o.headless = true;
    else if (flag === '--no-view') o.view = false;
    else if (flag.startsWith('--')) throw new Error(`모르는 옵션: ${flag}`);
    else if (!o.profile) o.profile = flag;
    else throw new Error(`인자가 너무 많아요: ${flag}`);
  }
  if (!o.profile) throw new Error('프로필 이름이 필요해요: chammo-browser launch <프로필>');
  return o;
}

/** ps 한 줄 → [부모 pid, 이름] (맥·리눅스). 못 읽으면 null */
function psOf(pid) {
  if (process.platform === 'win32') return null;
  const r = spawnSync('/bin/ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
  const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(r.stdout || '');
  return m ? [Number(m[1]), m[2]] : null;
}

/**
 * 앱이 이 크롬을 어느 세션 것으로 보일지 — 세션 프로세스 pid(= claude agents --json 의 pid, 앱 procPid).
 * Claude Code 가 도구 명령에 주는 CLAUDE_PID 가 먼저, 없으면 조상 중 이름이 claude 인 것. 못 찾으면 0(세션 칸엔 안 붙는다)
 */
function sessionPid({ env = process.env, start = process.ppid, ps = psOf } = {}) {
  if (/^\d{1,10}$/.test(String(env.CLAUDE_PID || ''))) return Number(env.CLAUDE_PID);
  let pid = start;
  for (let i = 0; i < 20 && pid > 1; i++) {
    const row = ps(pid);
    if (!row) return 0;
    if (/(^|\/)claude( |$)/.test(row[1])) return pid;
    pid = row[0];
  }
  return 0;
}

const wsOf = (port) => `ws://127.0.0.1:${port.port}${port.wsPath}`;

/**
 * 크롬 주소 받기. d = 바깥 일(테스트에서 바꾼다): readLock·isAlive·foreign·readPort·portOpen·join·spawnHolder·sleep·now.
 * 성공 { ok, wsEndpoint, shared, holder, profile, … } / 실패 { ok:false, code: 1 오류 · 2 바빠서 못 받음, error }
 */
async function launchClient(o, d) {
  const until = d.now() + o.waitMs;
  let busy = null;
  for (;;) {
    const l = d.readLock();
    const foreign = !l || !d.isAlive(l.pid) ? d.foreign() : null;
    if (foreign) {
      busy = { foreign };
    } else if (!l || !d.isAlive(l.pid)) {
      const r = await d.spawnHolder();
      if (r.ok) return r;
      if (r.reason !== 'locked') return { ...r, code: 1 }; // 남이 먼저 잡았으면(locked) 처음부터
    } else {
      busy = l;
      const port = d.readPort();
      if (port && (await d.portOpen(port.port)) && d.join(o.owner, l.pid)) {
        return { ok: true, wsEndpoint: wsOf(port), shared: true, holder: l.pid, profile: o.profile };
      }
    }
    if (d.now() >= until) {
      if (busy && busy.foreign) {
        return { ok: false, code: 2, error: `'${o.profile}' 프로필을 잠금 없이 직접 띄운 크롬(pid ${busy.foreign})이 쓰고 있어요 — 크롬을 직접 띄우는 옛 스크립트일 거예요. 그 크롬이 끝날 때까지 ${Math.round(o.waitMs / 1000)}초 기다렸어요` };
      }
      const who = busy ? `pid ${busy.pid}${busy.by ? ` · ${busy.by}` : ''}${busy.startedAt ? ` · ${busy.startedAt}` : ''}` : '다른 곳';
      return { ok: false, code: 2, error: `'${o.profile}' 프로필을 ${who} 가 쓰고 있고 같이 쓸 크롬 주소가 없어요(앱에서 보기가 꺼진 세션 등) — 끝날 때까지 ${Math.round(o.waitMs / 1000)}초 기다렸어요` };
    }
    await d.sleep(500);
  }
}

/** 지킴이를 따로(분리) 띄우고 첫 줄(JSON)을 받는다. 그 뒤 지킴이는 launch 와 상관없이 산다 */
function spawnHolder(o) {
  return new Promise((resolve) => {
    const runDir = path.join(paths.ROOT, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    const logFile = path.join(runDir, `${o.profile}.hold.log`);
    const err = fs.openSync(logFile, 'a');
    const args = [CLI, '_hold', o.profile, '--owner', String(o.owner), '--session', String(o.session || 0)];
    if (o.channel) args.push('--channel', o.channel);
    if (o.headless) args.push('--headless');
    if (!o.view) args.push('--no-view');
    const child = spawn(process.execPath, args, { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', err], env: process.env });
    fs.closeSync(err);
    let buf = '';
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* 이미 끝남 */ }
      finish({ ok: false, error: `지킴이가 60초 안에 크롬을 못 띄웠어요 — ${logFile}` });
    }, 60_000);
    child.stdout.on('data', (c) => {
      buf += c;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try { finish(JSON.parse(buf.slice(0, i))); } catch { finish({ ok: false, error: buf.slice(0, i) }); }
    });
    child.on('exit', (code) => finish({ ok: false, error: `지킴이가 크롬을 못 띄우고 끝났어요(code ${code}) — ${logFile}` }));
  });
}

/**
 * 크롬이 프로필에 남기는 SingletonLock(호스트-pid 링크)에서 살아 있는 크롬 pid — 이 기계 것만. 없으면 null.
 * 잠금 없이 직접 띄운 크롬(옛 스크립트)이 쥐고 있으면 새 크롬은 '기존 브라우저 세션에서 여는 중'으로 바로 꺼진다
 */
function singletonPid(profileDir) {
  let t;
  try { t = fs.readlinkSync(path.join(profileDir, 'SingletonLock')); } catch { return null; }
  const m = /^(.*)-(\d+)$/.exec(t);
  if (!m || m[1] !== require('os').hostname()) return null;
  const pid = Number(m[2]);
  return lock.isAlive(pid) ? pid : null;
}

function realDeps(o) {
  const profileDir = paths.profileDir(o.profile);
  return {
    readLock: () => lock.list({ lockDir: paths.locksDir }).find((l) => l.profile === o.profile) || null,
    isAlive: lock.isAlive,
    readPort: () => liveMod.readPort(profileDir),
    foreign: () => singletonPid(profileDir),
    portOpen: (p) => liveMod.portOpen(p, 1000),
    join: (owner, holder) => users.join(paths.locksDir, o.profile, owner, holder),
    spawnHolder: () => spawnHolder(o),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  };
}

/** 이 도구가 고정한 playwright-core(@playwright/mcp 의 것) — 지킴이와 node 도우미가 쓴다. Chrome for Testing 은 안 받는다(채널만) */
function playwrightCore() {
  const mcp = path.dirname(require.resolve('@playwright/mcp/package.json'));
  return require(require.resolve('playwright-core', { paths: [mcp] }));
}

async function waitPort(profileDir, ms) {
  for (let t = 0; t < ms; t += 100) {
    const p = liveMod.readPort(profileDir);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** 탭 목록 글(MCP 응답 모양) — live.parseResult 가 읽는다. 값은 주소·제목뿐 */
function tabsText(pages, current, titles = new Map()) {
  return pages.map((p, i) => `- ${i}: ${p === current ? '(current) ' : ''}[${String(titles.get(p) || '').replace(/[[\]\n]/g, ' ')}](${p.url()})`).join('\n');
}

/**
 * 지킴이 — 락을 잡고 크롬을 띄워 첫 줄로 주소를 알린 뒤, 사용자(스크립트)가 다 끝날 때까지 지킨다.
 * out = 첫 줄 쓰기(launch 가 읽는다). 이 뒤로 stdout 엔 아무것도 안 쓴다(launch 가 끊고 간다)
 */
async function hold(o, { out = (r) => process.stdout.write(`${JSON.stringify(r)}\n`), log = (m) => console.error(`[chammo-browser hold ${o.profile}] ${m}`) } = {}) {
  const { profile, owner } = o;
  const lockDir = paths.locksDir;
  const profileDir = paths.profileDir(profile);
  const got = lock.acquire(profile, { lockDir, meta: { by: 'script', owner } });
  if (!got.ok) return out({ ok: false, reason: 'locked', holder: got.holder });

  let ctx = null;
  let live = null;
  let closing = false;
  let tick = null;
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  async function shutdown(why) {
    if (closing) return;
    closing = true;
    if (tick) clearInterval(tick);
    log(`닫음: ${why}`);
    if (ctx) await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    if (live) live.closed();
    else fs.rmSync(portFile, { force: true });
    users.clear(lockDir, profile);
    lock.release(profile, { lockDir });
    process.exit(0);
  }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(sig));
  process.on('SIGHUP', () => {}); // 터미널이 닫혀도 주인 스크립트가 살아 있으면 지킨다
  process.stdout.on('error', () => {}); // launch 가 먼저 끊고 가도

  try {
    users.clear(lockDir, profile); // 지난 크롬 명부(죽은 지킴이가 남긴 것)
    users.add(lockDir, profile, owner);
    fs.mkdirSync(profileDir, { recursive: true });
    const pick = channelMod.pickChannel({ profileDir, want: o.channel });
    if (pick.warn) log(pick.warn);
    // 맥이면 래퍼와 같은 'Chammo Browser' 사본으로 — Dock·⌘Tab 에서 사용자 크롬과 갈리게(src/appcopy.js). 채널은 그대로
    const picked = sessionChrome(chromeLaunch(pick.channel ? { env: { ...process.env, CHAMMO_BROWSER_CHANNEL: pick.channel } } : {}));
    if (!picked.found) throw new Error('이 기계엔 세션 브라우저(크롬)가 없어요 — Chammo 설정 > 브라우저 자동화에서 "설치"를 눌러 주세요');
    const channel = picked.channel || 'chrome';
    // 창 자리는 MCP 래퍼와 같은 규칙(가짜 화면 → 화면 밖) — --no-view 는 앱 화면 연결만 끈다(창은 그대로 사람 화면 밖)
    const feature = liveMod.enabled(paths.dataDir());
    const appHere = fs.existsSync(path.join(paths.dataDir(), 'config.json'));
    const place = o.headless ? { pos: null, size: null, offPos: null } : placement({ profile, watchable: feature, appHere, vdFile: path.join(paths.ROOT, 'vdisplay.json') });
    live = feature && o.view ? liveMod.createLive({ profile, root: paths.ROOT, profileDir, pid: process.pid, ppid: o.session || 0 }) : null;
    if (live) live.reset();
    else fs.rmSync(portFile, { force: true }); // 지난 크롬이 남긴 포트로 엉뚱한 주소를 알리지 않게
    const { chromium } = playwrightCore();
    ctx = await chromium.launchPersistentContext(profileDir, {
      ...(picked.executablePath ? { executablePath: picked.executablePath } : { channel }),
      headless: !!o.headless,
      viewport: null, // 크롬 창 그대로 — 지킴이가 화면 크기를 흉내 내면 스크립트 페이지에도 걸린다
      args: chromeArgs(place.pos, true, place.size),
    });
    channelMod.remember(profileDir, channel);
    const port = await waitPort(profileDir, 15_000);
    if (!port) throw new Error('크롬이 CDP 포트를 안 알려 줬어요');
    out({ ok: true, wsEndpoint: wsOf(port), shared: false, holder: process.pid, profile, channel, ...(pick.warn ? { warn: pick.warn } : {}) });

    ctx.on('close', () => shutdown('크롬이 닫힘'));
    if (place.offPos && live) for (const ms of [0, 1500, 4000]) setTimeout(() => minimizePulledIn(port, place.offPos).catch(() => {}), ms).unref();
    if (live) {
      // 앱 화면 상태 — 페이지 이동마다 지금 주소·탭(MCP 래퍼가 도구 응답으로 적는 것과 같은 모양)
      const titles = new WeakMap();
      const report = async (page) => {
        if (closing) return;
        titles.set(page, await page.title().catch(() => ''));
        live.onCall('script', { url: page.url() });
        live.onResult('script', { content: [{ type: 'text', text: `- Page URL: ${page.url()}\n- Page Title: ${titles.get(page)}\n${tabsText(ctx.pages(), page, titles)}` }] });
      };
      const watch = (page) => {
        // 다른 손님(세션 도구·CDP)이 주소를 주고 연 탭은 첫 이동이 감시 전에 끝날 수 있다 — 뜬 뒤 한 번 적는다
        page.waitForLoadState('domcontentloaded').then(() => report(page), () => {});
        page.on('framenavigated', (f) => { if (f === page.mainFrame()) report(page).catch(() => {}); });
        page.on('close', () => { const p = ctx.pages()[0]; if (p) report(p).catch(() => {}); });
      };
      ctx.pages().forEach(watch);
      ctx.on('page', watch);
      live.onCall('script', {});
      live.onResult('script', { content: [] });
    }
    // 사용자(주인·같이 쓰는 스크립트)가 다 끝나면 닫는다
    tick = setInterval(() => {
      let done = false;
      try { done = users.claimClose(lockDir, profile); } catch { /* 자물쇠가 바쁘면 다음 번에 */ }
      if (done) shutdown('스크립트가 다 끝남');
    }, 1000);
  } catch (e) {
    log(e.stack || e.message);
    // 플레이라이트 오류는 크롬 명령줄·로그가 통째로 붙어 수십 줄이다 — 한 줄로. 같은 프로필을 잠금 없이 쥔 크롬이 있으면 크롬이 바로 꺼진다
    const handed = /existing browser session|기존 브라우저 세션|exitCode=0/.test(e.message);
    out({ ok: false, error: handed ? `'${profile}' 프로필을 잠금 없이 직접 띄운 크롬이 쓰고 있어요(옛 스크립트?) — 그 크롬이 끝난 뒤 다시` : String(e.message).split('\n')[0] });
    await shutdown('띄우기 실패');
  }
}

module.exports = { parseArgs, sessionPid, singletonPid, launchClient, spawnHolder, realDeps, hold, playwrightCore, tabsText, CLI, DEFAULT_WAIT };
