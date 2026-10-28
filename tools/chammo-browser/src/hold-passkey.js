// 서랍 '참모 브라우저'(지킴이 _hold)의 패스키 전환(2026-10-29) — MCP 래퍼(bin/chammo-browser-mcp.js)와 같은 winshow·passkey-auto·감시를 쓴다.
// winshow 가 부르는 세 도구(browser_tabs·browser_close·browser_navigate)를 지킴이 크롬 위에서 흉내 낸다.
// 바꾸면 크롬이 다시 떠 붙어 있던 CDP 손님이 끊긴다 — 주인이 앱(서랍)이고 명부에 다른 사용자(스크립트·같이 쓰는 세션)가 없을 때만.
// 아니면 안 바꾸고 크롬 패스키 창(QR·보안 키) 그대로 — 칸 카드도 그 안내
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const users = require('./users');
const lock = require('./lock');
const liveMod = require('./live');
const { createWinShow, SIGNED } = require('./winshow');
const { createPasskeyWatch } = require('./passkey');
const { createPasskeyAuto } = require('./passkey-auto');

/** 바꿔도 되나 — 주인이 앱(app-alive.json pid)이고 명부엔 주인 하나 */
function canSwitchHold({ owner, appPid, users: alive }) {
  return !!owner && owner === appPid && alive.length === 1 && alive[0] === owner;
}

/** 앱 표식의 pid — 없으면 null */
function appPid(dataDir) {
  try {
    const n = Number(JSON.parse(fs.readFileSync(path.join(dataDir, 'app-alive.json'), 'utf8')).pid);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 프로필 잠금(SingletonLock = '<호스트>-<pid>')을 쥔 프로세스가 크롬인가 — 크롬 경로를 인자로 든 다른 프로세스(node 래퍼)를 잘못 끄지 않게 실행 파일 이름으로 */
function chromePid(pid) {
  const comm = (spawnSync('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).stdout || '').trim();
  return /(Google Chrome|Chammo Browser|Chromium)[^/]*$/.test(comm);
}

/**
 * 닫은 크롬이 프로필 잠금을 놓을 때까지 — 놓기 전에 열면 둘째 크롬이 '기존 세션에서 여는 중'으로 조용히 끝난다(실측).
 * 쥔 pid 가 죽었으면 바로(크롬이 남은 잠금을 스스로 치운다). 산 크롬이 waitMs 넘게 안 놓으면 그 크롬을 끄고 조금 더 — 10초에 포기하고 열면
 * 새 크롬이 꺼져 지킴이가 통째로 끝났다(0.4.4 리뷰). 풀렸으면 true
 */
async function waitProfileFree(profileDir, {
  waitMs = 30_000, killWaitMs = 5000, step = 200,
  readLink = (f) => fs.readlinkSync(f), alive = lock.isAlive, isChrome = chromePid, kill = (pid) => process.kill(pid, 'SIGKILL'),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {},
} = {}) {
  const file = path.join(profileDir, 'SingletonLock');
  let until = now() + waitMs;
  let killed = false;
  for (;;) {
    let t;
    try { t = readLink(file); } catch { return true; }
    const m = /-(\d+)$/.exec(t);
    const pid = m ? Number(m[1]) : 0;
    if (!pid || !alive(pid)) return true;
    if (now() >= until) {
      if (killed || !isChrome(pid)) { log(`[chammo-browser] 프로필 잠금을 pid ${pid} 가 안 놓는다 — 그대로 연다`); return false; }
      log(`[chammo-browser] 닫은 크롬(pid ${pid})이 ${Math.round(waitMs / 1000)}초 넘게 프로필을 쥐고 있어 끈다`);
      try { kill(pid); } catch { /* 이미 끝남 */ }
      killed = true;
      until = now() + killWaitMs;
    }
    await sleep(step);
  }
}

/** winshow 의 call — tabs()=탭 목록 글(script.js tabsText), close()=크롬 닫기, open(url)=다시 띄워 그 주소 */
function createHoldCall({ tabs, close, open }) {
  const ok = (text = '') => ({ content: [{ type: 'text', text }] });
  const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String((e && e.message) || e) }] });
  return async (name, args = {}) => {
    try {
      if (name === 'browser_tabs') return ok(tabs());
      if (name === 'browser_close') { await close(); return ok(); }
      if (name === 'browser_navigate') { await open(args.url); return ok(); }
      return fail(`지킴이는 ${name} 을 안 한다`);
    } catch (e) {
      return fail(e);
    }
  };
}

/**
 * 지킴이에 패스키 전환을 붙인다 — 앱 '이번만 구글 크롬'·'돌아오기'(<live>/<프로필>.signed)와 페이지 패스키 부름(감시) 둘 다
 * @param {{ profile:string, profileDir:string, owner:number, lockDir:string, dataDir:string, liveDir:string, live:object, call:Function, log:(m:string)=>void }} o
 */
function startHoldPasskey({ profile, profileDir, owner, lockDir, dataDir, liveDir, live, call, log, every = 1000 }) {
  const ok = (alive) => canSwitchHold({ owner, appPid: appPid(dataDir), users: alive });
  const can = () => ok(users.alive(lockDir, profile));
  // 다시 띄우기 직전 — 손님 확인과 같이 쓰기 막기 표시를 명부 자물쇠 안에서 한 번에(밖에서 보면 확인과 닫기 사이에 붙은 스크립트 주소가 죽었다, 0.4.4 리뷰).
  // 바뀐 사이 손님이 붙었으면 돌아오기는 미뤘다가 손님이 떠나면(winshow 가 기억) — '다 했어' 표는 바로 남는다
  const claim = () => { try { return users.claimSwitch(lockDir, profile, ok); } catch { return false; } };
  const winshow = createWinShow({ liveDir, profile, pid: process.pid, call, live, names: SIGNED, beforeOpen: () => waitProfileFree(profileDir, { log }), claim, release: () => users.clearClose(lockDir, profile), log });
  live.signable();
  let watch = null;
  const passkey = createPasskeyAuto({ winshow, url: (t) => watch.url(t), canSwitch: can, log });
  watch = createPasskeyWatch({
    readPort: () => liveMod.readPort(profileDir),
    signed: () => winshow.shown(),
    canHold: () => passkey.ready(),
    onSignal: (phase, t) => { passkey.signal(phase, t).catch((e) => log(`패스키 자동 실패: ${e.message}`)); },
    log,
  });
  watch.tick(); // 바로 붙는다 — 1초 뒤면 지킴이가 뜨자마자 연 페이지의 부름을 놓친다(실측)
  const timer = setInterval(() => {
    winshow.tick().catch(() => {});
    if (!winshow.hold()) watch.tick();
    passkey.tick().catch(() => {});
  }, every);
  timer.unref();
  return { winshow, stop: () => { clearInterval(timer); watch.stop(); } };
}

module.exports = { canSwitchHold, appPid, createHoldCall, startHoldPasskey, waitProfileFree };
