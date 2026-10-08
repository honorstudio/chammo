// 세션 크롬을 Dock·⌘Tab 에서 사용자 크롬과 갈리게 — 크롬(베타) 사본을 <브라우저 루트>/app/<번들id>-<판>/Chammo Browser.app 에 두고 띄운다(맥만).
// 사람이 Dock 의 크롬 베타 아이콘을 '내 브라우저'로 알고 누르던 것(사용자 2026-10-06). 헤드리스는 봇 차단·사람 로그인 때문에 안 된다.
//
// 실측(2026-10-06, 크롬 베타 156):
// - Dock 이름은 번들 폴더 이름을 따른다 → 폴더 이름만 바꾸면 'Chammo Browser'. Info.plist 를 고치면 구글 서명이 깨지니 안 고친다
// - 아이콘은 번들 밖 사용자 아이콘(NSWorkspace setIcon → 'Icon\r' + FinderInfo) — 봉인(Contents/) 밖이라 codesign·spctl(공증) 그대로 통과, entitlement 도 같다
// - APFS 복제(cp -c)라 0.9초·디스크 0. cp -c 는 복제가 안 되면 조용히 통째 복사(730MB)로 넘어가고, 노드의 FICLONE_FORCE 는 맥에서 ENOSYS 라
//   '원본과 같은 볼륨 + 그 볼륨이 APFS' 일 때만 복제한다(cloneable). 아니면 원본을 쓴다
// - 새 사본은 첫 실행이 13초(맥의 첫 실행 검사) — 만든 직후 --version 으로 미리 한 번 돌려 둔다
// - 쿠키(mock-keychain)는 원본↔사본 어느 쪽으로 열어도 남는다. 판이 같아야 프로필을 서로 연다 → 판마다 폴더를 따로 두고 원본 판이 바뀌면 새로 복제
// - 같은 번들 id 가 둘이면 LaunchServices 는 /Applications 것을 고르지만 ~/Applications 보다는 사본을 고른다 → 정품 크롬은 /Applications 것만 사본으로
//   (안 그러면 사용자 링크가 'Chammo Browser' 로 열린다). 베타는 세션 전용으로 앱이 깐 것이라 ~/Applications 도 사본으로
// - 구글 업데이터: 사본에서 chrome://settings/help 를 열면(플레이라이트 인자여도) 업데이터가 크롬 자리(ecp)를 사본으로 바꿔 등록한다 →
//   원본 대신 사본이 업데이트된다. 그래서 켤 때마다 업데이터 등록(prefs.json)을 보고 사본을 가리키면 ksadmin 으로 원본을 다시 등록한다
//   (ap·브랜드 등 다른 칸은 그대로 — 실측). 업데이터가 이미 사본을 올렸으면 사본 판이 폴더 이름과 달라지니 안 돌 때 새로 복제한다
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const APP_NAME = 'Chammo Browser';
const ICON = path.join(__dirname, '..', 'assets', 'browser-icon.svg');
const IDS = ['com.google.Chrome', 'com.google.Chrome.beta'];
const ENTRY = /^(com\.google\.Chrome(?:\.beta)?)-(\d+(?:\.\d+)*)$/;
const TMP = /^\.tmp-.+-(\d+)$/;

/** 사본으로 만들 원본 .app (없거나 안 맞으면 null) — picked 는 window.chromeLaunch() 결과 */
function sourceApp(picked, { home = os.homedir(), exists = (p) => fs.existsSync(p) } = {}) {
  if (!picked || !picked.found) return null;
  let app;
  if (picked.executablePath) {
    const m = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(picked.executablePath);
    if (!m) return null;
    app = m[1];
  } else if (picked.channel === 'chrome-beta') {
    app = '/Applications/Google Chrome Beta.app';
  } else if (!picked.channel) {
    app = '/Applications/Google Chrome.app';
  } else {
    return null;
  }
  if (!exists(app)) return null;
  const beta = path.basename(app) === 'Google Chrome Beta.app' && (app.startsWith('/Applications/') || app.startsWith(`${home}/Applications/`));
  const stable = app === '/Applications/Google Chrome.app';
  return beta || stable ? app : null;
}

/** <루트>/app/<번들id>-<판> — 모르는 번들·이상한 판(경로 문자)이면 null */
function copyDir(root, id, version) {
  if (!IDS.includes(id) || !/^\d+(\.\d+)*$/.test(version || '')) return null;
  return path.join(root, 'app', `${id}-${version}`);
}

const PRODUCTS = { 'com.google.chrome.beta': ['com.google.Chrome.beta', 'Google Chrome Beta.app'], 'com.google.chrome': ['com.google.Chrome', 'Google Chrome.app'] };

