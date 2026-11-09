#!/usr/bin/env node
// 시안 칸 링크 해피패스 E2E(2026-11-05 사용자 links-dead.png) — 스페이스 html 칸 안 웹 링크(target=_blank·없음·_top·_self·스크립트 이동)는
// 참모 브라우저 새 탭으로(agent_open_tab) 가고 칸은 그 문서 그대로, #앵커는 칸 안에서, javascript:·file:·폼은 아무 데도 안 감,
// 다리를 피해 샌 칸은 원래 문서로 되돌아온다(칸 지킴이). 시안 검토 껍데기(design-curation build.py)의 설명 줄 링크도 가려지지 않고 눌린다.
// node app/e2e/frame-links/run.mjs [캡처 폴더] — 참모 브라우저(시험 프로필 frame-links-e2e, 헤드리스)로 돈다. 실패하면 종료 1
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/frame-links/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47441;
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-links-e2e-'));

// 진짜 시안 검토 껍데기 — 덱 설명 줄(.sub)과 블록(.m) 안에 링크
const body = path.join(cache, 'body.html');
fs.writeFileSync(body, '<section class="deck" data-deck="01 링크"><h2>01 · 링크</h2><p class="sub">물류 회사 · <a id="sublink" href="https://shipping.example.com/" target="_blank" rel="noopener">https://shipping.example.com/</a> · 장면 설명</p>'
  + '<div class="m" data-k="01-a"><p>블록 안 <a id="mlink" href="https://example.org/m" target="_blank">링크</a></p></div></section>');
const cur = path.join(cache, 'cur.html');
execFileSync('python3', [path.join(os.homedir(), '.claude/skills/design-curation/scripts/build.py'), body, '-o', cur, '--title', '링크 e2e'], { stdio: 'ignore' });

