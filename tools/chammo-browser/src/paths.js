// 프로필·락 저장 위치.
// 앱과 같은 데이터 폴더 규칙을 따른다: $CHAMMO_HOME → ~/.chammo (→ 예전 설치면 ~/.honor-orchestrator)
// 그 아래 browser/ 에 profiles/·locks/ 를 둔다. CHAMMO_BROWSER_HOME 이 있으면 그게 이긴다(테스트·커스텀).
const fs = require('fs');
const os = require('os');
const path = require('path');
const apphome = require('./apphome');

// '~' 로 시작하면 홈으로 푼다 (환경변수에 ~ 를 그대로 적는 경우가 흔하다)
function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };

let warned = false;

/** 앱 데이터 폴더 — app/hq-template/scripts/show 의 data_dir 과 같은 규칙.
 * CHAMMO_HOME 이 claude 데몬에서 물려받은 시험 폴더(그 앱은 꺼짐)면 기본 폴더로 — src/apphome.js. probe 를 안 주면 진짜 프로세스 표로 보되,
 * env 를 따로 준 부름(시험)은 안 본다 */
function dataDir({ home = os.homedir(), env = process.env, exists = isDir, probe } = {}) {
  const fresh = path.join(home, '.chammo');
  const legacy = path.join(home, '.honor-orchestrator');
  const fallback = !exists(fresh) && exists(legacy) ? legacy : fresh;
  const fromEnv = (env.CHAMMO_HOME || '').trim();
  if (!fromEnv) return fallback;
  const p = probe !== undefined ? probe : env === process.env ? (liveProbe ??= apphome.realProbe(env, home)) : null;
  const { dir, warn } = apphome.decide({ value: fromEnv, dir: expandHome(fromEnv, home), fallback, probe: p });
  if (warn && !warned && probe === undefined) {
    warned = true;
    console.error(warn); // stdout 은 MCP 통신 줄이라 stderr 로
  }
  return dir;
}
let liveProbe;

/** 프로필·락 루트 = CHAMMO_BROWSER_HOME 또는 <데이터 폴더>/browser */
function browserRoot(opts = {}) {
  const { home = os.homedir(), env = process.env } = opts;
  const fromEnv = (env.CHAMMO_BROWSER_HOME || '').trim();
  if (fromEnv) return expandHome(fromEnv, home);
  return path.join(dataDir(opts), 'browser');
}

/**
 * 프로필 이름 검사. 프로필 이름은 폴더 이름·락 파일 이름이 되므로 경로를 벗어나면 안 된다.
 * 문제 없으면 null, 있으면 사람이 읽을 이유 문자열.
 */
function checkProfile(name) {
  if (typeof name !== 'string' || name.length === 0) return '프로필 이름이 비어 있습니다';
  if (/[/\\\0]/.test(name)) return `프로필 이름에 / \\ 같은 경로 문자를 쓸 수 없습니다: ${name}`;
  if (name.startsWith('.')) return `프로필 이름은 . 으로 시작할 수 없습니다: ${name}`;
  return null;
}

const ROOT = browserRoot();

module.exports = {
  ROOT,
  profilesDir: path.join(ROOT, 'profiles'),
  locksDir: path.join(ROOT, 'locks'),
  profileDir: (name) => path.join(ROOT, 'profiles', name),
  dataDir,
  browserRoot,
  checkProfile,
};
