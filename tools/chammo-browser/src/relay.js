// Claude ↔ @playwright/mcp 사이의 stdio JSON-RPC 중계 + 지연 락.
//
// 예전엔 래퍼가 **기동 시점**에 락을 잡았다. 그래서 브라우저를 한 번도 안 띄운
// 유휴 세션이 프로필을 몇 시간씩 쥐고, 같은 폴더의 두 번째 세션은 락 실패 →
// process.exit → Claude 엔 CONNECTION_CLOSED 로만 보였다(2026-09-27).
//
// 지금은 락을 **첫 tools/call 시점**에 잡는다:
//   - initialize·tools/list 등은 락 없이 통과 → MCP 는 항상 연결된다
//   - tools/call 때 락을 못 얻으면 프로세스를 죽이지 않고 그 호출에 도구 에러로 답한다
//   - browser_close 가 성공하면 락을 놓는다 (프로세스 종료 시 해제는 래퍼가 담당)
//   - idleMs 동안 tools/call 이 없으면 래퍼가 browser_close 를 대신 보내 락을 돌려준다
//     (브라우저를 띄워 놓고 방치한 세션이 프로필을 계속 쥐는 걸 막는다)
//
// MCP stdio 전송은 "한 줄 = 한 JSON-RPC 메시지"다. 원문 줄을 그대로 넘기고,
// 판단에 필요한 만큼만 파싱한다.

const { StringDecoder } = require('string_decoder');

const CLOSE_TOOL = 'browser_close';
const DEFAULT_IDLE_MINUTES = 10;
const IDLE_FLAG = '--idle-minutes=';

/**
 * 유휴 자동 닫기 시간. 우선순위: `--idle-minutes=N` 인자 > CHAMMO_BROWSER_IDLE_MINUTES > 10분.
 * 0 이면 끔. 우리 인자는 playwright 로 넘기지 않도록 rest 에서 뺀다.
 */
