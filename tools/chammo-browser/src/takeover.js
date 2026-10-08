// 사람 개입(2026-10-06 사용자 설계) — 앱(세션 브라우저 칸·크게 보기·폰)에서 사람이 '개입'을 누르면 앱이 <live>/<프로필>.takeover 를 쓴다.
// 그동안 세션의 다음 브라우저 도구는 여기서 붙잡혀 기다리고(사람 조작과 섞이지 않게), '돌려주기'를 누르면 앱이
// <live>/<프로필>.handback(사람이 한 일 — 간 주소·누른 곳·입력한 칸 이름. 친 값은 앱이 처음부터 안 적는다)을 쓰고 .takeover 를 지운다.
// 돌려준 뒤 첫 결과에 꼬리표를 붙이고, snapshot 하기 전까지 누르기·치기는 실행하지 않는다 — 옛 화면의 ref 로 엉뚱한 걸 누르지 않게.
//
// 왜 '막힘(바로 오류)'이 아니라 '기다림'인가: 바로 오류를 주면 세션이 같은 호출을 되풀이하거나(토큰) 포기하고 다른 길로 간다.
// 기다리면 세션은 그 자리에 멈춰 있다가 돌려받은 화면 기준으로 이어 간다. 다만 붙잡힌 호출을 돌려준 뒤 그대로 실행하진 않는다(옛 화면 기준이라)
const fs = require('fs');
const path = require('path');

const HOLD_MS = 10 * 60_000; // 한 번에 이만큼 기다리고 '아직'으로 돌아온다(browser_ask_human 과 같은 결)
const STALE_MS = 3 * 60_000; // 앱이 이만큼 개입 파일을 안 고치면(앱 꺼짐) 개입을 푼다 — 앱은 살아 있는 동안 몇 초마다 고친다
const MAX_ITEMS = 8; // 꼬리표 한 줄에 싣는 수

const READ = new Set([
  'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_wait_for', 'browser_find',
  'browser_cookie_list', 'browser_cookie_get', 'browser_localstorage_list', 'browser_localstorage_get', 'browser_sessionstorage_list', 'browser_sessionstorage_get',
  'browser_get_config', 'browser_route_list', 'browser_generate_locator',
]);

/** 도구 종류 — fresh(새로 본다: 옛 화면 막기를 푼다) · read(화면을 안 바꾸는 읽기) · act(누르기·치기·탭 고르기 등) */
function toolKind(name, args = {}) {
  if (name === 'browser_snapshot' || name === 'browser_navigate') return 'fresh';
  if (name === 'browser_tabs') return (args && args.action) === 'list' ? 'read' : 'act';
  if (READ.has(name) || /^browser_verify_/.test(name)) return 'read';
  return 'act';
}

const one = (s, max = 60) => {
  const t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** 주소는 출처+경로만(쿼리·조각엔 토큰이 붙어 온다) */
function bare(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return x.protocol;
    return `${x.origin}${x.pathname}`;
  } catch {
    return '';
  }
}

function list(items) {
  const uniq = [];
  for (const it of items) if (it && uniq[uniq.length - 1] !== it) uniq.push(it);
  const shown = uniq.slice(0, MAX_ITEMS).join(' · ');
  return uniq.length > MAX_ITEMS ? `${shown} 외 ${uniq.length - MAX_ITEMS}` : shown;
}

const SNAP = 'browser_snapshot 으로 지금 화면부터 보고 이어서 해';

/** 앱이 적은 돌려주기 기록 → 세션이 읽을 꼬리표. 값(친 글·파일 이름)은 받은 게 있어도 안 싣는다 */
function formatHandback(h) {
  const ev = Array.isArray(h && h.events) ? h.events.slice(0, 500) : [];
  const mins = Math.max(1, Math.round((Number(h.endedAt) - Number(h.startedAt)) / 60_000) || 1);
  const where = h.by === 'phone' ? '폰에서 ' : '';
  const pick = (k, f) => ev.filter((e) => e && e.k === k).map(f).filter(Boolean);
  const navs = pick('nav', (e) => bare(e.url));
  const clicks = pick('click', (e) => one(e.what));
  const typed = pick('type', (e) => (e.password ? '비밀번호 칸' : one(e.what)));
  const keys = pick('key', (e) => one(e.key, 20));
  const opened = pick('tab+', (e) => bare(e.url) || '새 탭');
  const closed = pick('tab-', (e) => bare(e.url) || '탭');
  const dialogs = pick('dialog', (e) => (e.accept ? '확인' : '취소'));
  const files = pick('files', (e) => (Number.isFinite(Number(e.n)) ? Number(e.n) : 0)).reduce((a, b) => a + b, 0);
  const lines = [`[사람 개입] 사람이 ${where}브라우저를 ${mins}분 조작하고 돌려줬어.`];
  if (navs.length) lines.push(`- 간 주소: ${list(navs)}`);
  if (clicks.length) lines.push(`- 누른 곳: ${list(clicks)}`);
  if (typed.length) lines.push(`- 글자를 넣은 칸(값은 안 남김): ${list(typed)}`);
  if (keys.length) lines.push(`- 누른 키: ${list(keys)}`);
  if (opened.length) lines.push(`- 연 탭: ${list(opened)}`);
  if (closed.length) lines.push(`- 닫은 탭: ${list(closed)}`);
  if (dialogs.length) lines.push(`- 페이지 대화상자에 답함: ${list(dialogs)}`);
  if (files) lines.push(`- 파일 ${files}개를 올림`);
  if (lines.length === 1) lines.push('- 한 일은 못 봤어(아무것도 안 했거나 앱이 못 본 곳에서 함)');
  if (h.chromeShown) lines.push('- 크롬 창을 꺼내 직접 만진 동안의 클릭·입력은 못 셌을 수 있어');
  if (h.lost) lines.push('- 앱이 응답이 없어 개입을 풀었어(사람이 돌려준 게 아님)');
  lines.push(`화면이 바뀌었을 수 있어 — ${SNAP}.`);
  return lines.join('\n');
}

