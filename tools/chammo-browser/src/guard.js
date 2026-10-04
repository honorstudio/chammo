// 브라우저를 대신 깔려는 길을 막는다. 플레이라이트는 크롬이 없으면 `npx playwright install chrome`(관리자 암호)을 안내하고,
// browser_install 도구는 그걸 직접 돌린다 — 백그라운드 세션이 치면 암호 창에서 멈추거나 Chrome for Testing 으로 샌다(영구 금지).
// 크롬 베타는 Chammo 설정 > 브라우저 자동화 > 설치(사람이 누름)로만 깐다

const MSG = [
  '이 기계엔 세션 브라우저(크롬 베타)가 아직 없어요. 사람에게 Chammo 설정 > 브라우저 자동화에서 "설치"를 눌러 달라고 하세요 — 직접 깔지 마세요(관리자 암호에서 멈추거나 다른 브라우저를 받습니다).',
  'No session browser (Chrome Beta) on this machine yet. Ask the user to press "Install" in Chammo Settings > Browser automation — do not install it yourself (it stops at an admin password prompt or fetches a different browser).',
].join('\n');

/** 막을 도구면 MCP 오류 결과, 아니면 null. found = 크롬이 하나라도 있나(window.chromeLaunch) */
function guardTool(name, found) {
  const block = name === 'browser_install' || (!found && /^browser_/.test(name) && name !== 'browser_close' && name !== 'browser_ask_human');
  return block ? { content: [{ type: 'text', text: MSG }], isError: true } : null;
}

module.exports = { guardTool, MSG };
