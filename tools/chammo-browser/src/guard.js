// 브라우저를 대신 깔려는 길을 막는다. 플레이라이트는 크롬이 없으면 `npx playwright install chrome`(관리자 암호)을 안내하고,
// browser_install 도구는 그걸 직접 돌린다 — 백그라운드 세션이 치면 암호 창에서 멈추거나 Chrome for Testing 으로 샌다(영구 금지).
// 크롬은 Chammo 설정 > 브라우저 > 참모 브라우저(사람이 누름)로만 깐다.
//
// 설치가 끝난(준비됨) 기계에서 세션만 크롬을 못 찾으면 그 줄에 '설치' 단추가 숨어 사람이 누를 게 없었다(공개 이슈 #28).
// 그래서 못 찾은 래퍼는 <데이터>/tools/chammo-browser/.missing 을 남긴다 — 앱이 그걸 보고 그 줄에 '다시 찾기' 단추를 띄우고, 누르면 없는 것만 받고 시험으로 열어 본다
const fs = require('fs');
const path = require('path');

const MSG = [
  '이 세션이 크롬을 못 찾았어요. 사람에게 Chammo 설정 > 브라우저 > 참모 브라우저의 "다시 찾기"를 눌러 달라고 하고, 끝나면 참모에게 이 세션을 다시 켜 달라고 하세요(새로 켜야 다시 찾아요) — 직접 깔지 마세요(관리자 암호에서 멈추거나 다른 브라우저를 받습니다).',
  'This session could not find Chrome. Ask the user to press "Find again" in Chammo Settings > Browser > Assistant browser, then ask the assistant to restart this session (it looks again on restart) — do not install it yourself (it stops at an admin password prompt or fetches a different browser).',
].join('\n');

/** 막을 도구면 MCP 오류 결과, 아니면 null. found = 크롬이 하나라도 있나(window.chromeLaunch) */
function guardTool(name, found) {
  const block = name === 'browser_install' || (!found && /^browser_/.test(name) && name !== 'browser_close' && name !== 'browser_ask_human');
  return block ? { content: [{ type: 'text', text: MSG }], isError: true } : null;
}

/** 앱이 읽는 '세션이 크롬을 못 찾음' 표시 — 앱 browser.rs missing_mark 와 같은 자리 */
function missingFile(dataDir) {
  return path.join(dataDir, 'tools', 'chammo-browser', '.missing');
}

/** 못 찾았으면 표시를 쓰고, 찾았으면 지운다(다른 세션이 찾았다 = 이제 있다). 앱 폴더가 없으면(앱 없는 기계) 안 쓴다. 던지지 않는다 */
function markMissing(dataDir, missing, profile, now = () => new Date().toISOString()) {
  const f = missingFile(dataDir);
  try {
    if (!missing) return fs.rmSync(f, { force: true });
    if (!fs.existsSync(path.dirname(f))) return;
    fs.writeFileSync(f, `${JSON.stringify({ profile, at: now() })}\n`);
  } catch { /* 표시는 보조 */ }
}

module.exports = { guardTool, markMissing, missingFile, MSG };