function parseIdleMs(argv, env) {
  let minutes = DEFAULT_IDLE_MINUTES;
  const fromEnv = Number(env.CHAMMO_BROWSER_IDLE_MINUTES);
  if (env.CHAMMO_BROWSER_IDLE_MINUTES != null && Number.isFinite(fromEnv) && fromEnv >= 0) minutes = fromEnv;
  const rest = [];
  for (const a of argv) {
    if (!a.startsWith(IDLE_FLAG)) { rest.push(a); continue; }
    const n = Number(a.slice(IDLE_FLAG.length));
    if (Number.isFinite(n) && n >= 0) minutes = n;
  }
  return { idleMs: Math.round(minutes * 60000), rest };
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// 공개판엔 chammo-browser 명령이 PATH 에 없다(앱이 데이터 폴더에 풀기만 한다) — 그대로 쳐서 되는 모양으로 안내
const UNLOCK_CLI = require('path').join(__dirname, '..', 'bin', 'chammo-browser.js');

/** 결과 앞에 꼬리표 한 덩이 — 없으면 그대로 */
function withNote(result, note) {
  if (!note) return result;
  const r = result && typeof result === 'object' ? result : {};
  return { ...r, content: [{ type: 'text', text: note }, ...(Array.isArray(r.content) ? r.content : [])] };
}

function lockedMessage(profile, r) {
  if (r.reason === 'locked' && r.holder) {
    return [
      `프로필 '${profile}' 은(는) pid ${r.holder.pid}(시작 ${r.holder.startedAt})이 사용 중입니다.`,
      `→ 그 세션에서 browser_close 를 부르거나 세션을 닫으면 풀립니다. 다음 호출 때 자동으로 다시 시도합니다.`,
      `→ 유휴 세션이 쥐고 있는 게 확실하면: node "${UNLOCK_CLI}" unlock ${profile}`,
    ].join('\n');
  }
  return `프로필 '${profile}' 락 획득 실패: ${r.reason}. 다음 호출 때 다시 시도합니다.`;
}

/**
 * @param {object} o
 * @param {string} o.profile
 * @param {() => {ok:boolean, reason?:string, holder?:object}} o.acquire
 * @param {() => void} o.release
 * @param {(line:string) => void} o.sendToChild   Claude → playwright
 * @param {(line:string) => void} o.sendToClient  playwright/래퍼 → Claude
 * @param {number} [o.idleMs=0]  0 이면 유휴 자동 닫기 끔
 * @param {() => boolean} [o.canClose]  유휴 닫기 직전에 묻는다 — false 면 미루고 다시 잰다(사람이 개입 중·스크립트가 같은 크롬을 쓰는 중)
 * @param {Function} [o.setTimer]  테스트용 주입 (기본 setTimeout)
 * @param {Function} [o.clearTimer]
 * @param {(msg:string) => void} [o.log]
 * @param {(name:string, args:object) => void} [o.onCallStart]  Claude 의 도구 호출이 playwright 로 갈 때(앞 앱 되돌리기·세션 브라우저 상태)
 * @param {(name:string, result:object) => void} [o.onCallEnd]    그 응답이 왔을 때
 * @param {object[]} [o.extraTools]  래퍼가 직접 맡는 도구 — tools/list 응답 끝에 더한다
 * @param {(name:string, args:object) => (Promise<object>|null)} [o.onLocalTool]  그 도구면 결과 Promise, 아니면 null(playwright 로)
 * @param {(name:string) => {name:string, arguments:object}[]} [o.beforeCall]  브라우저가 떠 있을 때 세션 호출 앞에 먼저 보낼 내부 호출들 —
 *   다 답할 때까지 세션 호출(과 뒤에 온 줄)을 잡아 둔다. 답은 세션에 안 보인다
 * @param {(name:string, args:object) => (Promise<{run:boolean, note?:string, isError?:boolean}>|null)} [o.gate]  세션 도구 호출 앞 문지기 —
 *   Promise 면 끝날 때까지 그 호출을 붙잡는다(사람 개입 중, src/takeover.js). run=false 면 실행 없이 note 로 답하고, true 면 실행하고 결과 앞에 note
 * @param {(name:string) => ({name:string, arguments:object, onResult:(r:object)=>void}|null)} [o.afterCall]  세션 호출의 답을 넘기기 직전에 보낼 내부 호출
 *   (비밀번호 칸 값 읽기, src/secrets.js) — 답이 오거나 afterMs 가 지나면 넘긴다
 * @param {(name:string, result:object) => object} [o.transform]  세션에 넘기는 결과를 고친다(비밀번호 가리기)
 */
function createRelay({
  profile, acquire, release, sendToChild, sendToClient,
  idleMs = 0, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {},
  onCallStart = () => {}, onCallEnd = () => {}, extraTools = [], onLocalTool = () => null, beforeCall = () => [],
  canClose = () => true, gate = () => null, afterCall = () => null, transform = (_n, r) => r, afterMs = 1500,
}) {
  const lists = new Set(); // tools/list 요청 id — 응답에 래퍼 도구를 더한다
  let held = false;
  const pending = new Map(); // 진행 중인 tools/call: id → 도구 이름
  const internal = new Set(); // 래퍼가 직접 보낸 요청 id — 응답을 Claude 로 흘리지 않는다
  let idleTimer = null;
  let idleSeq = 0;
  let preSeq = 0;
  const preWait = new Set(); // 답을 기다리는 내부 선행 호출 id
  const waiting = []; // 그동안 온 세션 줄 — 순서대로 다시 처리
  let localRunning = 0; // 도는 래퍼 도구 수 — 사람 부르기를 기다리는 동안 유휴 닫기가 크롬을 끄지 않게(2026-10-05 QA 5)
  const notes = new Map(); // 응답 앞에 붙일 꼬리표: 요청 id → 글(사람 개입 뒤 첫 결과)
  const gated = new Set(); // gate 가 붙잡은 요청 id — 세션이 취소하면 지운다(돌려줘도 답하지 않게)
  const cleared = new Set(); // gate 를 이미 지난 요청 id — 선행 호출 뒤 다시 처리될 때 또 묻지 않게
  const afterWait = new Map(); // 답을 기다리는 뒤따름 내부 호출 id → {onResult, go}
  let afterSeq = 0;

  function disarm() {
    if (idleTimer != null) clearTimer(idleTimer);
    idleTimer = null;
  }

  function arm() {
    disarm();
    if (!idleMs || !held || pending.size > 0 || localRunning > 0) return;
    idleTimer = setTimer(onIdle, idleMs);
    if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function onIdle() {
    idleTimer = null;
    // 콜백이 대기 중일 때 호출이 먼저 들어왔을 수 있다 → 그땐 닫지 않는다
    if (!held || pending.size > 0 || localRunning > 0) return;
    // 사람이 개입 중이거나 스크립트가 이 크롬을 같이 쓰는 중이면(chammo-browser launch, src/users.js) 닫지 않고 다시 잰다
    if (!canClose()) return arm();
    const id = `chammo-idle-${++idleSeq}`;
    log(`[chammo-browser-mcp] ${+(idleMs / 60000).toFixed(2)}분 동안 도구 호출이 없어 브라우저를 닫고 '${profile}' 락을 돌려줍니다.`);
    internal.add(id);
    pending.set(id, CLOSE_TOOL);
    sendToChild(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: CLOSE_TOOL, arguments: {} } }));
  }

  function onClientLine(line) {
    if (preWait.size > 0) return void waiting.push(line);
    const msg = parse(line);
    if (msg && msg.method === 'tools/list' && msg.id != null && extraTools.length) lists.add(msg.id);
    // 세션이 붙잡힌 호출을 취소했다(사람이 멈춤 등) — 돌려줘도 답하지 않는다
    if (msg && msg.method === 'notifications/cancelled' && msg.params && gated.delete(msg.params.requestId)) return;
    const isCall = msg && msg.method === 'tools/call' && msg.id != null;
    if (!isCall) return sendToChild(line);

    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    // 문지기 — 사람이 개입 중이면 돌려줄 때까지 붙잡는다(src/takeover.js). 붙잡힌 동안은 유휴 닫기도 안 한다
    if (!cleared.delete(msg.id)) {
      const g = gate(name, args);
      if (g) {
        disarm();
        localRunning += 1;
        gated.add(msg.id);
        const done = (r) => {
          localRunning -= 1;
          const alive = gated.delete(msg.id);
          if (alive && r && r.run) {
            if (r.note) notes.set(msg.id, r.note);
            cleared.add(msg.id);
            onClientLine(line);
          } else if (alive) {
            sendToClient(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: (r && r.note) || '' }], isError: r ? r.isError !== false : true } }));
          }
          arm();
        };
        Promise.resolve(g).then(done, (e) => done({ run: false, isError: true, note: String((e && e.message) || e) }));
        return;
      }
    }
    cleared.add(msg.id); // 선행 호출로 미뤄졌다 다시 와도 문지기를 또 안 거치게(보내면 지운다)
    // 래퍼 도구(사람 부르기 등) — playwright 로 안 보내고 락도 안 잡는다
    const local = onLocalTool(name, args);
    if (local) {
      cleared.delete(msg.id);
      disarm();
      localRunning += 1;
      const settle = () => { localRunning -= 1; arm(); };
      const note = notes.get(msg.id);
      notes.delete(msg.id);
      Promise.resolve(local).finally(settle).then(
        (result) => sendToClient(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: withNote(result, note) })),
        (e) => sendToClient(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true } })),
      );
      return;
    }
    disarm();
    // 락이 없으면 브라우저도 없다 → browser_close 는 락 없이 그대로 통과(no-op)
    if (!held && name !== CLOSE_TOOL) {
      const r = acquire();
      if (!r.ok) {
        cleared.delete(msg.id);
        notes.delete(msg.id);
        return sendToClient(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: lockedMessage(profile, r) }], isError: true },
        }));
      }
      held = true;
    }
    // 브라우저가 떠 있으면 먼저 치울 것(사람이 앱에서 연 파일 창 등) — 그게 끝난 뒤 이 줄을 다시 처리한다
    const pre = held && name !== CLOSE_TOOL ? beforeCall(name) || [] : [];
    if (pre.length) {
      waiting.push(line);
      for (const c of pre) {
        const id = `chammo-pre-${++preSeq}`;
        internal.add(id);
        preWait.add(id);
        pending.set(id, c.name);
        sendToChild(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: c.name, arguments: c.arguments || {} } }));
      }
      return;
    }
    cleared.delete(msg.id);
    pending.set(msg.id, name);
    onCallStart(name, args);
    sendToChild(line);
  }

  function onChildLine(line) {
    const msg = parse(line);
    if (msg && msg.id != null && lists.delete(msg.id) && msg.result && Array.isArray(msg.result.tools)) {
      msg.result.tools = [...msg.result.tools, ...extraTools];
      return sendToClient(JSON.stringify(msg));
    }
    // 시간이 지나 놓아 준 내부 호출의 늦은 답 — 세션에 절대 안 보낸다(비밀번호 칸 값이 들어 있다)
    if (msg && msg.id != null && !msg.method && internal.has(msg.id) && !pending.has(msg.id)) {
      internal.delete(msg.id);
      return;
    }
    if (msg && msg.id != null && pending.has(msg.id) && !msg.method) {
      const name = pending.get(msg.id);
      pending.delete(msg.id);
      const succeeded = msg.result && !msg.result.isError;
      // 다른 호출이 아직 돌고 있으면 그게 브라우저를 다시 띄웠을 수 있다 → 보수적으로 유지
      if (name === CLOSE_TOOL && held && succeeded && pending.size === 0) {
        release();
        held = false;
      }
      arm();
      if (internal.delete(msg.id)) {
        const aw = afterWait.get(msg.id);
        if (aw) {
          try { if (msg.result) aw.onResult(msg.result); } catch { /* 읽기 실패 — 아는 값으로 가린다 */ }
          aw.go();
        }
        if (preWait.delete(msg.id) && preWait.size === 0) {
          for (const l of waiting.splice(0)) onClientLine(l);
        }
        return;
      }
      onCallEnd(name, msg.result || msg.error || {});
      // 넘기기: 비밀번호 칸 값을 가리고(transform) 사람 개입 뒤 첫 결과면 앞에 꼬리표
      const finish = () => {
        const note = notes.get(msg.id);
        notes.delete(msg.id);
        if (!msg.result) return sendToClient(line);
        sendToClient(JSON.stringify({ ...msg, result: withNote(transform(name, msg.result), note) }));
      };
      // 브라우저가 떠 있으면 넘기기 직전에 지금 비밀번호 칸 값을 읽는다 — 답이 없으면(대화상자 등) afterMs 뒤 아는 값만 가리고 넘긴다
      const ac = held && name !== CLOSE_TOOL && msg.result ? afterCall(name) : null;
      if (ac) {
        const id = `chammo-after-${++afterSeq}`;
        let done = false;
        const go = () => {
          if (done) return;
          done = true;
          afterWait.delete(id);
          pending.delete(id); // 답이 영영 안 와도 유휴 닫기가 막히지 않게 — 늦은 답은 아래 '버릴 내부 답'으로 버린다
          finish();
        };
        internal.add(id);
        pending.set(id, ac.name);
        afterWait.set(id, { onResult: ac.onResult, go });
        sendToChild(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: ac.name, arguments: ac.arguments || {} } }));
        const t = setTimer(go, afterMs);
        if (t && typeof t.unref === 'function') t.unref();
        return;
      }
      return finish();
    }
    sendToClient(line);
  }

  return { onClientLine, onChildLine, holdsLock: () => held };
}

// 스트림 청크 → 완성된 줄 단위 콜백. 빈 줄은 버리고 CRLF 도 처리한다.
// 멀티바이트(한글)가 청크 경계에서 잘려도 깨지지 않게 StringDecoder 를 쓴다.
function createLineSplitter(onLine) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  };
}

module.exports = { createRelay, createLineSplitter, parseIdleMs };
