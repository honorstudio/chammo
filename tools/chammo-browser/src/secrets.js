// 비밀번호 칸 값 가리기(2026-10-06 browser-takeover QA) — 플레이라이트 MCP(0.0.80) snapshot 은 type=password 칸 값을 그대로 보여 줘서
// 사람이 친(개입·부름·크롬 창에서 직접·자동완성) 비밀번호가 세션 대화 기록으로 샜다. 래퍼가 세션 도구 결과를 넘기기 직전에
// 그 페이지의 비밀번호 칸 값을 몰래 읽어(메모리에만, 로그·파일 X) 모든 결과 글에서 가린다. 한 번 본 값은 브라우저가 닫힐 때까지 기억한다
// (나중 결과 — 네트워크 요청 몸통·콘솔 — 에 다시 나와도 가린다)
const MASK = '●●●●';
const MIN = 4; // 이보다 짧은 값은 안 가린다 — 흔한 글자가 결과 곳곳에서 지워지지 않게
const MAX = 20;

// 같은 출처 iframe 까지. 값을 돌려주기만 하고 밖으로 보내지 않는다
const CAPTURE_FN = `() => { const out = []; const sel = 'input[type=password], input[autocomplete~="current-password"], input[autocomplete~="new-password"], input[autocomplete~="one-time-code"]';
  const walk = (d, n) => { try { for (const i of d.querySelectorAll(sel)) if (i.value) out.push(i.value);
    if (n < 3) for (const f of d.querySelectorAll('iframe,frame')) { try { if (f.contentDocument) walk(f.contentDocument, n + 1); } catch (e) {} } } catch (e) {} };
  walk(document, 0); return out.slice(0, 20); }`;

/** browser_evaluate 결과 글 → 글자 값들. 모양이 이상하면 빈 것 */
function parseValues(text) {
  const m = /### Result\s*\n([\s\S]*?)(?:\n###|$)/.exec(String(text || ''));
  if (!m) return [];
  try {
    const v = JSON.parse(m[1].trim());
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createSecrets() {
  let values = []; // 긴 것부터
  let re = null;
  function rebuild() {
    const forms = new Set();
    for (const v of values) {
      forms.add(v);
      for (const f of [encodeURIComponent(v), JSON.stringify(v).slice(1, -1), v.replace(/ /g, '+')]) if (f.length >= MIN) forms.add(f);
    }
    const list = [...forms].sort((a, b) => b.length - a.length);
    re = list.length ? new RegExp(list.map(esc).join('|'), 'g') : null;
  }
  const api = {
    /** 결과를 넘기기 직전에 보낼 내부 호출(값 읽기) — 답이 오면 기억한다 */
    captureCall() {
      return { name: 'browser_evaluate', arguments: { function: CAPTURE_FN }, onResult: (r) => api.add(textOf(r)) };
    },
    add(list) {
      const fresh = (Array.isArray(list) ? list : typeof list === 'string' ? parseValues(list) : []).filter((v) => typeof v === 'string' && v.length >= MIN && !values.includes(v));
      if (!fresh.length) return;
      values = [...fresh, ...values].slice(0, MAX).sort((a, b) => b.length - a.length);
      rebuild();
    },
    redact(text) {
      return re && typeof text === 'string' ? text.replace(re, MASK) : text;
    },
    /** 결과 객체의 글 칸만 — 바뀐 게 없으면 같은 객체 */
    redactResult(result) {
      if (!re || !result || !Array.isArray(result.content)) return result;
      let changed = false;
      const content = result.content.map((c) => {
        if (!c || c.type !== 'text' || typeof c.text !== 'string') return c;
        const t = api.redact(c.text);
        if (t === c.text) return c;
        changed = true;
        return { ...c, text: t };
      });
      return changed ? { ...result, content } : result;
    },
    /**
     * 결과 글이 가리키는 플레이라이트 파일(.playwright-mcp/…yml·log)도 가린다 — 큰 snapshot 은 글 대신 파일로 남는다.
     * cwd 의 .playwright-mcp 안 파일만(../ 없이), 가릴 값이 있을 때만
     */
    redactFiles(text, cwd) {
      if (!re || typeof text !== 'string') return;
      const fs = require('fs');
      const path = require('path');
      const base = path.join(cwd, '.playwright-mcp');
      for (const m of text.matchAll(/\((\.playwright-mcp\/[^)\s]+)\)/g)) {
        const f = path.resolve(cwd, m[1]);
        if (!f.startsWith(base + path.sep) || m[1].includes('..')) continue;
        try {
          const before = fs.readFileSync(f, 'utf8');
          const after = api.redact(before);
          if (after !== before) fs.writeFileSync(f, after);
        } catch { /* 없음·못 읽음 */ }
      }
    },
    size: () => values.length,
    reset() {
      values = [];
      re = null;
    },
  };
  return api;
}

const textOf = (r) => ((r && r.content) || []).map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');

module.exports = { createSecrets, parseValues, CAPTURE_FN, MASK };
