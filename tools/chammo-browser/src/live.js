// 세션 브라우저 앱에서 보기(2026-10-03 사용자 "가보자") — 래퍼가 지금 탭·하는 일·CDP 포트를
// <브라우저 루트>/live/<프로필>.json(600) 에 적는다. 앱(agent_browser.rs)이 읽고 그 포트로 붙어 화면을 받는다.
// 포트는 이 파일로만 알린다(폴더 700·파일 600). 친 글·코드 값은 적지 않는다 — 앱 화면·파일에 비밀번호가 남지 않게
const fs = require('fs');
const path = require('path');

const MAX_LINE = 120;

/** 기능 스위치 — <데이터 폴더>/config.json features.agentView. 없거나 깨졌으면 켬(기본) */
function enabled(dataDir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    return !(c && c.features && c.features.agentView === false);
  } catch {
    return true;
  }
}

/** MCP 응답 글에서 지금 탭 주소·제목·탭 목록. 없는 건 안 넣는다 */
function parseResult(text) {
  const out = {};
  const url = /^- Page URL: (.+)$/m.exec(text);
  if (url) out.url = url[1].trim();
  const title = /^- Page Title: (.*)$/m.exec(text);
  if (title) out.title = title[1].trim();
  const tabs = [];
  for (const m of text.matchAll(/^- (\d+): (\(current\) )?\[(.*)\]\((.*)\)$/gm)) {
    tabs.push({ index: Number(m[1]), title: m[3], url: m[4], current: !!m[2] });
  }
  if (tabs.length) out.tabs = tabs;
  return out;
}

const cut = (s) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

