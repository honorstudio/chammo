// 물려받은 CHAMMO_HOME 을 믿어도 되나 — claude 세션(과 그 MCP·훅)은 부른 쪽이 아니라 claude 데몬의 env 를 받는다.
// 시험이 데몬을 CHAMMO_HOME=~/.chammo-soak 로 띄우면 그 뒤 진짜 세션의 래퍼가 시험 폴더 프로필로 크롬을 띄웠다(2026-10-23 아이맥).
// 앱 쪽 막이는 사용자 설정 env 고정(app daemon_env.rs). 여기는 그게 없을 때의 둘째 막이 — 값이 데몬에서 물려받은 것이고
// 그 폴더 앱(app-alive.json)이 죽었고 기본 폴더에 앱이 있을 때만 기본 폴더로 돌린다. 일부러 준 값(시험·임시 폴더)은 그대로 둔다.
// 같은 규칙: app/hq-template/scripts/direct·routine 의 app_home
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** ps eww 출력에서 KEY= 값 — 다음 ' NAME=' 앞까지(경로에 빈칸이 있어도) */
function envFromPs(out, key) {
  const m = new RegExp(`(?:^|\\s)${key}=(.*?)(?=\\s[A-Za-z_][A-Za-z0-9_]*=|$)`, 's').exec(String(out || '').trim());
  return m ? m[1] : null;
}

/** ps etime([[dd-]hh:]mm:ss) → 초 */
function etimeSecs(s) {
  const t = String(s || '').trim();
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(t);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

/** 조상 줄(ps eww -o pid=,command=) 중 env 가 보이는 것 모두가 같은 CHAMMO_HOME 인가 — 중간에 누가 바꿨으면 물려받은 게 아니다.
 * 맥은 /bin/sh·zsh 같은 시스템 실행 파일의 env 를 안 보여 줘서(HOME= 도 없다) 그 줄은 건너뛴다. 하나도 안 보이면 false */
function sameAll(out, value) {
  const seen = String(out || '').split('\n').filter((l) => l.trim())
    .map((l) => envFromPs(l, 'CHAMMO_HOME') ?? (envFromPs(l, 'HOME') != null ? '' : null))
    .filter((v) => v != null);
  return seen.length > 0 && seen.every((v) => v.trim() === String(value).trim());
}

/** 세션 설정(사용자·프로젝트) 어디든 env.CHAMMO_HOME 이 있나 — 있으면 세션 값은 그 고정값이라 물려받은 게 아니다.
 * ps 는 세션의 처음 env(=데몬 것)만 보여 줘서, 설정으로 바뀐 값은 여기서만 안다 */
function settingsPinned({ cfg, cwd, home, read = (f) => fs.readFileSync(f, 'utf8') }) {
  const files = [path.join(cfg, 'settings.json')];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    if (d !== path.resolve(home)) files.push(path.join(d, '.claude', 'settings.json'), path.join(d, '.claude', 'settings.local.json'));
    if (path.dirname(d) === d) break;
  }
  return files.some((f) => {
    try { return !!String(JSON.parse(read(f))?.env?.CHAMMO_HOME ?? '').trim(); } catch { return false; }
  });
}

/** 순수 판단 — 돌릴 폴더 하나와 경고 글(없으면 null) */
function decide({ value, dir, fallback, probe }) {
  if (!probe || path.resolve(dir) === path.resolve(fallback)) return { dir, warn: null };
  if (!probe.inherited(value) || probe.alive(dir) || !probe.isApp(fallback)) return { dir, warn: null };
  return {
    dir: fallback,
    warn: `[chammo-browser] CHAMMO_HOME=${dir} 는 claude 데몬에서 물려받은 값이고 그 폴더 앱이 꺼져 있어 앱 폴더 ${fallback} 를 쓴다 — 데몬을 깨끗한 환경으로 다시 띄워(claude daemon stop --any --keep-workers)`,
  };
}

const sh = (args) => execFileSync('ps', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true });

/** 진짜 맥·리눅스 프로세스 표로 보는 probe. 윈도우는 ps 가 없어 null(확인 없이 env 를 믿는다) */
function realProbe(env = process.env, home = os.homedir()) {
  if (process.platform === 'win32') return null;
  const memo = new Map();
  const once = (k, f) => { if (!memo.has(k)) { try { memo.set(k, f()); } catch { memo.set(k, null); } } return memo.get(k); };
  const cfg = (env.CLAUDE_CONFIG_DIR || '').trim() || path.join(home, '.claude');
  const daemonPid = () => once('daemon', () => Number(JSON.parse(fs.readFileSync(path.join(cfg, 'daemon.lock'), 'utf8')).pid) || null);
  const ancestors = () => once('anc', () => {
    const parent = new Map(sh(['-axo', 'pid=,ppid=']).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)));
    const out = [];
    for (let p = process.pid, i = 0; p > 1 && i < 30; i++) { p = parent.get(p); if (p) out.push(p); }
    return out;
  });
  return {
    // 설정 고정이 없고, 내 조상에 데몬이 있고, 나부터 데몬까지 env 가 보이는 조상이 다 같은 값일 때만
    inherited(value) {
      if (once('pinned', () => settingsPinned({ cfg, cwd: process.cwd(), home }))) return false;
      const d = daemonPid();
      const anc = ancestors() || [];
      const at = d ? anc.indexOf(d) : -1;
      if (at < 0) return false;
      return !!once(`inh:${value}`, () => sameAll(sh(['eww', '-o', 'pid=,command=', '-p', anc.slice(0, at + 1).join(',')]), value));
    },
    alive(dir) {
      return !!once(`alive:${dir}`, () => {
        const mark = JSON.parse(fs.readFileSync(path.join(dir, 'app-alive.json'), 'utf8'));
        const up = etimeSecs(sh(['-o', 'etime=', '-p', String(mark.pid)]));
        // 번호 재사용 거름 — 표식을 쓴 뒤에 시작한 프로세스면 그 앱이 아니다
        return up != null && Date.now() / 1000 - up <= Number(mark.at) + 5;
      });
    },
    isApp: (dir) => fs.existsSync(path.join(dir, 'config.json')),
  };
}

module.exports = { envFromPs, etimeSecs, sameAll, settingsPinned, decide, realProbe };
