// 스크립트 지킴이(chammo-browser launch)가 프로필을 쥔 동안 세션 브라우저 도구도 그 크롬을 같이 쓴다 — roadmap 부채 browser-scripts ①.
// 래퍼가 처음 띄운 playwright 는 --user-data-dir 로 자기 크롬을 띄우려는 것이라, 같이 쓸 땐 --cdp-endpoint 로 붙는 playwright 를 하나 더 띄워
// 세션이 처음에 했던 인사(initialize)를 대신 다시 하고, 세션 몫 새 탭을 연 뒤 그쪽으로 중계한다(스크립트 탭은 안 건드린다). 지킴이 명부(src/users.js)에 래퍼 pid 를 올려
// 세션이 쓰는 동안 지킴이가 크롬을 안 닫게 하고, 놓을 때(browser_close·유휴·래퍼 끝) 빠진다.
// 다른 세션의 브라우저 도구와는 같이 쓰지 않는다(프로필 락 = 한 세션) — 지킴이(by=script)만
const { createLineSplitter } = require('./relay');

const INIT_ID = 'chammo-share-init';
const TAB_ID = 'chammo-share-tab';

/** 이 락 실패가 같이 쓸 스크립트 지킴이 것인가 */
function scriptHolder(r) {
  return !!(r && !r.ok && r.reason === 'locked' && r.holder && r.holder.by === 'script' && Number.isInteger(r.holder.pid));
}

/**
 * @param {object} d
 * @param {() => ({port:number, wsPath:string}|null)} d.readPort  그 프로필 크롬의 CDP 포트(DevToolsActivePort)
 * @param {(pid:number) => boolean} d.holderAlive
 * @param {(holder:number) => boolean} d.join   명부에 래퍼를 올린다 — 지킴이가 그대로·닫는 중 아님일 때만 true
 * @param {() => void} d.leave
 * @param {(args:string[]) => object} d.spawnChild  playwright 인자 → child(stdin·stdout·kill·on('exit'))
 * @param {(line:string) => void} d.onLine  child 의 세션 몫 줄(인사 답 빼고)
 */
function createShare(d) {
  const hello = []; // 세션이 처음 보낸 initialize·notifications/initialized
  let child = null;
  let holder = null;
  let ready = false;
  let dead = false;
  const queue = [];

  function remember(line) {
    if (hello.length >= 2) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m && (m.method === 'initialize' || m.method === 'notifications/initialized')) hello.push(m);
  }

  function write(line) {
    try { child.stdin.write(`${line}\n`); } catch { /* 죽은 child — still() 이 잡는다 */ }
  }

  function start(h) {
    const port = d.readPort();
    if (!port || !d.join(h.pid)) return false;
    holder = h.pid;
    ready = false;
    dead = false;
    child = d.spawnChild(['--cdp-endpoint', `ws://127.0.0.1:${port.port}${port.wsPath}`]);
    const me = child;
    me.on('exit', () => { if (child === me) dead = true; });
    me.stdout.on('data', createLineSplitter((line) => {
      if (child !== me) return;
      if (!ready) {
        let m = null;
        try { m = JSON.parse(line); } catch { /* 그냥 넘김 */ }
        // 인사 답 → 세션 몫 새 탭(스크립트가 쓰던 탭을 세션 navigate 가 옮기지 않게) → 그 답 → 쥐고 있던 세션 줄
        if (m && m.id === INIT_ID) {
          for (const h2 of hello.filter((x) => x.method !== 'initialize')) write(JSON.stringify(h2));
          write(JSON.stringify({ jsonrpc: '2.0', id: TAB_ID, method: 'tools/call', params: { name: 'browser_tabs', arguments: { action: 'new' } } }));
          return;
        }
        if (m && m.id === TAB_ID) {
          ready = true;
          for (const l of queue.splice(0)) write(l);
          return;
        }
      }
      d.onLine(line);
    }));
    const init = hello.find((x) => x.method === 'initialize');
    const params = (init && init.params) || { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chammo-browser-share', version: '1' } };
    write(JSON.stringify({ jsonrpc: '2.0', id: INIT_ID, method: 'initialize', params }));
    return true;
  }

  function send(line) {
    if (!child) return;
    if (ready) write(line);
    else queue.push(line);
  }

  function stop() {
    if (!child) return;
    const c = child;
    child = null;
    holder = null;
    queue.length = 0;
    try { c.stdin.end(); } catch { /* 이미 닫힘 */ }
    try { c.kill(); } catch { /* 이미 끝남 */ }
    try { d.leave(); } catch { /* 명부가 없어졌으면 그만 */ }
  }

  return {
    remember,
    start,
    send,
    stop,
    active: () => !!child,
    still: () => !!child && !dead && d.holderAlive(holder),
  };
}

module.exports = { createShare, scriptHolder, INIT_ID };