/** 주소는 쿼리·조각을 뗀다(토큰이 붙어 오는 일이 많다) */
function bareUrl(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname === '/' ? '/' : x.pathname}`;
  } catch {
    return '';
  }
}

const WORDS = {
  browser_navigate: '이동', browser_navigate_back: '뒤로', browser_click: '누름', browser_hover: '올림', browser_drag: '끌기',
  browser_type: '입력', browser_fill_form: '양식 채움', browser_select_option: '고름', browser_press_key: '키',
  browser_snapshot: '화면 읽기', browser_take_screenshot: '캡처', browser_tabs: '탭', browser_wait_for: '기다림',
  browser_evaluate: '스크립트', browser_run_code_unsafe: '스크립트', browser_file_upload: '파일 올림', browser_handle_dialog: '대화상자',
  browser_resize: '창 크기', browser_close: '닫기', browser_console_messages: '콘솔 읽기', browser_network_requests: '요청 읽기',
  script: '스크립트', // chammo-browser launch 로 띄운 크롬(src/script.js)
};

/** 하는 일 한 줄 — 무엇을 어디에. 값(친 글·양식·코드·파일)은 안 적는다 */
function toolLine(name, args = {}) {
  const word = WORDS[name] || String(name || '').replace(/^browser_/, '');
  const a = args || {};
  let what = '';
  if (name === 'browser_navigate' || name === 'script') what = bareUrl(a.url || '');
  else if (name === 'browser_press_key') what = typeof a.key === 'string' ? a.key : '';
  else if (name === 'browser_tabs') what = typeof a.action === 'string' ? a.action : '';
  else if (typeof a.element === 'string') what = a.element;
  return cut(what ? `${word} ${what}` : word);
}

/** 프로필 폴더 DevToolsActivePort — 크롬이 --remote-debugging-port=0 으로 고른 포트. 모양이 다르면 null */
function readPort(profileDir) {
  try {
    const [p, ws] = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    const port = Number(p);
    if (!/^\d+$/.test(p) || port < 1 || port > 65535) return null;
    if (!/^\/devtools\/browser\/[\w-]+$/.test((ws || '').trim())) return null;
    return { port, wsPath: ws.trim() };
  } catch {
    return null;
  }
}

const liveFile = (root, profile) => path.join(root, 'live', `${profile}.json`);

/** 127.0.0.1:포트에 실제로 듣는 곳이 있나 — 크롬이 죽어도 프로필의 DevToolsActivePort 는 남아서 파일만으론 모른다 */
function portOpen(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = require('net').connect({ host: '127.0.0.1', port });
    const end = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => end(false));
    sock.once('connect', () => end(true));
    sock.once('error', () => end(false));
  });
}

/** 600 권한으로 통째로 바꿔 쓴다(반쯤 쓴 파일을 앱이 읽지 않게) */
function writeSecure(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* 남의 폴더면 그대로 */ }
  const tmpFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(obj), { mode: 0o600 });
  fs.chmodSync(tmpFile, 0o600);
  fs.renameSync(tmpFile, file);
}

/**
 * @param {object} o
 * @param {string} o.profile @param {string} o.root 브라우저 루트 @param {string} o.profileDir
 * @param {number} o.pid 래퍼 pid @param {number} o.ppid claude 세션 pid(앱이 세션과 잇는다)
 */
function createLive({ profile, root, profileDir, pid, ppid, now = Date.now, probe = portOpen, gate = false }) {
  const file = liveFile(root, profile);
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  // gate = 사람이 '개입'하면 세션 도구를 붙잡을 수 있다(래퍼, src/takeover.js) — 앱이 없으면 '멈추지 못함'으로 보인다.
  // held = 세션 도구가 사람이 돌려주길 기다리는 중(그때부터 ms)
  const s = { url: '', title: '', tabs: [], tool: '', toolAt: 0, busy: false, ask: null, gate: !!gate, held: 0 };
  // 브라우저가 열려 있나 — 플레이라이트 도구를 부르면 열리고, 닫히면(closed) 끈다. 닫힌 뒤엔 크롬이 남긴 포트 파일이 있어도
  // 상태 파일을 안 쓴다 — 유휴 닫기 뒤 사람 부르기가 죽은 포트로 상태 파일을 다시 써서 앱이 '화면 받는 중'에 멈췄다(2026-10-05 QA 5)
  let up = false;
  const doneFile = path.join(path.dirname(file), `${profile}.done`);
  // 사람이 앱 모달에서 연 파일 창 수 — 앱(agent_browser.rs)이 늘려 적는다. 플레이라이트도 같은 창을 '[File chooser]' 상태로 쌓아
  // 세션의 브라우저 도구가 'does not handle the modal state' 로 막혔다(QA N3) — 그만큼 다음 호출 앞에서 치운다
  const choosersFile = path.join(path.dirname(file), `${profile}.choosers`);
  let choosersTaken = 0;
  /** 브라우저가 없다 — 상태 파일·파일 창 수를 치운다. 확실히 닫혔으면(closed) 크롬이 남긴 포트 파일도 */
  function gone(dropPort) {
    up = false;
    s.ask = null;
    s.held = 0;
    for (const f of [file, choosersFile, ...(dropPort ? [portFile] : [])]) {
      try { fs.rmSync(f, { force: true }); } catch { /* 없음 */ }
    }
    choosersTaken = 0;
  }
  function flush() {
    if (!up) return;
    const port = readPort(profileDir);
    if (!port) return; // 크롬이 아직 안 떴다
    try {
      writeSecure(file, { profile, pid, sessionPid: ppid, ...port, ...s, ts: now() });
    } catch { /* 상태 파일은 보조 — 못 써도 브라우저 일은 그대로 */ }
  }
  return {
    /** 시작 — 지난 크롬이 남긴 포트 파일·상태 파일을 지운다 */
    reset() {
      try { fs.rmSync(path.join(profileDir, 'DevToolsActivePort'), { force: true }); } catch { /* 없음 */ }
      try { fs.rmSync(file, { force: true }); } catch { /* 없음 */ }
      try { fs.rmSync(choosersFile, { force: true }); } catch { /* 없음 */ }
      choosersTaken = 0;
    },
    /** 아직 안 치운 사람 파일 창 수(한 번에 10개까지) — 가져가면 치운 것으로 센다 */
    takeHumanChoosers() {
      let n = 0;
      try {
        const t = fs.readFileSync(choosersFile, 'utf8').trim();
        if (/^\d{1,9}$/.test(t)) n = Number(t);
      } catch { return 0; }
      const fresh = Math.min(Math.max(0, n - choosersTaken), 10);
      choosersTaken = Math.max(choosersTaken, n);
      return fresh;
    },
    onCall(name, args) {
      if (name !== 'browser_close') up = true;
      s.tool = toolLine(name, args);
      s.toolAt = now();
      s.busy = true;
      flush();
    },
    onResult(name, result) {
      s.busy = false;
      const text = ((result && result.content) || []).map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
      const r = parseResult(text);
      if (r.url) s.url = r.url;
      if (r.title != null && r.url) s.title = r.title;
      if (r.tabs) s.tabs = r.tabs;
      flush();
    },
    /**
     * 사람 부르기(browser_ask_human) — 상태 파일에 ask 를 적으면 앱이 그 세션 브라우저를 크게 띄우고 알린다.
     * 사람이 '다 했어'를 누르면 앱이 <live>/<프로필>.done 을 만든다 → 지우고 돌아온다. 브라우저가 안 떠 있으면 바로 실패
     */
    async askHuman(reason, { pollMs = 500, timeoutMs = 10 * 60_000, probeMs = 5000 } = {}) {
      const NOT_UP = '브라우저가 안 떠 있어 — 먼저 browser_navigate 로 그 페이지를 열어';
      const port = up ? readPort(profileDir) : null;
      if (!port) return { ok: false, text: NOT_UP };
      // 바쁜 맥에서 한 번 늦은 걸 죽음으로 보지 않게 한 번 더(2초). 확인 실패면 포트 파일은 남긴다 — 살아 있는 크롬이면 다시 안 써 준다
      const dead = async () => !(await probe(port.port)) && !(await probe(port.port, 2000));
      if (await dead()) {
        gone(false);
        return { ok: false, text: '브라우저가 꺼져 있어 — browser_navigate 로 그 페이지를 다시 열고 불러' };
      }
      try { fs.rmSync(doneFile, { force: true }); } catch { /* 없음 */ }
      s.ask = { reason: cut(String(reason || '사람이 해야 할 일').replace(/\s+/g, ' ').trim()).slice(0, 200), at: now() };
      flush();
      const until = Date.now() + timeoutMs;
      let probeAt = Date.now() + probeMs;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, pollMs));
        if (fs.existsSync(doneFile)) {
          try { fs.rmSync(doneFile, { force: true }); } catch { /* 없음 */ }
          s.ask = null;
          flush();
          return { ok: true, text: '사람이 다 했다고 했어 — browser_snapshot 으로 지금 화면을 확인하고 이어서 해' };
        }
        // 기다리는 동안 크롬이 닫히거나(browser_close) 죽으면 그만 — 앱은 죽은 브라우저를 못 보여 준다
        if (!up) return { ok: false, text: '기다리는 동안 브라우저가 닫혔어 — browser_navigate 로 다시 열고 불러' };
        if (Date.now() >= probeAt) {
          probeAt = Date.now() + probeMs;
          if (await dead()) {
            gone(false);
            return { ok: false, text: '기다리는 동안 브라우저가 꺼졌어 — browser_navigate 로 다시 열고 불러' };
          }
        }
      }
      s.ask = null;
      flush();
      return { ok: false, timeout: true, text: '아직 사람이 안 끝냈어 — 기다리려면 browser_ask_human 을 다시 불러' };
    },
    /** 세션 도구가 사람 개입이 끝나길 기다리기 시작·끝 */
    held(on) {
      s.held = on ? now() : 0;
      flush();
    },
    /** 브라우저가 닫혔다(browser_close·유휴 닫기·래퍼 끝) — 플레이라이트 파일 창 상태도 같이 사라지니 수도 처음부터. 크롬이 남긴 포트 파일도 지운다 */
    closed() {
      gone(true);
    },
  };
}

module.exports = { enabled, parseResult, toolLine, readPort, liveFile, createLive, writeSecure, portOpen };
