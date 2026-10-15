// 플레이라이트 MCP 프로세스에 --require 로 붙인다(래퍼가 띄울 때). browser_run_code_unsafe 가 세션 코드를 vm 상자에서 돌리는데
// 상자엔 page 만 있고 URL·setTimeout 이 없다. 세션이 단 page.on('response') 처리기가 new URL(…) 에서 ReferenceError 를 내면
// 그 예외는 도구 밖(크롬 사건)에서 터져 서버가 통째로 죽고 크롬도 같이 죽는다 — 세션엔 "Connection closed", 프로필엔 죽은 pid 잠금만(2026-10-11).
// ① 그 상자에 표준 전역을 넣고 ② 세션 코드(evalmachine)에서 온 예외는 죽지 말고 unhandledRejection 길로 넘긴다 —
// 플레이라이트가 그 길을 이미 받아 지금 도는 run_code 를 실패로 끝내거나 다음 도구 결과에 오류로 붙인다. 그 밖의 예외는 원래처럼 죽는다
// ③ 상자 console 은 stderr 로 — 이 프로세스의 stdout 은 MCP JSON-RPC 통로라 세션의 console.log 가 날것으로 섞인다(래퍼가 JSON 아닌 줄도 넘긴다)
// ④ 같은 예외가 되풀이되면(setInterval·응답마다 터지는 처리기) 1분에 한 번만 넘긴다 — 전엔 첫 번에 죽었는데, 살리고 나니 다음 도구 결과·로그가 끝없이 불어났다
const vm = require('vm');
const { Console } = require('console');

const GLOBALS = ['URL', 'URLSearchParams', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'TextEncoder', 'TextDecoder', 'fetch', 'AbortController', 'structuredClone', 'atob', 'btoa'];

const createContext = vm.createContext;
vm.createContext = function (ctx, ...rest) {
  // run_code 상자만 — { page, __end__ } 모양(playwright-core tools/backend runCode)
  if (ctx && typeof ctx === 'object' && 'page' in ctx && '__end__' in ctx) {
    for (const k of GLOBALS) if (!(k in ctx) && globalThis[k] !== undefined) ctx[k] = k === 'console' ? boxConsole() : globalThis[k];
  }
  return createContext.call(this, ctx, ...rest);
};

let box;
const boxConsole = () => (box ||= new Console({ stdout: process.stderr, stderr: process.stderr }));

const fromSessionCode = (e) => !!(e && typeof e.stack === 'string' && e.stack.includes('evalmachine.<anonymous>'));

const REPEAT_MS = 60_000;
const seen = new Map(); // 예외 글 → 마지막으로 넘긴 때
process.on('uncaughtException', (err, origin) => {
  if (fromSessionCode(err)) {
    const msg = String(err && err.message);
    const now = Date.now();
    if (now - (seen.get(msg) ?? -Infinity) < REPEAT_MS) return;
    if (seen.size > 200) seen.clear();
    seen.set(msg, now);
    console.error(`[chammo-browser] run_code 처리기 오류 — 서버는 계속 돈다: ${msg}`);
    process.emit('unhandledRejection', err, Promise.resolve());
    return;
  }
  console.error(origin === 'unhandledRejection' ? 'Unhandled rejection:' : 'Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});

module.exports = { GLOBALS, fromSessionCode };
