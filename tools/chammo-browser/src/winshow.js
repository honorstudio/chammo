// 윈도우 '보이는 창으로 다시 띄우기'(2026-10-28 인앱 브라우저 윈도우판) — 숨은 데스크톱(src/windesk.js)의 OS 창(패스키·Windows Hello·OS 파일 창)은
// 사람이 못 본다(spike 결과). 사람 차례에 그런 창이 필요하면 앱이 <live>/<프로필>.show {pid, at, on:true} 를 쓰고, 래퍼가 같은 프로필을
// 보이는 데스크톱에 다시 띄운다(지금 주소 다시 열기 — 다른 탭은 안 돌아온다, spike 5절). 다 했으면 {on:false, done} 으로 숨은 데스크톱으로 되돌리고,
// 앱이 넘긴 '다 했어' 표(.done)는 다 띄운 뒤에 남긴다 — 세션이 숨은 크롬에서 이어 가게(못 바꿔 미뤘으면 바로). 맥 '크롬 창 꺼내기'와 같은 자리(꺼냄 표시 <프로필>.shown)
// 맥 패스키 탈출구(2026-10-28)도 같은 틀 — names 로 파일 이름만 바꾼다: <프로필>.signed 요청 → .signed-want 를 둔 채 다시 띄우면
// place-at-launch 가 구글 서명 원본으로 띄우고 → .signed-on 표. 되돌리면 ad-hoc 사본(Dock 숨김·SCK 칸)으로
const fs = require('fs');
const path = require('path');
const { parseResult } = require('./live');

const FRESH_MS = 60_000; // 이보다 오래된 요청은 버린다(앱이 꺼진 사이 남은 것)
// 래퍼가 패스키를 보고 스스로 바꾼 뒤 세션에 붙이는 꼬리 — 페이지가 새로 열려 세션이 들고 있던 ref 가 낡았다
const NOTE_ON = '[패스키] 이 사이트가 패스키를 불러서 같은 프로필을 구글 크롬으로 다시 열었어(맥 암호 앱 패스키는 그 크롬에서만 된다). 페이지가 새로 열렸어 — browser_snapshot 부터 보고, 패스키 단추를 다시 눌러야 하면 누른 뒤 사람 차례(Touch ID·암호 앱)는 browser_ask_human 으로 넘겨. 로그인이 끝나면 저절로 참모 브라우저로 돌아온다.';
const NOTE_OFF = '[패스키] 패스키가 끝나 참모 브라우저로 다시 열었어 — 같은 주소, 로그인 상태는 이어진다. browser_snapshot 부터 보고 이어서 해.';

/**
 * @param {object} o
 * @param {string} o.liveDir
 * @param {string} o.profile
 * @param {number} o.pid  이 래퍼 — 앱은 상태 파일의 pid 로 적는다
 * @param {(name:string, args:object, opts?:{keep?:boolean}) => Promise<object>} o.call  relay.callInternal
 * @param {{switching:(on:boolean)=>void, refresh:()=>void}} o.live
 */
const WIN = { req: 'show', mark: 'shown', want: 'visible' }; // want = windesk visibleFile
const SIGNED = { req: 'signed', mark: 'signed-on', want: 'signed-want' };

/**
 * @param {{req:string, mark:string, want:string}} [o.names]  파일 꼬리 — 윈도우 보이는 창(WIN)·맥 구글 크롬(SIGNED)
 * @param {() => Promise<void>} [o.beforeOpen]  닫은 뒤 다시 열기 전 — 맥은 옛 크롬이 프로필을 놓길 기다린다
 * @param {() => boolean} [o.claim]  다시 띄워도 되나 — 서랍 지킴이는 같이 쓰는 손님이 없을 때만(그 확인과 같이 쓰기 막기 표시를 한 번에, src/users.js claimSwitch)
 * @param {() => void} [o.release]  다 띄운 뒤 claim 이 남긴 표시를 푼다
 */