const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: path.join(cache, 'vite'), E2E_CUR: cur }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('frame-links-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 900, height: 700 });
  const opened = () => p.evaluate(() => window.__calls.filter((c) => c.cmd === 'agent_open_tab').map((c) => c.args.url));
  const calls = () => p.evaluate(() => window.__calls.map((c) => c.cmd));
  const doc = async () => { for (let i = 0; i < 40; i++) { const f = p.frames().find((x) => x !== p.mainFrame()); if (f && f.url().includes('doc.html')) { try { await f.waitForSelector('#marker', { timeout: 2000 }); return f; } catch { /* 아직 */ } } await sleep(100); } return null; };

  await p.goto(base);
  let f = await doc();
  ok('칸에 시안이 뜬다', !!f);
  await sleep(300);

  // 웹 링크 넷 — 참모 브라우저(맡긴 세션 없음 → 참모 브라우저 띄우기) 새 탭, 칸은 그대로
  for (const id of ['blank', 'plain', 'top', 'self']) { await (await doc()).click(`#${id}`); await sleep(250); }
  let o = await opened();
  ok('target=_blank·없음·_top·_self 가 참모 브라우저 새 탭으로 — 주소 그대로', JSON.stringify(o) === JSON.stringify(['https://www.awwwards.com/sites/zeroz?ref=1', 'https://example.org/plain', 'https://example.org/top', 'https://example.org/self']), JSON.stringify(o));
  ok('브라우저가 없으면 참모 브라우저를 띄우고 그 칸으로', (await calls()).includes('hq_browser_open') && (await p.evaluate(() => window.__shown)).every((s) => s === 'hq-e2e'), JSON.stringify(await p.evaluate(() => window.__shown)));
  f = await doc();
  ok('칸은 그 문서 그대로', !!f && !!(await f.$('#marker')));
  await p.screenshot({ path: path.join(out, 'doc.png') });

  // #앵커는 칸 안에서, javascript:·file: 은 아무 데도
  const before = (await opened()).length;
  await f.click('#anchor');
  await sleep(300);
  ok('#앵커는 칸 안에서 움직인다', (await doc())?.url().endsWith('#far') && (await f.evaluate(() => scrollY)) > 500);
  await f.evaluate(() => scrollTo(0, 0));
  await f.click('#js');
  await f.click('#file');
  await sleep(300);
  ok('javascript:·file: 은 안 연다', (await opened()).length === before);

  // 폼 보내기·스크립트 location — 칸이 안 넘어간다, 사람이 누른 스크립트 이동은 앱으로
  await f.click('#sub');
  await sleep(400);
  f = await doc();
  ok('폼 보내기 — 칸 그대로', !!f && !!(await f.$('#marker')) && (await opened()).length === before);
  // 크롬에선 칸 스크립트의 바깥 이동을 칸 안에서 못 막는다(불투명 출처) — 맥 앱은 웹뷰(frame_nav)가 막고 window.__frameNav(주소)를 부른다.
  // 여기선 그 줄을 흉내 낸다: 사람이 누른 칸(포커스)이면 참모 브라우저로, 포커스가 칸 밖이면 막기만
  await f.click('#marker');
  await p.evaluate(() => window.__frameNav('https://example.org/loc'));
  await sleep(300);
  o = await opened();
  ok('웹뷰가 막은 칸 이동 — 누른 칸이면 참모 브라우저로', o[o.length - 1] === 'https://example.org/loc', JSON.stringify(o.slice(before)));
  await p.evaluate(() => { document.activeElement?.blur?.(); window.__frameNav('https://example.org/auto'); });
  await sleep(300);
  ok('웹뷰가 막은 칸 이동 — 누른 칸이 없으면(저절로) 안 연다', !(await opened()).includes('https://example.org/auto'));

  // 다리를 피해 새는 링크(페이지가 클릭 전파를 끊음 + 같은 서버 남의 페이지) — 칸 지킴이가 원래 문서로
  await f.click('#leak');
  let back = null;
  for (let i = 0; i < 40 && !back; i++) { await sleep(150); const g = p.frames().find((x) => x !== p.mainFrame()); if (g && g.url().includes('doc.html') && (await g.$('#marker').catch(() => null))) back = g; }
  ok('샌 칸이 원래 문서로 되돌아온다', !!back);

  // 시안 검토 껍데기 — 설명 줄·블록 안 링크가 가려지지 않고 눌린다
  await p.goto(`${base}?doc=curation.html`);
  let c = null;
  for (let i = 0; i < 40 && !c; i++) { await sleep(150); const g = p.frames().find((x) => x !== p.mainFrame() && x.url().includes('curation.html')); if (g && (await g.$('#sublink').catch(() => null))) c = g; }
  ok('검토 시안이 뜬다', !!c);
  await sleep(500);
  const top = await c.evaluate(() => ['sublink', 'mlink'].map((id) => { const a = document.getElementById(id); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && el.closest('a') === a; }));
  ok('설명 줄·블록 링크 위에 아무것도 안 덮였다(elementFromPoint)', top.every(Boolean), JSON.stringify(top));
  const n0 = (await p.evaluate(() => window.__calls.filter((x) => x.cmd === 'agent_open_tab').length));
  await c.click('#sublink');
  await sleep(300);
  await c.click('#mlink');
  await sleep(300);
  const co = (await p.evaluate(() => window.__calls.filter((x) => x.cmd === 'agent_open_tab').map((x) => x.args.url))).slice(n0);
  ok('검토 시안 링크도 참모 브라우저로', JSON.stringify(co) === JSON.stringify(['https://shipping.example.com/', 'https://example.org/m']), JSON.stringify(co));
  ok('블록 링크를 눌러도 고르기 창이 안 뜬다', !(await c.$('.cur-pick.open, .cur-pick[open]')));
  await p.screenshot({ path: path.join(out, 'curation.png') });
  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
  await p.close();
} catch (e) {
  failed++;
  console.log('FAIL 멈춤', e);
} finally {
  await release();
  vite.kill();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '전부 통과');
process.exit(failed ? 1 : 0);
