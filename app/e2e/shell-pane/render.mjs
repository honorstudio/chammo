#!/usr/bin/env node
// 시험 앱에서 뜬 DOM(snap-*.txt: html·css·창 크기·다크) → 헤드리스 크롬 그림. 시험 앱 창은 화면 밖이라 screencapture 가 안 된다
// node render.mjs <덤프 폴더> <캡처 폴더> <before|after> <dist 주소>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const [dump, out, tag, base] = process.argv.slice(2);
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('shell-pane-e2e', { headless: true });
try {
  for (const f of fs.readdirSync(dump).filter((x) => x.startsWith('snap-')).sort()) {
    const s = JSON.parse(fs.readFileSync(path.join(dump, f), 'utf8'));
    const html = s.html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}"><style>${s.css.replace(/<\/style/gi, '<\\/style')}</style>`);
    const p = await context.newPage();
    await p.emulateMedia({ colorScheme: s.dark ? 'dark' : 'light' });
    await p.setViewportSize({ width: s.w, height: s.h });
    await p.setContent(`<!doctype html>${html}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const name = `${tag}-${f.replace(/^snap-|\.txt$/g, '')}.png`;
    await p.screenshot({ path: path.join(out, name) });
    // 탭 줄만 크게 한 장 더(전후 비교)
    const tabs = await p.$('.lk-tabs');
    if (tabs) await tabs.screenshot({ path: path.join(out, name.replace('.png', '-tabs.png')) });
    await p.close();
    console.log(`그림 ${name}`);
  }
} finally {
  await release?.();
}
