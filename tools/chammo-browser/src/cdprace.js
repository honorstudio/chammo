// CDP 경합 거절 — 플레이라이트가 대화상자를 스스로 닫으려는데(Page.handleJavaScriptDialog, 받는 처리기가 없을 때 기본 동작)
// 크롬이 이미 닫았으면 "No dialog is showing" 으로 거절된다. 그 약속은 아무도 안 받아서 node 가 통째로 죽었다 —
// 지킴이(_hold)가 죽으면 주인 스크립트가 크롬을 잃는다(2026-11-16 운영 수집 PC 지킴이 기록, 세 프로필 모두). 이미 닫힌 대화상자라는 뜻이니 무시한다.
// 쓰는 곳: 지킴이 hold()(guardHold — 어떤 처리 안 된 거절에도 안 죽고 기록만), MCP 래퍼의 플레이라이트(survive.js — 이 경합만 넘기고 나머지는 전처럼 죽는다)

function benignRace(err) {
  const msg = String((err && err.message) || '');
  return /No dialog is showing/.test(msg) && /handleJavaScriptDialog|ProtocolError/.test(`${msg} ${err && err.method} ${err && err.name}`);
}

const REPEAT_MS = 60_000;

/** 지킴이 — 처리 안 된 거절로 죽지 않는다. 같은 글은 1분에 한 번만 적는다 */
function guardHold({ log, now = Date.now } = {}) {
  const seen = new Map();
  process.on('unhandledRejection', (err) => {
    const msg = String((err && err.message) || err);
    const t = now();
    if (t - (seen.get(msg) ?? -Infinity) < REPEAT_MS) return;
    if (seen.size > 200) seen.clear();
    seen.set(msg, t);
    log(benignRace(err) ? `대화상자가 이미 닫혀 있었음 — 무시하고 계속: ${msg}` : `처리 안 된 오류 — 지킴이는 계속 돈다: ${err && err.stack ? err.stack : msg}`);
  });
}

module.exports = { benignRace, guardHold };