/** 업데이터 등록(prefs.json) 중 크롬 자리가 우리 사본인 것 → 되돌릴 원본 [{ productId, app, tag }]. 원본이 없으면 손대지 않는다 */
function updaterFixes(prefs, { home = os.homedir(), exists = (p) => fs.existsSync(p) } = {}) {
  const apps = prefs && prefs.updateclientdata && prefs.updateclientdata.apps;
  if (!apps || typeof apps !== 'object') return [];
  const out = [];
  for (const [key, v] of Object.entries(apps)) {
    const prod = PRODUCTS[key];
    if (!prod || !v || typeof v.ecp !== 'string' || path.basename(v.ecp) !== `${APP_NAME}.app`) continue;
    const app = ['/Applications', `${home}/Applications`].map((d) => path.join(d, prod[1])).find((p) => exists(p));
    if (app) out.push({ productId: prod[0], app, tag: typeof v.ap === 'string' ? v.ap : null });
  }
  return out;
}

/** src 를 dir 아래로 APFS 복제할 수 있나 — 같은 볼륨(st_dev)이고 그 볼륨이 apfs. 볼륨 종류 번호(f_type)는 기계마다 달라 mount 이름으로 본다 */
function cloneable(src, dir, { dev = (p) => fs.statSync(p).dev, fsType = mountType } = {}) {
  try {
    return dev(src) === dev(dir) && fsType(src) === 'apfs';
  } catch {
    return false;
  }
}

function mountType(p) {
  const df = spawnSync('/bin/df', ['-P', p], { encoding: 'utf8', timeout: 5000 }).stdout || '';
  const mnt = (df.split('\n')[1] || '').split(/\s+/).slice(5).join(' ');
  if (!mnt) return null;
  const line = (spawnSync('/sbin/mount', [], { encoding: 'utf8', timeout: 5000 }).stdout || '').split('\n').find((l) => l.includes(` on ${mnt} (`));
  const m = line && / \(([^,)]+)/.exec(line.slice(line.indexOf(` on ${mnt} (`) + mnt.length + 4));
  return m ? m[1] : null;
}

/** 지울 이름들 — 지금 것과 같은 크롬(번들 id)의 옛 판 중 안 도는 것만. 다른 채널 사본은 프로필마다 채널을 기억해 섞어 쓰니 남긴다.
 *  임시 폴더는 그 pid 가 죽었을 때만 */
function staleEntries(names, { root, current, running = [], alive = pidAlive }) {
  const cur = ENTRY.exec(current);
  return names.filter((n) => {
    const t = TMP.exec(n);
    if (t) return !alive(Number(t[1]));
    const m = ENTRY.exec(n);
    if (!m || !cur || m[1] !== cur[1] || n === current) return false;
    const dir = `${path.join(root, n)}/`;
    return !running.some((c) => c.includes(dir));
  });
}

/**
 * 세션 크롬을 사본으로 — { ...picked, executablePath: 사본 실행 파일, copy: true }. 채널은 그대로(프로필 채널 기억이 기댄다).
 * 무엇이든 안 되면 picked 를 그대로 돌려준다 — 사본 때문에 세션 브라우저가 못 뜨는 일은 없게
 */
