// 앱이 붙기 전에 뜬 JS 대화상자(alert·confirm·prompt) — 헤드풀 크롬은 새로 붙은 CDP 세션에 그 대화상자를 다시 안 알려서
// 앱은 'No dialog is showing' 으로 못 답하고 '멈춤'만 띄웠다(fix/browser-dialog ①). 래퍼의 playwright 는 처음부터 붙어 있어 안다 —
// 앱이 <live>/<프로필>.dialog {pid, accept, at} 를 쓰면 래퍼가 browser_handle_dialog 로 대신 답하고 <프로필>.dialog-done 에 결과를 남긴다.
// playwright 는 지금 탭의 대화상자만 다룬다 — 다른 탭 것이면 실패로 남는다(앱은 '크롬에서 보기'로)
const fs = require('fs');
const path = require('path');

const FRESH_MS = 60_000; // 이보다 오래된 요청은 버린다(앱이 꺼진 사이 남은 것)

/**
 * @param {object} o
 * @param {string} o.liveDir
 * @param {string} o.profile
 * @param {number} o.pid  이 래퍼 — 앱은 상태 파일의 pid 로 적는다(세션이 바뀌면 남의 대화상자에 답하지 않게)
 * @param {(name:string, args:object) => Promise<object>} o.call  relay.callInternal
 */
function createDialogAnswer({ liveDir, profile, pid, call, now = Date.now, log = () => {} }) {
  const req = path.join(liveDir, `${profile}.dialog`);
  const done = path.join(liveDir, `${profile}.dialog-done`);
  let busy = false;

  async function tick() {
    if (busy) return;
    let r;
    try { r = JSON.parse(fs.readFileSync(req, 'utf8')); } catch { return; }
    if (!r || r.pid !== pid) return;
    try { fs.unlinkSync(req); } catch { return; } // 같은 요청에 두 번 답하지 않게 — 지운 쪽만 답한다
    if (!(now() - Number(r.at) < FRESH_MS)) return;
    busy = true;
    try {
      const res = await call('browser_handle_dialog', { accept: !!r.accept });
      const text = ((res && res.content) || []).map((c) => (c && c.text) || '').join(' ');
      const failed = !res || res.isError;
      const line = text.split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('#')) || '';
      if (failed) log(`[chammo-browser-mcp] 앱이 부탁한 대화상자 답 실패: ${line}`);
      write({ pid, at: now(), ok: !failed, ...(failed ? { error: line.slice(0, 200) } : {}) });
    } finally {
      busy = false;
    }
  }

  function write(v) {
    const tmp = `${done}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
      fs.renameSync(tmp, done);
    } catch { /* 앱이 결과를 못 보면 멈춤 표시가 그대로 — 크롬에서 보기 */ }
  }

  return { tick };
}

module.exports = { createDialogAnswer, FRESH_MS };
