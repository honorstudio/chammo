// 플레이라이트 MCP 프로세스에 --require 로 붙인다(래퍼가 띄울 때, survive.js 와 같이). 세션 크롬 창 자리를 크롬이 실제로 뜰 때 다시 정한다.
// 앱이 가짜 화면(Chammo agents)을 필요할 때만 띄우니(2026-10-20 사용자 — 늘 떠 있어 아이맥 유니버설 컨트롤 커서가 갇혔다) 세션이 뜰 때 정한 자리는
// 크롬이 뜰 때쯤 낡는다: 그때 앱에 화면을 부탁하고(app.jsonl) 기다려 --window-position·--window-size 만 바꾼다.
// 설정은 환경 변수 CHAMMO_PLACE = {profile, vdFile, dataDir, liveDir?, inject?: {exe, dylib, signed?}} — 윈도우는 {…, desk: true, root, liveDir}(숨은 데스크톱, src/windesk.js). 플레이라이트는 child_process.spawn 으로 크롬을 띄운다(playwright-core processLauncher)
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

/** 가짜 화면을 끝내 못 받았을 때 — 창 자리 대신 헤드리스(new) + 2배 그림(앱이 CDP 그림을 칸에 그린다, 2026-10-27 인앱 브라우저 A 6단계).
 *  화면 밖 창은 맥·크롬이 화면 안으로 끌어와 사람 화면에 보였다. 2배는 플레이라이트 deviceScaleFactor 로는 안 되고 이 인자여야 한다(spike 3절) */
function headlessArgs(args) {
  const out = args.filter((a) => !a.startsWith('--window-position=') && !a.startsWith('--window-size='));
  if (!out.some((a) => a.startsWith('--headless'))) out.push('--headless=new');
  if (!out.some((a) => a.startsWith('--force-device-scale-factor='))) out.push('--force-device-scale-factor=2');
  return out;
}

/** 크롬이 뜰 때 넣을 창 인자 — 가짜 화면이 있으면 그 자리, 없으면(offPos) 사본은 헤드리스. 구글 크롬(패스키) 갈래는 헤드리스면 맥 패스키·Touch ID 창이
 *  절대 안 떠 사람이 못 눌러(0.4.4 리뷰) 보이는 창으로 — 자리 인자를 빼 크롬 기본 자리(사람 화면). 그 차례엔 사람이 그 창을 봐야 한다 */
function launchArgs(args, place, signed) {
  if (!place || !place.offPos) return swapPlace(args, place);
  if (signed) return args.filter((a) => !a.startsWith('--window-position=') && !a.startsWith('--window-size='));
  return headlessArgs(args);
}

/** Dock·⌘Tab 빼기 dylib(src/appcopy.js 가 ad-hoc 사본일 때 준다) — 그 크롬 실행 파일을 띄울 때만 env 에 더한다.
 *  MCP 프로세스(node) 자신의 env 에 넣으면 node 에도 AppKit 이 실린다 */
function withInject(cmd, opts, inject) {
  if (!inject || cmd !== inject.exe) return opts;
  const o = opts || {};
  return { ...o, env: { ...(o.env || process.env), DYLD_INSERT_LIBRARIES: inject.dylib } };
}

/** 띄울 실행 파일·옵션 — 사람이 '이번만 구글 크롬으로 열기'를 누른 동안(signed = <live>/<프로필>.signed-want, src/winshow.js)은
 *  ad-hoc 사본 대신 구글 서명 원본을 주입 없이(맥 패스키는 구글 서명 크롬만 된다). 그동안 Dock 에 보이고 칸은 그림 길 */
function launchExe(cmd, opts, inject, signed) {
  if (signed && inject && inject.signed && cmd === inject.exe) return { cmd: inject.signed, opts };
  return { cmd, opts: withInject(cmd, opts, inject) };
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
  cp.spawn = function (cmd, args, opts, ...rest) {
    // 윈도우 — 숨은 데스크톱 실행기로(src/windesk.js). 사람 차례 OS 창 동안은 보이는 자리, 실행기를 못 만들면 헤드리스
    if (conf.desk) {
      try {
        const windesk = require('./windesk');
        const visible = windesk.visibleWanted(conf.liveDir, conf.profile);
        const r = windesk.rewrite(cmd, args, { visible, exe: visible ? null : windesk.ensureLauncher({ root: conf.root }) });
        if (r) ({ cmd, args } = r);
      } catch (e) {
        console.error(`[chammo-browser] 숨은 데스크톱으로 못 바꿔 그대로 띄웁니다: ${e.message}`);
      }
      return spawn.call(this, cmd, args, opts, ...rest);
    }
    const signed = !!conf.liveDir && fs.existsSync(path.join(conf.liveDir, `${conf.profile}.signed-want`));
    ({ cmd, opts } = launchExe(cmd, opts, conf.inject, signed));
    // 우리가 자리를 넣은 크롬만 — 다른 띄우기(설치 등)는 그대로
    if (Array.isArray(args) && args.some((a) => typeof a === 'string' && a.startsWith('--window-position='))) {
      try {
        const { placement } = require('./window');
        const place = placement({ profile: conf.profile, watchable: true, appHere: true, vdFile: conf.vdFile, ask: () => askApp(conf.dataDir) });
        // 부탁하고 기다려도 가짜 화면이 없다(offPos) — 화면 밖 창 대신 헤드리스. 앱 칸이 CDP 그림으로 같은 자리에 그린다(패스키 갈래만 보이는 창)
        args = launchArgs(args, place, signed);
      } catch (e) {
        console.error(`[chammo-browser] 크롬 자리를 다시 못 정해 처음 자리로: ${e.message}`);
      }
    }
    return spawn.call(this, cmd, args, opts, ...rest);
  };
}

install();

module.exports = { swapPlace, askApp, withInject, launchExe, headlessArgs, launchArgs };
