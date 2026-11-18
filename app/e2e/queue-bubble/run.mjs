#!/usr/bin/env node
// 대기 말풍선 E2E(11-17 사용자 "보내지고 있는거는 일단 보내진 상태로 보게") — 진짜 ChatView·폰 MessageList 를 헤드리스로 띄워
// 일하는 중 3번 연달아 보내기 → 보통 말풍선 3개·단추 없음 · 그림 붙인 말 35초 뒤에도 '전달 안 됨' 아님 · 읽히면 점 사라짐 ·
// 죽은 세션에 보낸 말만 다시 보내기 · ⌘Enter 는 끊고 보내기 · 빈 입력칸 ↑ 는 줄 선 말 꺼내기.
// 11-17 '못 갔다' 장면(fail-*): 줄 선 말은 11분·71분 뒤에도 점 · 꺼진 세션에 묶인 말은 바로 바깥 다시 보내기(누르면 입력칸에 되살림) ·
// 다시 쳐도 입력칸에 걸린 말(stuck)은 바로 · 오른쪽 클릭 메뉴로만 빼기 · Claude 오류로 답 못 받은 기록 말풍선에 다시 보내기(로그인 풀림은 없음) · 폰도 같이.
// node app/e2e/queue-bubble/run.mjs [캡처 폴더] [--before <옛 app/src>] — --before 면 캡처만(검사 안 함). 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const args = process.argv.slice(2);
const bi = args.indexOf('--before');
const before = bi >= 0 ? path.resolve(args.splice(bi, 2)[1]) : null;
const tag = before ? 'before' : 'after';
const out = path.resolve(args[0] ?? path.join(appDir, '../.shots/queue-bubble'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-e2e-'));
const PORT = before ? 47468 : 47461; // 47462 는 doc-table 하네스가 쓴다
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite'), ...(before ? { E2E_SRC: before } : {}) }, stdio: 'ignore', detached: true,
});
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (before) return; if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errs.push(m.text()); }); // 404(파비콘)는 하네스 몫
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto(base);
  try { await page.waitForSelector('text=그 캘린더라는게', { timeout: 30_000 }); } catch (e) { await page.screenshot({ path: path.join(out, `${tag}-boot-fail.png`) }); console.log('FAIL 안 뜸 —', errs.join(' / ').slice(0, 1500)); throw e; }
  const box = page.locator('textarea').first();
  const say = async (t) => { await box.click(); await box.fill(t); await box.press('Enter'); await sleep(700); };
  const shot = (name) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  const rows = () => page.$$eval('.chat-row.me .bubble.pending', (els) => els.map((e) => ({ text: e.textContent ?? '', cls: e.className })));

  await say('구글 캘린더 연동말하는거아님');
  await sleep(1500);
  await shot('desk-1-sent'); // 사용자 41.png 와 같은 장면
  await say('자 보낼게 어떻게 가는지 봐봐');
  await say('그러니까 제대로 간다고 액션이');
  await sleep(1500);
  await shot('desk-2-three');
  let r = await rows();
  ok('일하는 중 3번 → 말풍선 3개가 보낸 순서대로', r.map((x) => x.text).join('|') === '구글 캘린더 연동말하는거아님|자 보낼게 어떻게 가는지 봐봐|그러니까 제대로 간다고 액션이', JSON.stringify(r.map((x) => x.text)));
  ok('말풍선 위 보내기·빼기 단추·대기 중 글이 없다', (await page.$$('.chat-pend-acts')).length === 0 && !(await page.textContent('body')).includes('대기 중'));
  ok('셋 다 아직 안 읽음 점', (await page.$$('.chat-row.me .chat-unread')).length === 3);
  ok('작업 중 표시가 줄 선 말 아래(입력칸 위 상태 줄)', await page.evaluate(() => { const b = [...document.querySelectorAll('.chat-row.me')].pop(); const s = document.querySelector('.chat-status'); return !!b && !!s && b.getBoundingClientRect().bottom <= s.getBoundingClientRect().top; }));

  // 빈 입력칸 ↑ = 줄 선 말 꺼내기(Claude 의 ↑) — 대기열이 다 내 말일 때(그림 붙인 말이 섞이면 안 넘긴다, domain/chatQueue queueAllMine)
  await box.click(); await box.fill(''); await box.press('ArrowUp'); await sleep(300);
  ok('빈 입력칸 ↑ 는 터미널에 ↑ 를 넘겨 줄 선 말을 꺼낸다', (await page.evaluate(() => window.__keys.some((k) => k[0] === '\x1b[A'))));
  // 그림 붙인 말 — 대기열 글 앞에 경로가 붙는다. 35초 지나도 '전달 안 됨'이 아니어야
  await say('#img1 #img2 자 봐봐');
  await page.evaluate(() => { window.__skew += 35_000; });
  await sleep(2000);
  await shot('desk-3-image-35s');
  r = await rows();
  const img = r.find((x) => x.text.includes('자 봐봐'));
  ok('그림 붙인 말이 35초 뒤에도 전달 안 됨이 아니다', !!img && !img.cls.includes('mk-failed') && !(await page.textContent('body')).includes('전달 안 됨'), img?.cls);

  // 세션이 첫 말을 받으면 — 흡수 줄 → 기록 줄. 점이 하나 줄고 그 말은 기록 말풍선으로
  await page.evaluate(() => {
    const now = Date.now();
    window.__log.push(JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: new Date(now).toISOString(), sessionId: 's', content: '구글 캘린더 연동말하는거아님', reason: 'absorbed_mid_turn' }));
    window.__log.push(JSON.stringify({ type: 'attachment', uuid: 'qa1', timestamp: new Date(now).toISOString(), attachment: { type: 'queued_command', prompt: '구글 캘린더 연동말하는거아님', origin: { kind: 'human' } } }));
  });
  await sleep(2000);
  await shot('desk-4-read');
  r = await rows();
  ok('읽힌 말은 대기 말풍선에서 빠지고 점도 사라진다', !r.some((x) => x.text.includes('구글 캘린더')) && (await page.$$('.chat-row.me .chat-unread')).length === r.length, JSON.stringify(r.map((x) => x.text)));

  // 죽은 세션 — 끝내 안 들어간 말만 다시 보내기
  await page.evaluate(() => { window.__dead = true; });
  await say('이건 끝내 안 갈 말');
  await page.evaluate(() => { window.__skew += 35_000; });
  await sleep(2000);
  await shot('desk-5-failed');
  const again = await page.$$('.chat-row.me .chat-again');
  ok('끝내 안 간 말 하나에만 다시 보내기 아이콘', again.length === 1 && (await again[0]?.evaluate((e) => e.closest('.chat-row')?.textContent ?? '')).includes('끝내 안 갈 말'));
  if (again[0]) { const n0 = (await page.evaluate(() => window.__sent.length)); await again[0].click(); await sleep(500); ok('다시 보내기를 누르면 다시 간다', (await page.evaluate(() => window.__sent.length)) === n0 + 1); }

  // ⌘Enter = 끊고 보내기(숨은 기능) 그대로
  await page.evaluate(() => { window.__dead = false; });
  await box.click(); await box.fill('끊고 보낼 말'); await box.press('Meta+Enter'); await sleep(1500);
  ok('⌘Enter 는 하던 턴을 끊고 보낸다', (await page.evaluate(() => window.__cut)) >= 1 && (await page.evaluate(() => window.__sent.includes('끊고 보낼 말'))));

  // ── 11-17 '못 갔다' 기준 ──────────────────────────────────────────────
  /** 그 글의 내 말 줄 — 바깥 아이콘·점·흐림 */
  const rowOf = (t) => page.evaluate((t) => {
    const r = [...document.querySelectorAll('.chat-row.me')].filter((e) => (e.textContent ?? '').includes(t)).pop();
    if (!r) return null;
    const b = r.querySelector('.bubble');
    return { again: !!r.querySelector('.chat-again'), unread: !!r.querySelector('.chat-unread'), dim: !!b && Number(getComputedStyle(b).opacity) < 0.9, line: !!r.querySelector('.chat-again.kit-ib-line') };
  }, t);
  const tryClick = async (sel) => { try { await page.click(sel, { timeout: 2000 }); return true; } catch { return false; } };

  // ③ 긴 일 뒤에 줄 선 말 — 11분·71분이 지나도 실패가 아니다(점 그대로, 말풍선도 안 사라진다)
  await page.evaluate(() => { window.__skew += 11 * 60_000; });
  await sleep(1500);
  await shot('fail-1-queued-11m');
  let q = await rowOf('그러니까 제대로 간다고 액션이');
  ok('줄 선 말은 11분 뒤에도 점 — 다시 보내기 아님', !!q && q.unread && !q.again, JSON.stringify(q));
  await page.evaluate(() => { window.__skew += 60 * 60_000; });
  await sleep(1500);
  q = await rowOf('그러니까 제대로 간다고 액션이');
  ok('줄 선 말은 71분 뒤에도 말풍선이 남고 점 그대로', !!q && q.unread && !q.again, JSON.stringify(q));
  const lost = await rowOf('이건 끝내 안 갈 말');
  ok('끝내 안 간 말은 바깥 아이콘(테두리 없음) + 말풍선 흐림', !!lost && lost.again && !lost.line && lost.dim && !lost.unread, JSON.stringify(lost));

  // ① 보낸 뒤 세션이 꺼짐 — 대기열·기록에 없는 말은 30초를 안 기다리고 바로. 누르면 못 보내니 입력칸에 되살린다
  await page.evaluate(() => { window.__dead = true; });
  await say('꺼지기 직전에 보낸 말');
  await page.evaluate(() => { window.__link = 'gone'; window.__rerender?.(); });
  await sleep(1500);
  await shot('fail-2-session-gone');
  const gone = await rowOf('꺼지기 직전에 보낸 말');
  ok('세션이 꺼지면 바로 바깥 다시 보내기', !!gone && gone.again && !gone.unread, JSON.stringify(gone));
  if (!before) {
    const btn = page.locator('.chat-row.me', { hasText: '꺼지기 직전에 보낸 말' }).locator('.chat-again');
    await btn.click(); await sleep(800);
    ok('꺼진 세션에서 누르면 입력칸에 되살리고 말풍선은 빠진다', (await box.inputValue()).includes('꺼지기 직전에 보낸 말') && !(await rowOf('꺼지기 직전에 보낸 말')));
    await box.fill('');
  }
  await page.evaluate(() => { window.__link = 'live'; window.__dead = false; window.__rerender?.(); });

  // ② 살아 있는데 Enter·다시 치기 뒤에도 입력칸에 그대로(Rust stuck) — 바로, 시간 안 당겨도
  await page.evaluate(() => { window.__outcome = 'stuck'; });
  await say('입력칸에 걸린 말');
  await sleep(1800);
  await shot('fail-3-stuck');
  const stuck = await rowOf('입력칸에 걸린 말');
  ok('다시 쳐도 입력칸에 걸린 말은 30초를 안 기다리고 바깥 다시 보내기', !!stuck && stuck.again, JSON.stringify(stuck));
  await page.evaluate(() => { window.__outcome = ''; });
  ok('빼기는 화면 단추가 없다', (await page.$$('.chat-row.me button[aria-label="빼기"], .chat-row.me button[aria-label="Remove"]')).length === 0);
  if (!before) {
    await page.locator('.chat-row.me', { hasText: '입력칸에 걸린 말' }).locator('.bubble').click({ button: 'right' });
    await sleep(400);
    await shot('fail-4-menu');
    const items = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent?.trim()));
    ok('오른쪽 클릭 메뉴에 다시 보내기·빼기', items.includes('다시 보내기') && items.includes('빼기'), JSON.stringify(items));
    await tryClick('[role="menuitem"]:has-text("빼기")'); await sleep(500);
    ok('메뉴로 빼면 말풍선이 빠진다', !(await rowOf('입력칸에 걸린 말')));
  }

  // ④ Claude 오류로 그 말 턴이 끝남(답 없음) — 기록 말풍선 바깥에 다시 보내기, 누르면 같은 말이 다시 간다
  await page.evaluate(() => {
    const now = Date.now();
    window.__log.push(JSON.stringify({ type: 'user', uuid: 'eu1', timestamp: new Date(now).toISOString(), origin: { kind: 'human' }, message: { role: 'user', content: '다음 단계 해줘' } }));
    window.__log.push(JSON.stringify({ type: 'assistant', uuid: 'ee1', timestamp: new Date(now + 9000).toISOString(), isApiErrorMessage: true, message: { role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }] } }));
  });
  await sleep(2000);
  await shot('fail-5-api-error');
  const er = await rowOf('다음 단계 해줘');
  ok('오류로 답 못 받은 기록 말풍선에 바깥 다시 보내기 + 흐림', !!er && er.again && er.dim, JSON.stringify(er));
  const prior = await rowOf('구글 캘린더 연동말하는거아님');
  ok('그 앞 말(앞 턴에 흡수된 말)엔 안 붙는다', !!prior && !prior.again && !prior.dim, JSON.stringify(prior));
  if (!before) {
    const n0 = await page.evaluate(() => window.__sent.length);
    await page.locator('.chat-row.me', { hasText: '다음 단계 해줘' }).first().locator('.chat-again').click();
    await sleep(800);
    ok('누르면 같은 말이 다시 간다(한 번)', (await page.evaluate(() => window.__sent.slice(-1)[0])) === '다음 단계 해줘' && (await page.evaluate(() => window.__sent.length)) === n0 + 1);
    ok('다시 보낸 뒤엔 기록 말풍선의 아이콘이 빠진다', (await page.$$eval('.chat-row.me', (els) => els.filter((e) => (e.textContent ?? '').includes('다음 단계 해줘') && e.querySelector('.chat-again')).length)) === 0);
  }
  // 로그인 풀림은 다시 보내기 대신 로그인 카드 흐름 — 아이콘 없음
  await page.evaluate(() => {
    const now = Date.now();
    window.__log.push(JSON.stringify({ type: 'user', uuid: 'eu2', timestamp: new Date(now).toISOString(), origin: { kind: 'human' }, message: { role: 'user', content: '로그인 풀린 뒤 보낸 말' } }));
    window.__log.push(JSON.stringify({ type: 'assistant', uuid: 'ee2', timestamp: new Date(now + 1000).toISOString(), isApiErrorMessage: true, error: 'authentication_failed', message: { role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'Login expired · Please run /login' }] } }));
  });
  await sleep(2000);
  const lg = await rowOf('로그인 풀린 뒤 보낸 말');
  ok('로그인 풀림으로 끝난 말엔 다시 보내기가 없다', !!lg && !lg.again, JSON.stringify(lg));

  // 폰 — 보낼 함(보내는 중·맥이 받음)도 보통 말풍선, 일하는 중 줄은 그 아래
  const ph = await context.newPage();
  ph.on('pageerror', (e) => errs.push(String(e)));
  await ph.setViewportSize({ width: 390, height: 700 });
  await ph.goto(`${base}?phone=1`);
  await ph.waitForSelector('text=그 캘린더라는게', { timeout: 30_000 });
  await sleep(800);
  await ph.screenshot({ path: path.join(out, `${tag}-phone.png`) });
  ok('폰 보낼 함은 흐리지 않고 작은 점', (await ph.$$('.m-pending')).length === 0 && (await ph.$$('.m-unread')).length === 3);
  ok('폰 일하는 중 줄이 보낼 함 아래', await ph.evaluate(() => { const b = [...document.querySelectorAll('.m-out-wait')].pop(); const l = document.querySelector('.m-live'); return !!b && !!l && b.getBoundingClientRect().bottom <= l.getBoundingClientRect().top; }));
  // 폰 못 보낸 말 — 점 자리에 다시 보내기 아이콘, 이유 글·지우기 단추 없음, 빼기는 길게 누르기. Claude 오류로 답 못 받은 말에도 같은 아이콘
  const pf = await context.newPage();
  pf.on('pageerror', (e) => errs.push(String(e)));
  await pf.setViewportSize({ width: 390, height: 700 });
  await pf.goto(`${base}?phone=fail`);
  await pf.waitForSelector('text=끝내 안 간 말', { timeout: 30_000 });
  await sleep(800);
  await pf.screenshot({ path: path.join(out, `${tag}-fail-6-phone.png`) });
  ok('폰: 못 보낸 말·답 못 받은 말에 바깥 다시 보내기 아이콘 둘', (await pf.$$('.m-out-wait .m-again')).length === 2);
  ok('폰: 이유 글·지우기 단추가 화면에 없다', (await pf.$$('button[aria-label="이 말 지우기"]')).length === 0 && !(await pf.textContent('body')).includes('전해지지 않았어요'));
  ok('폰: 말풍선은 살짝 흐림', (await pf.$$('.m-me.m-dim')).length === 2);
  if (!before) {
    const b = await pf.locator('.m-out-wait', { hasText: '끝내 안 간 말' }).locator('.m-bubble').boundingBox();
    if (b) { await pf.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pf.mouse.down(); await sleep(650); await pf.mouse.up(); }
    await sleep(600);
    await pf.screenshot({ path: path.join(out, `${tag}-fail-7-phone-hold.png`) });
    await pf.locator('.m-menu-item', { hasText: '빼기' }).click({ timeout: 3000 }).catch(() => {});
    await sleep(500);
    ok('폰: 길게 눌러 빼기', (await pf.$$('text=끝내 안 간 말')).length === 0);
    await pf.locator('.m-out-wait', { hasText: '이 사진 배경 좀 밝게' }).locator('.m-again').click();
    await sleep(500);
    ok('폰: 답 못 받은 말 다시 보내기 → 같은 말이 가고 아이콘은 빠진다', (await pf.evaluate(() => window.__sent.includes('이 사진 배경 좀 밝게'))) && (await pf.$$('.m-again')).length === 0);
  }
  ok('화면 오류 없음', errs.length === 0, errs.join(' / '));
} finally {
  await release();
  stopVite();
}
console.log(before ? `캡처만 — ${out}/before-*.png` : failed ? `FAIL ${failed}개` : `다 통과 — 캡처 ${out}/after-*.png`);
process.exit(failed ? 1 : 0);