function createWinShow({ liveDir, profile, pid, call, live, names = WIN, beforeOpen = async () => {}, claim = () => true, release = () => {}, now = Date.now, log = () => {} }) {
  const req = path.join(liveDir, `${profile}.${names.req}`);
  const mark = path.join(liveDir, `${profile}.${names.mark}`);
  const wantFile = path.join(liveDir, `${profile}.${names.want}`);
  const doneFile = path.join(liveDir, `${profile}.done`);
  let shown = false;
  let running = null; // 바꾸는 중이면 그 약속 — 세션 도구가 기다린다
  let auto = false; // 패스키를 보고 래퍼가 스스로 바꿨나(사람이 고른 바꾸기는 사람이 되돌린다) — src/passkey.js
  let note = ''; // 다음 세션 도구 결과에 한 번 붙일 꼬리(스스로 바꿔 페이지가 새로 열렸다)
  // claim 에 막힌 되돌리기 — 손님이 떠나면 tick 이 한다(0.4.4 리뷰: 막힌 '돌아오기'를 버려 손님이 떠나도 구글 크롬에 남았다).
  // 막힌 켜기는 버린다 — 손님이 한참 뒤 떠날 때 갑자기 바뀌면 안 된다(사람은 다시 누르면 된다)
  let pendingOff = false;

  const textOf = (r) => ((r && r.content) || []).map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');

  /** 지금 탭 주소 — 사람이 칸에서 옮겼을 수 있어 세션이 마지막에 본 주소 말고 플레이라이트에 묻는다 */
  async function currentUrl() {
    const tabs = parseResult(textOf(await call('browser_tabs', { action: 'list' }))).tabs || [];
    const t = tabs.find((x) => x.current) || tabs[0];
    return (t && t.url) || 'about:blank';
  }

  let nextAuto = false;
  async function relaunch(visible) {
    const url = await currentUrl();
    log(`[chammo-browser-mcp] ${names.mark} ${visible ? '켬' : '끔'} — 지금 주소로 다시 띄움: ${url.split(/[?#]/)[0].slice(0, 200)}`);
    live.switching(true);
    try {
      if (visible) fs.writeFileSync(wantFile, JSON.stringify({ pid, at: now() }), { mode: 0o600 });
      const closed = await call('browser_close', {}, { keep: true });
      if (closed && closed.isError) log(`[chammo-browser-mcp] 다시 띄우려고 닫기 실패: ${textOf(closed).slice(0, 200)}`);
      await beforeOpen();
      const opened = await call('browser_navigate', { url });
      if (opened && opened.isError) log(`[chammo-browser-mcp] ${visible ? '보이는' : '숨은'} 창으로 다시 띄우기 실패: ${textOf(opened).slice(0, 200)}`);
    } finally {
      try { fs.rmSync(wantFile, { force: true }); } catch { /* 없음 */ }
      setShown(visible, nextAuto);
      live.switching(false);
      live.refresh();
    }
  }

  function setShown(on, isAuto = false) {
    shown = on;
    auto = on && isAuto;
    try {
      if (on) fs.writeFileSync(mark, JSON.stringify({ pid, at: now(), ...(auto ? { auto: true } : {}) }), { mode: 0o600 });
      else fs.rmSync(mark, { force: true });
    } catch { /* 앱 표시는 보조 */ }
  }

  // 버린 요청은 이유를 한 번 남긴다(10-28 — 손으로 쓴 {"on":true} 를 소리 없이 버려 '안 받는다'로만 보였다)
  let lastWhy = '';
  const why = (m) => {
    if (m === lastWhy) return;
    lastWhy = m;
    log(`[chammo-browser-mcp] ${path.basename(req)} 요청 버림: ${m}`);
  };

  async function tick() {
    if (running) return;
    let text;
    try { text = fs.readFileSync(req, 'utf8'); } catch {
      lastWhy = '';
      if (pendingOff) await switchTo(false);
      return;
    }
    let r = null;
    try { r = JSON.parse(text); } catch { /* 아래에서 */ }
    // 주인(pid) 없는 요청은 아무 래퍼도 안 받는다 — 지운다
    if (!r || typeof r !== 'object' || typeof r.pid !== 'number') {
      try { fs.unlinkSync(req); } catch { /* 없음 */ }
      return why(r && typeof r === 'object' ? `pid 가 없다(앱·agent_signed 가 {pid, at, on} 으로 쓴다): ${text.slice(0, 80)}` : `읽을 수 없다: ${text.slice(0, 80)}`);
    }
    if (r.pid !== pid) return why(`pid ${r.pid} 는 이 래퍼(${pid}) 것이 아니다`);
    try { fs.unlinkSync(req); } catch { return; } // 지운 쪽만 한다
    if (!(now() - Number(r.at) < FRESH_MS)) return why(`오래된 요청(at ${r.at}, ${FRESH_MS / 1000}초 넘음)`);
    lastWhy = '';
    await switchTo(!!r.on, { done: typeof r.done === 'string' ? r.done : '' });
  }

  /** 바꾸기 한 번 — 요청 파일(사람)·래퍼 스스로(패스키, isAuto) 같은 길. 바꾸는 중이면 그게 끝난 뒤 다시 판단한다 */
  async function switchTo(on, { auto: isAuto = false, done = '' } = {}) {
    while (running) await running.catch(() => {});
    running = (async () => {
      const wasAuto = auto;
      try {
        if (on === shown) pendingOff = false;
        else if (!claim()) {
          if (on || !pendingOff) log(`[chammo-browser-mcp] ${names.mark} ${on ? '켜기 버림' : '되돌리기 미룸'} — 같이 쓰는 손님이 있다`);
          pendingOff = !on;
        } else {
          pendingOff = false;
          nextAuto = isAuto;
          try { await relaunch(on); } finally { release(); }
          if (on && isAuto) note = NOTE_ON;
          else if (!on && wasAuto) note = NOTE_OFF;
        }
      } catch (e) {
        log(`[chammo-browser-mcp] 창 바꾸기 실패: ${e.message}`);
      } finally {
        nextAuto = false;
      }
      if (!on && done) {
        try { fs.writeFileSync(doneFile, done, { mode: 0o600 }); } catch { /* 사람이 다시 누르면 된다 */ }
      }
    })();
    try { await running; } finally { running = null; }
  }

  return {
    tick,
    /** 바꾸는 중이면 끝날 때까지 기다릴 약속, 아니면 null */
    hold: () => running,
    shown: () => shown,
    /** 래퍼가 스스로(패스키) 바꿔 둔 상태인가 */
    auto: () => auto,
    /** 래퍼 스스로 바꾸기·되돌리기 — 끝나면 풀리는 약속 */
    request: (on, o) => switchTo(!!on, o),
    /** 다음 세션 도구 결과에 붙일 꼬리 — 한 번만 */
    takeNote: () => { const n = note; note = ''; return n; },
    /** 브라우저가 닫혔다 — 꺼냄 표시도 */
    closed: () => setShown(false),
  };
}

module.exports = { createWinShow, FRESH_MS, WIN, SIGNED };
