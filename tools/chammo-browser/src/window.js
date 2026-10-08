// 크롬 창 자리 — 사용자가 일하는 화면(앞 창이 있는 화면) 말고 다른 화면이 있으면 거기, 없으면 지금 자리 근처.
// 프로젝트마다 같은 자리에 겹쳐 뜨지 않게 프로필 이름으로 조금씩 비켜 놓는다(2026-10-03 아이맥 공개판 점검).
// 화면 정보는 JXA(AppKit NSScreen) — 권한 창 없이 읽힌다. MCP 설정은 시작할 때 한 번 읽으므로 세션을 켤 때 정해진다.
const { spawnSync } = require('child_process');
const { featureArgs } = require('./features');

const STEP = 36;
const BASE = [24, 48]; // 화면 왼쪽 위에서 — 메뉴 막대 아래

function offsetFor(profile) {
  let h = 0;
  for (const c of String(profile)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return (h % 6) * STEP;
}

const same = (a, b) => a && b && a.every((v, i) => v === b[i]);

/**
 * screens·main 은 코코아 좌표 [x, y, w, h](주 화면 왼쪽 아래 원점, y 위로). screens[0] = 주 화면.
 * 돌려주는 값은 크롬 --window-position 좌표 [왼쪽, 위](주 화면 왼쪽 위 원점, y 아래로). 모르면 null
 */
function windowPosition(info) {
  if (!info || !Array.isArray(info.screens) || info.screens.length === 0) return null;
  const { screens, profile } = info;
  const target = targetScreen(info);
  const primaryH = screens[0][3];
  const top = primaryH - (target[1] + target[3]);
  const off = offsetFor(profile);
  return [target[0] + BASE[0] + off, top + BASE[1] + off];
}

/** 크롬 창이 들어갈 화면 — windowPosition 과 같은 고르기(일하는 화면 말고 다른 화면) */
function targetScreen(info) {
  const { screens, main } = info;
  const other = screens.length > 1 ? screens.find((s) => !same(s, main)) : null;
  return other || main || screens[0];
}

const MAX_W = 1400;
const MAX_H = 880;
const MARGIN = 16;

/**
 * 크롬 창 크기 [폭, 높이] — 그 화면 안에 다 들어오게(오른쪽·아래 MARGIN 남기고), 최대 1400x880.
 * 크기를 안 주면 크롬이 지난 크기(1282x923 등)로 떠서 맥북 화면 밖으로 넘치거나 아래가 잘렸다(2026-10-03 사용자 "화면 밖으로 나가는 것도")
 */
function windowSize(info, pos) {
  if (!info || !Array.isArray(info.screens) || info.screens.length === 0 || !pos) return null;
  const t = targetScreen(info);
  const top = info.screens[0][3] - (t[1] + t[3]);
  const w = Math.min(MAX_W, t[0] + t[2] - pos[0] - MARGIN);
  const h = Math.min(MAX_H, top + t[3] - pos[1] - MARGIN);
  return w > 200 && h > 200 ? [Math.floor(w), Math.floor(h)] : null;
}

/** 앱의 chammo-vdisplay 도우미가 만드는 가짜 화면 이름(tools/chammo-vdisplay main.swift desc.name) */
const VD_NAME = 'Chammo agents';

/**
 * 가상 모니터(앱의 chammo-vdisplay 도우미가 만든 눈에 안 보이는 화면)에 크롬 창을 띄울 자리 {pos, size}, 없으면 null(다른 자리로).
 * 자리는 그때 화면 목록(screens = macScreens)의 'Chammo agents' 화면에서 읽는다 — 앱이 적는 <데이터>/browser/vdisplay.json 값은
 * 낡을 수 있어서(2026-10-06 [0,0,…] 으로 남아 세션 크롬이 LG 화면 24,24 에 떴다), 그 화면이 진짜 화면과 겹쳐도 안 쓴다.
 * 자리 파일이 지워졌어도 가짜 화면이 떠 있으면 거기에(진짜 데이터 폴더로 뜬 다른 앱 벌이 지웠다).
 * 화면 목록을 못 읽을 때(osascript 실패·이름 없는 목록)만 자리 파일 {pid, bounds:[x,y,w,h]}(크롬 좌표) — 도우미가 살아 있을 때
 */
function virtualDisplay(file, alive = pidAlive, screens = macScreens) {
  const info = screens();
  if (info && Array.isArray(info.screens) && Array.isArray(info.names)) return fit(namedScreen(info));
  let v;
  try { v = JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { return null; }
  const b = v && Array.isArray(v.bounds) && v.bounds.length === 4 && v.bounds.every(Number.isFinite) ? v.bounds : null;
  if (!b || !Number.isInteger(v.pid) || !alive(v.pid)) return null;
  return fit(b);
}

/** 화면 목록에서 가짜 화면을 크롬 좌표 [왼쪽, 위, 폭, 높이]로 — 없거나 다른 화면과 겹치면(면적이 생기면) null */
function namedScreen({ screens, names }) {
  const i = names.indexOf(VD_NAME);
  if (i < 0 || !screens[i] || !screens[0]) return null;
  const primaryH = screens[0][3];
  const top = (s) => [s[0], primaryH - (s[1] + s[3]), s[2], s[3]];
  const r = top(screens[i]);
  const hit = (o) => r[0] < o[0] + o[2] && o[0] < r[0] + r[2] && r[1] < o[1] + o[3] && o[1] < r[1] + r[3];
  return screens.some((s, j) => j !== i && hit(top(s))) ? null : r;
}

function fit(b) {
  if (!b || b[2] < 800 || b[3] < 600) return null;
  return { pos: [b[0] + 24, b[1] + 24], size: [Math.min(MAX_W, b[2] - 46), Math.min(MAX_H, b[3] - 48)] };
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * 세션 크롬 채널 — 크롬 베타가 깔려 있으면 'chrome-beta', 아니면 null(플레이라이트 기본 = 일반 크롬).
 * 세션 크롬이 일반 크롬이면 사용자가 Dock 에서 크롬을 눌렀을 때 맥이 세션 크롬을 앞으로 가져와 사용자 프로필로 못 갔다(2026-10-03).
 * 베타는 번들이 달라(com.google.Chrome.beta) 안 섞인다. 둘 다 구글이 서명한 진짜 크롬 — Chrome for Testing·Chromium 은 받지 않는다.
 * CHAMMO_BROWSER_CHANNEL=chrome|chrome-beta 로 고정
 */
function chromeChannel(opts = {}) {
  return chromeLaunch(opts).channel;
}

/**
 * 세션 크롬 고르기 — { channel, executablePath, found }. 베타 먼저, 없으면 일반 크롬.
 * 플레이라이트의 채널은 맥에서 /Applications 만 보므로 ~/Applications(관리자 아닌 계정에 앱이 깐 자리)면 실행 파일 경로를 같이 준다.
 * found = 크롬이 하나라도 있나 — 없으면 래퍼가 브라우저 도구를 '설치' 안내로 막는다(플레이라이트의 관리자 설치 안내로 새지 않게)
 */
function chromeLaunch({ platform = process.platform, exists = (p) => require('fs').existsSync(p), env = process.env, home = require('os').homedir() } = {}) {
  const forced = (env.CHAMMO_BROWSER_CHANNEL || '').trim();
  const at = (channel, executablePath = null) => ({ channel, executablePath, found: true });
  if (platform === 'darwin') {
    const app = (dir, name) => ({ dir: `${dir}/${name}.app`, exe: `${dir}/${name}.app/Contents/MacOS/${name}` });
    const beta = forced === 'chrome' ? [] : [app('/Applications', 'Google Chrome Beta'), app(`${home}/Applications`, 'Google Chrome Beta')];
    const stable = [app('/Applications', 'Google Chrome'), app(`${home}/Applications`, 'Google Chrome')];
    const b = beta.findIndex((a) => exists(a.dir));
    if (b >= 0) return at('chrome-beta', b === 0 ? null : beta[b].exe);
    if (forced === 'chrome-beta') return at('chrome-beta');
    const s = stable.findIndex((a) => exists(a.dir));
    if (s >= 0) return at(null, s === 0 ? null : stable[s].exe);
    return { channel: null, executablePath: null, found: false };
  }
  const roots = platform === 'win32' ? ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'].filter((k) => env[k]).map((k) => env[k]) : [];
  const beta = platform === 'win32' ? roots.map((r) => `${r}\\Google\\Chrome Beta\\Application\\chrome.exe`) : ['/opt/google/chrome-beta/chrome'];
  const stable = platform === 'win32' ? roots.map((r) => `${r}\\Google\\Chrome\\Application\\chrome.exe`) : ['/opt/google/chrome/chrome'];
  if (forced !== 'chrome' && (forced === 'chrome-beta' || beta.some((p) => exists(p)))) return at('chrome-beta');
  return stable.some((p) => exists(p)) ? at(null) : { channel: null, executablePath: null, found: false };
}

const JXA = `ObjC.import("AppKit");
const f = (s) => { const r = s.frame; return [r.origin.x, r.origin.y, r.size.width, r.size.height]; };
const all = $.NSScreen.screens; const out = [];
const names = [];
for (let i = 0; i < all.count; i++) { const s = all.objectAtIndex(i); out.push(f(s)); names.push(s.localizedName.js); }
JSON.stringify({ screens: out, names, main: f($.NSScreen.mainScreen) })`;

function macScreens() {
  const r = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA], { encoding: 'utf8', timeout: 3000 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// --test-type: 진짜 크롬이 Playwright 의 --disable-blink-features=AutomationControlled 에 띄우는
// '지원되지 않는 명령줄 플래그' 경고 띠를 숨긴다. 그 플래그는 봇 탐지(navigator.webdriver)를 피하려는 것이라 빼지 않는다
// --remote-debugging-port=0: 세션 브라우저 앱에서 보기(src/live.js) — 크롬이 빈 포트를 골라 프로필 DevToolsActivePort 에 적는다.
// 창 있는 크롬은 127.0.0.1 에만 열고, 웹 페이지(Origin 붙은 접속)는 크롬이 거절한다. playwright 는 -pipe 만 거절하고 -port 는 통과
// 맥이면 code sign clone 끄기(src/features.js — 안 끄면 '앱 관리' 차단 알림이 앱 이름으로 뜬다)
function chromeArgs(pos, debugPort = false, size = null, platform = process.platform) {
  const a = ['--test-type'];
  if (pos) a.push(`--window-position=${pos[0]},${pos[1]}`);
  if (pos && size) a.push(`--window-size=${size[0]},${size[1]}`);
  if (debugPort) a.push('--remote-debugging-port=0');
  a.push(...featureArgs(platform));
  return a;
}

/**
 * 가짜 화면 자리를 몇 초 기다린다 — 앱이 다시 켜지는 사이·도우미가 막 뜨는 중이면 곧 생긴다. 안 기다리면 그 사이 뜬 세션 크롬이
 * 사용자 화면에 보였다(2026-10-03, 맥북 하나일 때). read 는 virtualDisplay 를 부르는 함수, sleep 은 동기(시작할 때 한 번이라 막아도 된다)
 */
function waitVirtualDisplay(read, { ms = 3000, step = 100, sleep = sleepSync, now = Date.now } = {}) {
  // 읽기(화면 목록 osascript ~120ms)에 걸린 시간도 센다 — 횟수로 세면 가짜 화면이 끝내 없는 기계에서 세션이 두 배 넘게 늦게 떴다
  const start = now();
  for (;;) {
    const v = read();
    if (v || now() - start >= ms) return v || null;
    sleep(step);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 화면 밖 자리(크롬 좌표) — 모든 화면 오른쪽으로 한참 바깥. 크롬·맥이 끌어오면 minimize.js 가 최소화 */
function offscreenPosition(info) {
  if (!info || !Array.isArray(info.screens) || info.screens.length === 0) return null;
  const right = Math.max(...info.screens.map((s) => s[0] + s[2]));
  return [Math.round(right + 4000), 0];
}

/**
 * 세션 크롬 창 자리·크기 — MCP 래퍼와 스크립트 지킴이(chammo-browser launch)가 같이 쓴다.
 * 세션 브라우저 앱에서 보기가 켜져 있고(watchable) 앱이 가상 모니터를 띄워 뒀으면 거기에(사용자 화면 어디에도 안 보이게), 아니면 비켜 놓은 자리.
 * 앱이 있는 맥이면(appHere) 가짜 화면 자리를 3초 기다리고 — 앱이 다시 켜지는 사이·도우미가 막 뜨는 중이면 곧 생긴다 —
 * 그래도 없으면 화면 밖에(사용자 화면에 안 뜨게, 2026-10-03 맥북 하나일 때). 앱이 아예 없는 기계는 보이는 자리.
 * offPos = 화면 밖에 띄웠으면 그 자리(크롬이 끌어오면 minimize.js 가 최소화)
 */
function placement({ profile, watchable, appHere, vdFile, mac = process.platform === 'darwin' }) {
  const vd = mac && watchable ? (appHere ? waitVirtualDisplay(() => virtualDisplay(vdFile)) : virtualDisplay(vdFile)) : null;
  const screens = mac && !vd ? { ...(macScreens() || {}), profile } : null;
  const offPos = mac && watchable && appHere && !vd ? offscreenPosition(screens) : null;
  const pos = vd ? vd.pos : offPos || (screens ? windowPosition(screens) : null);
  const size = vd ? vd.size : offPos ? [1280, 800] : screens ? windowSize(screens, pos) : null;
  return { pos, size, offPos };
}

module.exports = { placement, offsetFor, windowPosition, windowSize, virtualDisplay, chromeChannel, chromeLaunch, chromeArgs, macScreens, waitVirtualDisplay, offscreenPosition };