function sessionChrome(picked, deps = {}) {
  const d = { ...defaults(), ...deps };
  try {
    if (d.platform !== 'darwin') return picked;
    for (const fix of updaterFixes(d.updaterPrefs(), d)) d.say(`appcopy: updater pointed at the copy, re-registering ${fix.app}: ${d.reRegister(fix) ? 'ok' : 'failed'}`);
    if ((d.env.CHAMMO_BROWSER_COPY || '').trim() === '0') return picked;
    const src = sourceApp(picked, d);
    const info = src && d.readInfo(src);
    const dir = info && copyDir(d.root, info.id, info.version);
    if (!dir || !info.exe || info.exe.includes('/')) return picked;
    const app = path.join(dir, `${APP_NAME}.app`);
    const exe = path.join(app, 'Contents', 'MacOS', info.exe);
    const done = { ...picked, executablePath: exe, copy: true };
    const appRoot = path.join(d.root, 'app');
    if (fs.existsSync(exe)) {
      if (d.version(app) === info.version) {
        cleanup(appRoot, path.basename(dir), d);
        return done;
      }
      // 업데이터가 사본을 올렸다 — 돌고 있으면 그대로 쓰고 다음에, 안 돌면 지우고 새로
      if (d.running().some((c) => c.includes(`${app}/`))) return done;
      d.say(`appcopy: copy version drifted, recloning ${app}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const tmp = path.join(appRoot, `.tmp-${path.basename(dir)}-${process.pid}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const staged = path.join(tmp, `${APP_NAME}.app`);
      if (!d.clone(src, staged)) {
        d.say(`appcopy: clone failed, using ${src}`);
        return picked;
      }
      let icon = false;
      try { icon = d.setIcon(staged); } catch { /* 아이콘만 못 씌울 뿐 — 이름은 바뀐다 */ }
      if (!icon) d.say('appcopy: icon not set');
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.renameSync(staged, app);
      } catch (e) {
        if (!fs.existsSync(exe)) throw e; // 남이 먼저 끝낸 게 아니면 진짜 실패
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (!fs.existsSync(exe)) return picked;
    d.warm(exe);
    cleanup(appRoot, path.basename(dir), d);
    d.say(`appcopy: ready ${app}`);
    return done;
  } catch (e) {
    d.say(`appcopy: ${(e && e.message) || e}`);
    return picked;
  }
}

// 지울 후보가 있을 때만 프로세스 목록을 읽는다(래퍼가 켤 때마다 부른다)
function cleanup(appRoot, current, d) {
  let names;
  try { names = fs.readdirSync(appRoot); } catch { return; }
  if (staleEntries(names, { root: appRoot, current, running: [], alive: () => false }).length === 0) return;
  for (const n of staleEntries(names, { root: appRoot, current, running: d.running(), alive: d.alive })) {
    fs.rmSync(path.join(appRoot, n), { recursive: true, force: true });
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function plist(app, key) {
  const r = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

// NSWorkspace setIcon 은 번들 밖(Icon\r)에 쓴다. 아이콘이 SVG 라 맥이 크기마다 그려 넣는다
const SET_ICON = 'ObjC.import("AppKit"); function run(a) { const i = $.NSImage.alloc.initWithContentsOfFile(a[0]); return !i.isNil() && $.NSWorkspace.sharedWorkspace.setIconForFileOptions(i, a[1], 0) ? "ok" : "no"; }';

function defaults() {
  const { browserRoot } = require('./paths');
  return {
    platform: process.platform,
    root: browserRoot(),
    home: os.homedir(),
    env: process.env,
    exists: (p) => fs.existsSync(p),
    readInfo: (app) => {
      const id = plist(app, 'CFBundleIdentifier');
      const version = plist(app, 'CFBundleShortVersionString');
      const exe = plist(app, 'CFBundleExecutable');
      return id && version && exe ? { id, version, exe } : null;
    },
    version: (app) => plist(app, 'CFBundleShortVersionString'),
    updaterPrefs: () => {
      try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/Google/GoogleUpdater/prefs.json'), 'utf8')); } catch { return null; }
    },
    // 업데이터의 ksadmin(사용자 저장소)으로 원본을 다시 등록 — 크롬이 스스로 등록할 때와 같은 칸(-x 자리·-a/-e 판 읽는 곳·-g 채널 꼬리표)
    reRegister: ({ productId, app, tag }) => {
      const ks = path.join(os.homedir(), 'Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle/Contents/Helpers/ksadmin');
      const v = plist(app, 'CFBundleShortVersionString');
      if (!v || !fs.existsSync(ks)) return false;
      const args = ['-U', '--register', '-P', productId, '-x', app, '-a', path.join(app, 'Contents', 'Info.plist'), '-e', 'KSVersion', '-v', v];
      if (tag) args.push('-g', tag);
      return spawnSync(ks, args, { timeout: 30_000, stdio: 'ignore' }).status === 0;
    },
    // -c = APFS clonefile. 복제가 안 되는 자리면 cp 가 통째 복사로 넘어가니 먼저 cloneable 로 거른다
    clone: (src, dest) => cloneable(src, path.dirname(dest)) && spawnSync('/bin/cp', ['-cR', src, dest], { timeout: 120_000 }).status === 0,
    setIcon: (app) => (spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SET_ICON, ICON, app], { encoding: 'utf8', timeout: 20_000 }).stdout || '').trim() === 'ok',
    // 맥의 첫 실행 검사(13초)를 세션이 브라우저를 처음 쓰기 전에 끝내 둔다 — 기다리지 않는다
    warm: (exe) => { try { spawn(exe, ['--version'], { detached: true, stdio: 'ignore' }).unref(); } catch { /* 첫 실행이 늦을 뿐 */ } },
    running: () => (spawnSync('/bin/ps', ['-axww', '-o', 'command='], { encoding: 'utf8', timeout: 5000 }).stdout || '').split('\n'),
    alive: pidAlive,
    say: (m) => process.stderr.write(`[chammo-browser] ${m}\n`),
  };
}

module.exports = { APP_NAME, sourceApp, copyDir, cloneable, mountType, staleEntries, updaterFixes, sessionChrome };
