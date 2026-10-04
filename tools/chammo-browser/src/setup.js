// 프로젝트 폴더의 .mcp.json 에 playwright 서버(= chammo-browser-mcp 래퍼)를 등록한다.
//
// - command 는 PATH 에 기대지 않는다: 지금 돌고 있는 node 의 실제 경로 + 래퍼 절대경로.
//   앱이 `node <tool>/bin/chammo-browser.js setup ...` 으로 부르기만 하면 npm link 없이 동작한다.
//   process.execPath 를 realpath 로 푸는 이유: fnm·nvm 같은 버전 관리자는 셸마다 임시 심볼릭 링크
//   (예: .../fnm_multishells/<번호>/bin/node)로 node 를 잡아 주는데, 그 링크는 셸이 끝나면 사라진다.
//   단 Homebrew 는 반대로 실제 경로가 버전 폴더(…/Cellar/node/26.8.1/bin/node)라 brew upgrade 가 옛 버전을 지우는 순간
//   모든 프로젝트의 브라우저가 안 뜬다 → 버전 없는 …/opt/<formula>/bin/node 로 바꿔 적는다(stableNode, 2026-10-03 아이맥)
// - 다른 서버·최상위 키는 그대로 두고 playwright 만 넣는다(병합). 깨진 JSON 은 덮어쓰지 않고 에러.
// - 데이터 폴더를 바꿔 둔 환경(CHAMMO_HOME / CHAMMO_BROWSER_HOME)이면 그 루트를 env 로 적어 둔다 —
//   Claude 가 래퍼를 띄울 때 같은 환경변수를 물려받는다는 보장이 없어서다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { browserRoot, checkProfile, dataDir } = require('./paths');

const SERVER = 'playwright';
const defaultWrapper = () => fs.realpathSync(path.join(__dirname, '..', 'bin', 'chammo-browser-mcp.js'));

/** Homebrew Cellar 버전 폴더 → 같은 formula 의 opt 링크(있을 때만). 그 밖은 그대로 */
function stableNode(real, exists = fs.existsSync) {
  const m = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(real);
  if (!m) return real;
  const opt = `${m[1]}/opt/${m[2]}/bin/node`;
  return exists(opt) ? opt : real;
}
/**
 * 앱이 고른 node 를 가리키는 링크 <데이터>/tools/bin/node(맥·리눅스) — 시스템 20+ 면 그 버전 없는 경로, 없으면 앱이 받은 node.
 * .mcp.json 은 이 링크만 적어서, node 를 바꿔도(받기·brew upgrade·지움) 앱이 링크 하나만 고치면 모든 프로젝트가 따라온다.
 * 링크가 없거나 깨졌으면 지금 node(버전 없는 경로)
 */
function defaultNode({ env = process.env, home = os.homedir() } = {}) {
  if (process.platform !== 'win32') {
    const link = path.join(dataDir({ env, home }), 'tools', 'bin', 'node');
    if (fs.existsSync(link)) return link;
  }
  return stableNode(fs.realpathSync(process.execPath));
}

/**
 * 홈 아래 경로는 ${HOME}/… 로 — .mcp.json 이 git 으로 다른 맥(다른 사용자 이름)에 가도 뜬다.
 * Claude Code 가 .mcp.json 의 command·args·env 에서 환경 변수를 풀어 준다(2026-10-05 맥 실측).
 * 윈도우는 풀기를 실측 못 해 절대 경로 그대로
 */
function homeVar(p, home, platform = process.platform) {
  if (!home || platform === 'win32') return p;
  const h = home.replace(/\/+$/, '');
  return p.startsWith(h + '/') ? '${HOME}' + p.slice(h.length) : p;
}

function buildEntry({ profile, nodePath, wrapperPath, env, home = '' }) {
  const v = (p) => homeVar(p, home);
  const entry = { type: 'stdio', command: v(nodePath), args: [v(wrapperPath), profile] };
  const custom = (env.CHAMMO_HOME || '').trim() || (env.CHAMMO_BROWSER_HOME || '').trim();
  if (custom) entry.env = { CHAMMO_BROWSER_HOME: v(browserRoot({ env })) };
  return entry;
}

/**
 * @returns {{ mcpPath: string, entry: object, created: boolean, unchanged: boolean, replaced: object|null }}
 *   replaced = 원래 있던 다른 playwright 항목(바꿨을 때만)
 */
function setupMcp({
  profile, dir = process.cwd(), env = process.env, home = os.homedir(), nodePath = defaultNode({ env, home }), wrapperPath = defaultWrapper(),
}) {
  const bad = checkProfile(profile);
  if (bad) throw new Error(bad);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`폴더가 없습니다: ${dir}`);

  const mcpPath = path.join(dir, '.mcp.json');
  const created = !fs.existsSync(mcpPath);
  let json = { mcpServers: {} };
  if (!created) {
    const raw = fs.readFileSync(mcpPath, 'utf8');
    try {
      json = raw.trim() ? JSON.parse(raw) : {};
    } catch (e) {
      throw new Error(`${mcpPath} 가 올바른 JSON 이 아니라 건드리지 않았습니다 (${e.message}). 고친 뒤 다시 실행하세요.`);
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error(`${mcpPath} 의 최상위가 객체가 아니라 건드리지 않았습니다.`);
    }
  }
  if (json.mcpServers == null) json.mcpServers = {};
  if (typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers)) {
    throw new Error(`${mcpPath} 의 mcpServers 가 객체가 아니라 건드리지 않았습니다.`);
  }

  const entry = buildEntry({ profile, nodePath, wrapperPath, env, home });
  const prev = json.mcpServers[SERVER];
  const unchanged = prev != null && JSON.stringify(prev) === JSON.stringify(entry);
  const replaced = prev != null && !unchanged ? prev : null;

  if (!unchanged) {
    json.mcpServers[SERVER] = entry;
    // 쓰다가 죽어도 반쪽 파일이 남지 않게 임시 파일에 쓰고 바꿔치기
    const tmp = `${mcpPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n');
    fs.renameSync(tmp, mcpPath);
  }
  return { mcpPath, entry, created, unchanged, replaced };
}

module.exports = { setupMcp, buildEntry, stableNode, homeVar, defaultNode };
