// 셸 탭 E2E — 시험 앱 메인 창에서 돈다(HONOR_ORCH_DEBUG_JS, 3초마다 다시 읽혀서 window 표시로 한 번만).
// 진짜 로그인 셸(zsh -l)을 열어 붙여넣기·Enter·⌘K·⌘+·⌥⌘T·탭 오가기·닫기 확인·exit 를 해 보고, 단계마다 DOM 을 떠(debug_dump) 하네스가 헤드리스로 그린다.
// __MODE__ = 'after' | 'before'(옛 판 — 탭 줄만 떠 간다)
if (!window.__shTest) {
  window.__shTest = 1;
  const MODE = '__MODE__';
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const dump = (name, text) => inv('debug_dump', { name, text: typeof text === 'string' ? text : JSON.stringify(text) }).catch(() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = { steps: [] };
  const log = (k, v) => { res.steps.push([k, v]); dump('result', res); };
  const until = async (what, f, ms = 15000) => {
    const t = Date.now();
    for (;;) { const v = f(); if (v) return v; if (Date.now() - t > ms) throw new Error(`기다리다 끝남: ${what}`); await sleep(100); }
  };
  const snap = (name) => {
    const css = [...document.styleSheets].map((ss) => { try { return [...ss.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const html = document.documentElement.cloneNode(true);
    html.querySelectorAll('script, link[rel="stylesheet"], style').forEach((x) => x.remove());
    return dump(`snap-${name}`, { w: innerWidth, h: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches, css, html: html.outerHTML });
  };
  const pane = () => document.querySelector('.lk-shell .pane.shell');
  const ta = () => pane()?.querySelector('.xterm-helper-textarea');
  const rows = () => [...(pane()?.querySelectorAll('.xterm-rows > div') ?? [])].map((d) => d.textContent.replace(/ /g, ' ').trimEnd());
  const text = () => rows().join('\n');
  const paste = (t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); ta().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
  const key = (k, code, kc, mods = {}, el = ta()) => { const e = new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, 'keyCode', { get: () => kc }); el.dispatchEvent(e); };
  const run = async (cmd, want, ms) => { paste(cmd); await sleep(150); key('Enter', 'Enter', 13); return until(`${cmd} → ${want}`, () => (typeof want === 'string' ? text().includes(want) : want.test(text())) && text(), ms); };
  const shellTabs = () => [...document.querySelectorAll('.lk-tab.shell')];
  // 표식은 셸이 셈해서 찍는다 — 친 명령 줄 자체에 표식 글이 있으면 답이 오기 전에 읽는다
  let n = 0;
  const mark = () => { n += 1; return { cmd: `echo M-$((${n}+1000))`, want: `M-${n + 1000}` }; };
  const runM = async (cmd) => { const m = mark(); return run(`${cmd}; ${m.cmd}`, m.want); };
  const fontPx = () => getComputedStyle(pane()?.querySelector('.xterm-rows') ?? document.body).fontSize;
  const sttySize = async () => { const t = await runM('stty size'); const m = [...t.matchAll(/^(\d+) (\d+)$/gm)].pop(); return m ? { rows: +m[1], cols: +m[2] } : null; };
  (async () => {
    try {
      localStorage.setItem('term-dom', '1');
      await until('탭 줄', () => document.querySelector('.lk-tabs'), 60000);
      await sleep(2500);
      await snap('1-tabs');
      log('tabs', [...document.querySelectorAll('.lk-tabs > button, .lk-tabs .lk-tab')].map((b) => b.getAttribute('aria-label') || b.textContent).slice(0, 12));
      if (MODE === 'before') { log('done', true); return; }

      // ① 탭 줄 단추로 연다 — 시작 폴더는 devRoot(고른 프로젝트 없음)
      document.querySelector('.lk-shell-new').click();
      await until('셸 칸', () => ta());
      await until('셸 프롬프트', () => /[%$#>] ?$/m.test(text()), 20000);
      const t1 = await run('echo "ok-$((40+2)) 한글 [$TERM] [$LANG] [$TERM_PROGRAM] [${HONOR_ORCH_DEBUG_JS:-없음}] [${CHAMMO_NO_OS_NOTIFY:-없음}]"; pwd', /ok-42 한글 \[/);
      log('echo', t1.split('\n').filter((l) => l.includes('ok-42') || l.startsWith('/')).slice(-3));
      log('title1', shellTabs().map((x) => x.textContent));
      await snap('2-shell');

      // ② 크기 — stty 가 xterm 줄 수와 같다, ⌘+ 두 번이면 칸 수가 준다(글꼴 크기 → pty resize)
      const s0 = await sttySize();
      const xrows0 = rows().length;
      const f0 = fontPx();
      key('=', 'Equal', 187, { metaKey: true }); await sleep(300); key('=', 'Equal', 187, { metaKey: true }); await sleep(1200);
      const f1 = fontPx();
      const s1 = await sttySize();
      const xrows1 = rows().length;
      key('0', 'Digit0', 48, { metaKey: true }); await sleep(900);
      log('size', { s0, xrows0, s1, xrows1, f0, f1 });

      // ③ ⌘K — 화면·스크롤 지움(지금 줄만 남는다)
      const before = rows().filter(Boolean).length;
      key('k', 'KeyK', 75, { metaKey: true }); await sleep(600);
      const after = rows().filter(Boolean).length;
      const searchOpened = document.activeElement?.matches?.('input');
      log('cmdK', { before, after, searchOpened });
      await runM('echo MARK-ONE');

      // ④ 여러 개 — ⌥⌘T(키 자리), '여기서 터미널'(프로젝트 폴더)
      key('†', 'KeyT', 84, { metaKey: true, altKey: true }); await sleep(1500);
      const env = await inv('app_env').catch(() => ({}));
      const dev = env.devRoot ?? '';
      window.dispatchEvent(new CustomEvent('shell-open', { detail: { cwd: `${dev}/alpha-app` } }));
      await until('셋째 탭', () => shellTabs().length === 3);
      await until('셋째 셸 프롬프트', () => /[%$#>] ?$/m.test(text()), 20000);
      const t3 = await runM('pwd');
      log('tabs3', { titles: shellTabs().map((x) => x.textContent), pwd: t3.split('\n').filter((l) => l.startsWith('/')).pop() });
      await snap('3-three-tabs');

      // ⑤ 다른 탭(홈)에 갔다 와도 셸이 산다 — 첫 탭 글이 그대로
      document.querySelector('.lk-tab.home').click(); await sleep(1200);
      shellTabs()[0].click(); await sleep(1200);
      log('kept', { mark: text().includes('MARK-ONE') });
      await runM('echo BACK-OK');

      // ⑥ 돌던 프로그램 — 닫기 전에 한 번 묻는다, Esc 면 그대로, ^C 뒤엔 바로 닫힌다
      paste('sleep 30'); await sleep(100); key('Enter', 'Enter', 13); await sleep(1200);
      document.querySelector('.lk-tab.shell.on button').click();
      const ask = await until('닫기 확인', () => document.querySelector('.od-box')?.textContent, 5000).catch(() => null);
      await snap('4-confirm');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(500);
      const stillThere = shellTabs().length === 3;
      key('c', 'KeyC', 67, { ctrlKey: true }); await sleep(800);
      document.querySelector('.lk-tab.shell.on button').click(); await sleep(1200);
      log('busyClose', { ask, stillThere, afterClose: shellTabs().length, dialog: !!document.querySelector('.od-box') });

      // ⑦ exit 를 치면 탭이 닫힌다
      shellTabs()[0].click(); await sleep(800);
      paste('exit'); await sleep(100); key('Enter', 'Enter', 13);
      await until('exit 뒤 탭 하나', () => shellTabs().length === 1, 8000).catch(() => null);
      log('exitClose', { tabs: shellTabs().length });
      await snap('5-end');
      log('done', true);
    } catch (e) {
      log('error', String(e && e.stack || e));
      await snap('error');
    }
  })();
}
