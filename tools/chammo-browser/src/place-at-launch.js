// 플레이라이트 MCP 프로세스에 --require 로 붙인다(래퍼가 띄울 때, survive.js 와 같이). 세션 크롬 창 자리를 크롬이 실제로 뜰 때 다시 정한다.
// 앱이 가짜 화면(Chammo agents)을 필요할 때만 띄우니(2026-10-20 사용자 — 늘 떠 있어 아이맥 유니버설 컨트롤 커서가 갇혔다) 세션이 뜰 때 정한 자리는
// 크롬이 뜰 때쯤 낡는다: 그때 앱에 화면을 부탁하고(app.jsonl) 기다려 --window-position·--window-size 만 바꾼다.
// 설정은 환경 변수 CHAMMO_PLACE = {profile, vdFile, dataDir}. 플레이라이트는 child_process.spawn 으로 크롬을 띄운다(playwright-core processLauncher)
const fs = require('fs');
const path = require('path');

/** 크롬 인자에서 창 자리·크기만 새 값으로 — 자리를 못 정했으면 그대로 */
function swapPlace(args, place) {
  if (!place || !place.pos) return args;
  const out = [];
  for (const a of args) {
    if (a.startsWith('--window-size=')) continue;
    if (a.startsWith('--window-position=')) {
      out.push(`--window-position=${place.pos[0]},${place.pos[1]}`);
      if (place.size) out.push(`--window-size=${place.size[0]},${place.size[1]}`);
      continue;
    }
    out.push(a);
  }
  return out;
}

/** 앱에 가짜 화면 부탁 — <데이터>/app.jsonl 한 줄(앱 appctl 이 0.7초마다 읽는다). 못 써도 조용히 */
function askApp(dataDir) {
  const line = { ts: new Date().toISOString(), action: 'vdisplay', arg: { verb: 'want' }, id: require('crypto').randomBytes(6).toString('hex') };
  try { fs.appendFileSync(path.join(dataDir, 'app.jsonl'), JSON.stringify(line) + '\n'); } catch { /* 앱이 없다 — 화면 밖으로 */ }
}

function install(env = process.env) {
  let conf;
  try { conf = JSON.parse(env.CHAMMO_PLACE || ''); } catch { return; }
  if (!conf || !conf.vdFile || !conf.dataDir) return;
  const cp = require('child_process');
  const spawn = cp.spawn;
  cp.spawn = function (cmd, args, ...rest) {
    // 우리가 자리를 넣은 크롬만 — 다른 띄우기(설치 등)는 그대로
    if (Array.isArray(args) && args.some((a) => typeof a === 'string' && a.startsWith('--window-position='))) {
      try {
        const { placement } = require('./window');
        const place = placement({ profile: conf.profile, watchable: true, appHere: true, vdFile: conf.vdFile, ask: () => askApp(conf.dataDir) });
        args = swapPlace(args, place);
      } catch (e) {
        console.error(`[chammo-browser] 크롬 자리를 다시 못 정해 처음 자리로: ${e.message}`);
      }
    }
    return spawn.call(this, cmd, args, ...rest);
  };
}

install();

module.exports = { swapPlace, askApp };
