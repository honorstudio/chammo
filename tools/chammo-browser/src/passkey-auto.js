// 패스키 자동 판단(2026-10-29) — 감시(src/passkey.js)가 알린 신호로 구글 크롬↔ad-hoc 사본을 바꾼다(src/winshow.js request).
// 페이지가 패스키를 부르면(ask) 세션 도구가 끝난 뒤 구글 크롬으로, 성공(ok) 뒤 주소가 바뀌고 잠잠해지면·30초가 지나면·사람이 '다 했어'면 돌아온다
const SETTLE_MS = 1500; // 성공 뒤 주소가 바뀌고 이만큼 잠잠하면 돌아온다(로그인 뒤 넘겨주기가 끝나게)
const OK_MAX_MS = 30_000; // 성공했는데 주소가 안 바뀌는 사이트 — 이만큼 뒤엔 돌아온다
const AGAIN_MS = 60_000; // 돌아온 뒤 이만큼은 저절로 다시 안 바꾼다 — 돌아온 페이지가 또 패스키를 부르면 끝없이 돈다
const IDLE_MAX_MS = 4000; // 세션 도구가 끝나길 기다리는 끝 — 패스키를 부른 click 이 끝나기 전에 닫으면 그 click 이 오류로 끝났다(실측)

/**
 * 자동 바꾸기 판단 — 감시 신호(ask·ok)와 1초 tick, 사람 '다 했어'. 사람이 직접 고른 구글 크롬(winshow.auto() false)은 저절로 안 되돌린다
 * idle = 세션 도구가 안 도는가(relay.busy) — 도는 중이면 끝난 뒤 바꾼다
 * @param {{ winshow: {shown:()=>boolean, auto:()=>boolean, request:(on:boolean, o?:{auto?:boolean})=>Promise<void>}, url: (t:string)=>string|undefined, canSwitch: () => boolean, idle?: () => boolean, wait?: (ms:number) => Promise<void>, now?: () => number, log?: (m:string)=>void }} o
 */
function createPasskeyAuto({ winshow, url, canSwitch, idle = () => true, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {} }) {
  let ok = null; // 성공을 본 때 { target, url, last, changedAt, at }
  let backAt = null; // 마지막으로 돌아온 때(저절로든 사람 '돌아오기'든)
  let wasShown = false; // 지난번에 본 갈래 — 구글 크롬이었다가 사본이면 누가 되돌렸든 돌아온 것
  // 사람이 칸 '돌아오기'(앱 .signed off)로 되돌리면 이 판단을 안 거친다 — 그것도 돌아온 것으로 센다(10-29 실측: 다시 열린 페이지가 또 불러 곧바로 또 바꿨다)
  const seen = () => {
    const sh = winshow.shown();
    if (wasShown && !sh) backAt = now();
    wasShown = sh;
  };

  async function back(why) {
    ok = null;
    backAt = now();
    log(`[chammo-browser-mcp] 패스키 끝(${why}) — 참모 브라우저로 돌아감`);
    await winshow.request(false);
    wasShown = winshow.shown();
  }

  return {
    async signal(phase, target) {
      seen();
      if (phase === 'ask') {
        if (winshow.shown()) return;
        if (backAt != null && now() - backAt < AGAIN_MS) return log('[chammo-browser-mcp] 패스키를 또 불렀지만 방금 돌아와서 안 바꿈(되풀이 막기) — 칸 더보기 \'이번만 구글 크롬으로 열기\'');
        if (!canSwitch()) return log('[chammo-browser-mcp] 패스키를 불렀지만 스크립트와 같이 쓰는 크롬이라 못 바꿔 — 칸 더보기 \'이번만 구글 크롬으로 열기\'');
        ok = null;
        for (let n = 0; !idle() && n < IDLE_MAX_MS / 100; n++) await wait(100);
        if (winshow.shown()) return;
        log('[chammo-browser-mcp] 페이지가 패스키를 불러 구글 크롬으로 바꿈');
        await winshow.request(true, { auto: true });
        wasShown = winshow.shown();
        return;
      }
      if (phase === 'ok' && winshow.shown() && winshow.auto()) {
        const u = url(target);
        ok = { target, url: u, last: u, changedAt: now(), at: now() };
      }
    },
    async tick() {
      seen();
      if (!ok) return;
      if (!winshow.shown() || !winshow.auto()) { ok = null; return; }
      const t = now();
      const u = url(ok.target);
      if (u !== ok.last) { ok.last = u; ok.changedAt = t; }
      if (ok.last !== ok.url && t - ok.changedAt >= SETTLE_MS) return back('로그인 뒤 주소 바뀜');
      if (t - ok.at >= OK_MAX_MS) return back('성공 뒤 30초');
    },
    /** 지금 페이지 부름에 바꿀 수 있나 — 감시가 이때만 부름을 붙잡는다(못 바꾸는데 6초씩 붙잡아 패스키가 늘 늦었다, 0.4.4 리뷰) */
    ready() {
      seen();
      return !winshow.shown() && !(backAt != null && now() - backAt < AGAIN_MS) && !!canSwitch();
    },
    /** 사람이 칸에서 '다 했어'를 눌렀다(browser_ask_human 끝) */
    async humanDone() {
      if (winshow.shown() && winshow.auto()) await back('사람이 다 했어');
    },
  };
}

module.exports = { createPasskeyAuto };
