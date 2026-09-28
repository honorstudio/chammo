// 프로젝트 폴더의 .mcp.json 에 playwright 서버(= chammo-browser-mcp 래퍼)를 등록한다.
//
// - command 는 PATH 에 기대지 않는다: 지금 돌고 있는 node 의 실제 경로 + 래퍼 절대경로.
//   앱이 `node <tool>/bin/chammo-browser.js setup ...` 으로 부르기만 하면 npm link 없이 동작한다.
//   process.execPath 를 realpath 로 푸는 이유: fnm·nvm 같은 버전 관리자는 셸마다 임시 심볼릭 링크
//   (예: .../fnm_multishells/<번호>/bin/node)로 node 를 잡아 주는데, 그 링크는 셸이 끝나면 사라진다.
// - 다른 서버·최상위 키는 그대로 두고 playwright 만 넣는다(병합). 깨진 JSON 은 덮어쓰지 않고 에러.
// - 데이터 폴더를 바꿔 둔 환경(CHAMMO_HOME / CHAMMO_BROWSER_HOME)이면 그 루트를 env 로 적어 둔다 —
//   Claude 가 래퍼를 띄울 때 같은 환경변수를 물려받는다는 보장이 없어서다.
const fs = require('fs');
const path = require('path');
const { browserRoot, checkProfile } = require('./paths');

const SERVER = 'playwright';
const defaultWrapper = () => fs.realpathSync(path.join(__dirname, '..', 'bin', 'chammo-browser-mcp.js'));
const defaultNode = () => fs.realpathSync(process.execPath);

function buildEntry({ profile, nodePath, wrapperPath, env }) {
  const entry = { type: 'stdio', command: nodePath, args: [wrapperPath, profile] };
  const custom = (env.CHAMMO_HOME || '').trim() || (env.CHAMMO_BROWSER_HOME || '').trim();
  if (custom) entry.env = { CHAMMO_BROWSER_HOME: browserRoot({ env }) };
  return entry;
}

/**
 * @returns {{ mcpPath: string, entry: object, created: boolean, unchanged: boolean, replaced: object|null }}
 *   replaced = 원래 있던 다른 playwright 항목(바꿨을 때만)
 */
function setupMcp({
  profile, dir = process.cwd(), nodePath = defaultNode(), wrapperPath = defaultWrapper(), env = process.env,
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

  const entry = buildEntry({ profile, nodePath, wrapperPath, env });
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

module.exports = { setupMcp, buildEntry };