/**
 * @param {object} o
 * @param {string} o.liveDir <브라우저 루트>/live  @param {string} o.profile  @param {number} o.pid 이 래퍼 pid(앱이 적는 pid 와 맞아야 내 것)
 */
function createTakeover({ liveDir, profile, pid, now = Date.now, staleMs = STALE_MS }) {
  const takeFile = path.join(liveDir, `${profile}.takeover`);
  const backFile = path.join(liveDir, `${profile}.handback`);
  let note = ''; // 아직 세션에 못 준 꼬리표
  let stale = false; // 돌려받은 뒤 아직 snapshot 전 — 누르기·치기는 실행 안 한다
  let lostAt = 0;

  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  /** 지금 내 개입인가. 앱이 오래 안 고친 파일(앱 꺼짐)은 치우고 '잃음'으로 기록 */
  function active(wallNow = Date.now) {
    const t = readJson(takeFile);
    if (!t || Number(t.pid) !== pid) return false;
    let mtime = 0;
    try { mtime = fs.statSync(takeFile).mtimeMs; } catch { return false; }
    if (wallNow() - mtime > staleMs) {
      try { fs.rmSync(takeFile, { force: true }); } catch { /* 없음 */ }
      note = formatHandback({ startedAt: Number(t.at) || mtime, endedAt: now(), by: t.by, events: [], lost: true });
      stale = true;
      lostAt = now();
      return false;
    }
    return true;
  }

  /** 앱이 쓴 돌려주기 기록을 가져와 꼬리표로(내 pid 것만). 있으면 snapshot 전까지 막는다 */
  function collect() {
    const h = readJson(backFile);
    if (!h) return;
    try { fs.rmSync(backFile, { force: true }); } catch { /* 없음 */ }
    if (Number(h.pid) !== pid) return;
    note = formatHandback(h);
    stale = true;
  }

  /** 개입이 없을 때 이 호출을 어떻게 — null(그냥) 또는 {run, note, isError} */
  function decide(name, args) {
    collect();
    const kind = toolKind(name, args);
    const n = note;
    // 닫기는 옛 화면과 상관없다 — 막지 않고 꼬리표만(닫히면 reset)
    if (name === 'browser_close') {
      stale = false;
      note = '';
      return n ? { run: true, note: n } : null;
    }
    if (kind === 'act' && stale) {
      note = '';
      const body = n || `[사람 개입] 사람이 브라우저를 만지고 돌려준 뒤 아직 화면을 안 봤어 — ${SNAP}.`;
      return { run: false, isError: true, note: `${body}\n이 호출(${name})은 실행하지 않았어 — snapshot 뒤에도 아직 필요하면 새 ref 로 다시 해.` };
    }
    if (kind === 'fresh') stale = false;
    if (!n) return null;
    note = '';
    return { run: true, note: n };
  }

  return {
    active,
    /** 개입 중 유휴 닫기 금지 — 사람이 쓰는 브라우저를 닫지 않게 */
    canClose: () => !active(),
    /**
     * 세션 도구 호출 하나 — null 이면 그대로, 아니면 Promise<{run, note, isError}>.
     * 개입 중이면 돌려줄 때까지(또는 timeoutMs) 기다린다
     */
    gate(name, args = {}, { pollMs = 500, timeoutMs = HOLD_MS, wallNow = Date.now } = {}) {
      if (!active(wallNow)) {
        const d = decide(name, args);
        return d && Promise.resolve(d);
      }
      return new Promise((resolve) => {
        const until = Date.now() + timeoutMs;
        const tick = () => {
          if (!active(wallNow)) return resolve(decide(name, args) || { run: true, note: '' });
          if (Date.now() >= until) return resolve({ run: false, isError: true, note: `[사람 개입] 아직 사람이 브라우저를 조작 중이야 — 이 호출(${name})은 실행하지 않았어. 사람이 돌려주면 이어서 해(잠시 뒤 다시 불러).` });
          setTimeout(tick, pollMs);
        };
        setTimeout(tick, pollMs);
      });
    },
    /** 사람 부르기가 끝났을 때 — 돌려주기 기록의 꼬리표(없으면 '') + snapshot 전까지 막기 */
    takeNote() {
      collect();
      const n = note;
      note = '';
      stale = true;
      return n;
    },
    /** 브라우저가 닫혔다 — 남은 꼬리표·막기는 의미 없다(다음 navigate 가 새로 연다) */
    reset() {
      collect();
      note = '';
      stale = false;
      lostAt = 0;
    },
    lostAt: () => lostAt,
  };
}

module.exports = { createTakeover, formatHandback, toolKind, bare, HOLD_MS, STALE_MS };
