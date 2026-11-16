#!/usr/bin/env node
// 터미널 한글 두 번(공개 이슈 #13) E2E — 진짜 xterm 6 에 크로미움 입력(CDP)을 넣고 onData 를 센다. 실패하면 종료 1.
// node app/e2e/term-ime/run.mjs — 참모 브라우저(창 없음)로 돈다
//  · guard=0(고치기 전): '조합 없이 keypress 로 오는 한글'이 두 번 나와야 한다(하네스가 버그를 잡는지)
//  · guard=1(고친 뒤): 모든 길이 친 그대로 한 번
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const PORT = 47561;
const base = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = await new Promise((r) => { const s = net.connect(PORT, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
if (busy) { console.log(`FAIL 포트 ${PORT} 를 다른 게 쥐고 있다`); process.exit(1); }
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'term-ime-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const stopVite = () => { try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ } };
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('term-ime-e2e', { headless: true });
try {
  const open = async (guard) => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`${base}?guard=${guard}`);
    await p.waitForFunction(() => window.__ready === true);
    await p.click('#t');
    const cdp = await context.newCDPSession(p);
    const key = (o) => cdp.send('Input.dispatchKeyEvent', o);
    const k = {
      /** 입력기가 먹은 키 — text 가 있으면 그 키에 글자가 확정된다(조합 이벤트 없이, 윈도우 WM_CHAR 길: keydown 229 → keypress → input) */
      ime: async (text) => {
        await key({ type: text ? 'keyDown' : 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Process', code: 'KeyD', ...(text ? { text, unmodifiedText: text } : {}) });
        await key({ type: 'keyUp', windowsVirtualKeyCode: 229, key: 'Process', code: 'KeyD' });
      },
      /** 같은 길인데 글자가 xterm 의 0ms 타이머보다 늦게 온다 */
      imeLate: async (text) => {
        await key({ type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Process', code: 'KeyD' });
        await sleep(30);
        await key({ type: 'char', text, unmodifiedText: text, key: text });
        await key({ type: 'keyUp', windowsVirtualKeyCode: 229, key: 'Process', code: 'KeyD' });
      },
      /** 조합 이벤트가 있는 길(켜자마자 터미널 보기) — keydown 229 마다 조합 글이 바뀌고 끝에 확정 */
      compose: async (steps, commit) => {
        for (const s of steps) {
          await key({ type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Process', code: 'KeyD' });
          await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
          await key({ type: 'keyUp', windowsVirtualKeyCode: 229, key: 'Process', code: 'KeyD' });
        }
        await cdp.send('Input.insertText', { text: commit });
      },
      plain: async (ch) => {
        const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
        await key({ type: 'keyDown', windowsVirtualKeyCode: vk, key: ch, code: ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`, text: ch, unmodifiedText: ch });
        await key({ type: 'keyUp', windowsVirtualKeyCode: vk, key: ch, code: ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}` });
      },
      enter: async () => {
        await key({ type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r' });
        await key({ type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
      },
    };
    const take = async () => { await sleep(80); const s = await p.evaluate(() => window.__sent.splice(0)); return s.join(''); };
    return { p, k, take, errs };
  };

  const cases = [
    ['조합 없이 keypress — 한 글자', async (k) => { await k.ime('한'); }, '한'],
    ['조합 없이 keypress — 안녕 하세요', async (k) => {
      await k.ime(); await k.ime(); await k.ime(); await k.ime('안'); await k.ime(); await k.ime('녕');
      await k.plain(' ');
      await k.ime(); await k.ime('하'); await k.ime(); await k.ime('세'); await k.ime('요');
    }, '안녕 하세요'],
    ['조합 없이 keypress — 글자가 타이머보다 늦게', async (k) => { await k.imeLate('한'); await k.imeLate('글'); }, '한글'],
    ['조합 없이 keypress — 기호·숫자도', async (k) => { await k.ime('.'); await k.ime('1'); }, '.1'],
    ['조합 길 — 한(ㅎ·하·한) 확정', async (k) => { await k.compose(['ㅎ', '하', '한'], '한'); }, '한'],
    ['조합 길 — 두 음절', async (k) => { await k.compose(['ㅇ', '아', '안'], '안'); await k.compose(['ㄴ', '녀', '녕'], '녕'); }, '안녕'],
    ['영문·스페이스·Enter', async (k) => { await k.plain('a'); await k.plain(' '); await k.plain('b'); await k.enter(); }, 'a b\r'],
    ['섞어서 — 영문 뒤 조합 없는 한글 뒤 영문', async (k) => { await k.plain('x'); await k.ime(); await k.ime('가'); await k.plain('y'); }, 'x가y'],
  ];

  const results = {};
  for (const guard of [0, 1]) {
    const { p, k, take, errs } = await open(guard);
    await take();
    results[guard] = {};
    for (const [name, run, want] of cases) {
      await run(k);
      const got = await take();
      results[guard][name] = got;
      if (guard === 1) ok(`[고친 뒤] ${name}`, got === want, `받음 ${JSON.stringify(got)} · 바람 ${JSON.stringify(want)}`);
    }
    ok(`[guard=${guard}] 페이지 오류 없음`, errs.length === 0, errs.join(' | '));
    await p.close();
  }
  // 하네스가 버그를 잡는지 — 고치기 전엔 조합 없는 길이 두 번이어야 한다
  ok('[고치기 전] 조합 없이 keypress — 한 글자가 두 번(재현)', results[0]['조합 없이 keypress — 한 글자'] === '한한', JSON.stringify(results[0]['조합 없이 keypress — 한 글자']));
  ok('[고치기 전] 안녕 하세요가 두 번씩(재현)', results[0]['조합 없이 keypress — 안녕 하세요'] !== '안녕 하세요', JSON.stringify(results[0]['조합 없이 keypress — 안녕 하세요']));
  for (const [name] of cases.slice(2)) console.log(`     [고치기 전] ${name}: ${JSON.stringify(results[0][name])}`);
} finally {
  await release();
  stopVite();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
process.exit(failed ? 1 : 0);
