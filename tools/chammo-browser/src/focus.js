// 브라우저가 뜰 때 크롬이 맨 앞 앱이 돼 사용자 입력칸 포커스를 뺏는다(2026-10-03 아이맥 공개판 점검).
// 도구 호출 앞뒤로 앞 앱을 보고, 그 사이 크롬이 앞으로 왔으면 원래 앞 앱으로 되돌린다. macOS 만.
// 권한 창이 안 뜨는 길만 쓴다: 읽기 lsappinfo, 되돌리기 open -b(LaunchServices). osascript 로 다른 앱에
// activate 를 보내면 자동화 권한 창이 뜬다.
const { spawnSync } = require('child_process');

const BROWSER_IDS = ['com.google.Chrome', 'com.google.Chrome.beta', 'com.google.Chrome.dev', 'com.google.Chrome.canary'];

function parseBundleId(out) {
  // macOS 26: "CFBundleIdentifier"="…" · macOS 27: bundleID="…"
  const m = /(?:"CFBundleIdentifier"|bundleID)="([^"]+)"/.exec(out || '');
  return m ? m[1] : null;
}

function macFront() {
  const run = (args) => spawnSync('/usr/bin/lsappinfo', args, { encoding: 'utf8', timeout: 2000 });
  const asn = (run(['front']).stdout || '').trim();
  if (!asn) return null;
  return parseBundleId(run(['info', '-only', 'bundleid', asn]).stdout);
}

function macActivate(id) {
  spawnSync('/usr/bin/open', ['-b', id], { timeout: 3000 });
}

/**
 * 겹친 호출은 처음 시작 때 앞 앱을 기억하고, 마지막 끝에서 크롬이 앞이면 되돌린다.
 * 사용자가 원래 크롬을 보고 있었거나 그 사이 다른 앱으로 옮겼으면 건드리지 않는다.
 */
function createFocusGuard({ front = macFront, activate = macActivate, browserIds = BROWSER_IDS } = {}) {
  let depth = 0;
  let before = null;
  return {
    start() {
      if (depth++ === 0) before = front();
    },
    end() {
      if (depth === 0 || --depth > 0) return;
      const was = before;
      before = null;
      if (!was || browserIds.includes(was)) return;
      if (browserIds.includes(front())) activate(was);
    },
  };
}

module.exports = { parseBundleId, createFocusGuard, BROWSER_IDS };
