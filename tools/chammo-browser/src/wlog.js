// 래퍼 자체 기록(2026-10-29) — 세션 MCP 로그(~/Library/Caches/claude-cli-nodejs/*/mcp-logs-*)엔 래퍼 stderr 가 안 남는다(10-28 한 세션 로그 255줄 중 0).
// console.error 로 가던 줄을 그대로 두고 <브라우저 루트>/run/<프로필>.log(600)에도 시각과 같이 남긴다. 커지면 뒤 절반만
const fs = require('fs');
const path = require('path');

const MAX = 256 * 1024;

function attachLog({ file, con = console, max = MAX, now = () => new Date() }) {
  const orig = con.error.bind(con);
  let ready = false;
  con.error = (...a) => {
    orig(...a);
    try {
      if (!ready) { fs.mkdirSync(path.dirname(file), { recursive: true }); ready = true; }
      fs.appendFileSync(file, `${now().toISOString()} ${a.map(String).join(' ')}\n`, { mode: 0o600 });
      if (fs.statSync(file).size > max) {
        const t = fs.readFileSync(file, 'utf8');
        const cut = t.indexOf('\n', t.length - Math.floor(max / 2));
        fs.writeFileSync(file, cut < 0 ? '' : t.slice(cut + 1), { mode: 0o600 });
      }
    } catch { /* 기록은 보조 — 래퍼는 그대로 */ }
  };
}

module.exports = { attachLog };
