// 영상 검토 해피패스 E2E 받침 — 진짜 화면 컴포넌트에 가짜 폰 서버(mobile_http 와 같은 Range·표 규칙)를 붙인다. 진짜 Rust·중계는 재지 않는다
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const video = process.env.E2E_VIDEO!;
const low = process.env.E2E_LOW!;
const spriteFile = process.env.E2E_SPRITE!;
const spriteMeta = JSON.parse(process.env.E2E_SPRITE_META ?? '{}');
const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; script-src 'self' 'unsafe-inline'";

const log: { url: string; range?: string; bytes?: number }[] = [];
let saved = '';
let savedMd = '';
const sends: string[] = [];

function ranged(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, file: string, cap: number) {
  const total = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? 'bytes=0-');
  const s = Number(m?.[1] || 0);
  const e = Math.min(m?.[2] ? Number(m[2]) : total - 1, s + cap - 1, total - 1);
  if (s >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); res.end(); return; }
  const buf = Buffer.alloc(e - s + 1);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, buf, 0, buf.length, s);
  fs.closeSync(fd);
  log.push({ url: req.url ?? '', range: req.headers.range, bytes: buf.length });
  res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e}/${total}`, 'Accept-Ranges': 'bytes', 'Content-Length': buf.length });
  res.end(buf);
}

const fakeServer: Plugin = {
  name: 'fake-phone-server',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const u = new URL(req.url ?? '/', 'http://x');
      let body = '';
      if (req.method === 'POST') for await (const c of req) body += c;
      const json = (o: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      res.setHeader('Content-Security-Policy', CSP);
      if (u.pathname === '/__state') return json({ log, saved, savedMd, sends });
      if (u.pathname === '/__reset') { saved = ''; savedMd = ''; sends.length = 0; log.length = 0; return json({ ok: true }); }
      if (u.pathname === '/__video') return ranged(req, res, video, 1024 * 1024);
      if (u.pathname === '/api/media-ticket') {
        return json({ url: '/api/media?t=tk', ticket: 'tk', size: fs.statSync(video).size, prep: { state: 'ready', pct: 1, low: fs.statSync(low).size, needsLow: true, fps: 30, duration: spriteMeta.duration, sprite: spriteMeta.sprite, record: '/d/curation/x.state.json' } });
      }
      if (u.pathname === '/api/media') return ranged(req, res, u.searchParams.get('low') === '1' ? low : video, u.searchParams.get('low') === '1' ? 256 * 1024 : 1024 * 1024);
      if (u.pathname === '/api/media-sprite') { log.push({ url: req.url ?? '' }); res.setHeader('content-type', 'image/jpeg'); return res.end(fs.readFileSync(spriteFile)); }
      if (u.pathname === '/api/curation') { const b = JSON.parse(body) as { text: string; store: unknown }; savedMd = b.text; saved = JSON.stringify(b.store); return json({ ok: true }); }
      if (u.pathname === '/__desktop-save') { const b = JSON.parse(body) as { md?: string; json?: string }; if (b.md !== undefined) savedMd = b.md; if (b.json !== undefined) saved = b.json; return json({ ok: true }); }
      if (u.pathname === '/api/curation-state' || u.pathname === '/__desktop-load') { res.end(saved); return; }
      if (u.pathname === '/api/send') { const b = JSON.parse(body) as { text: string }; sends.push(b.text); res.statusCode = 202; return json({ ok: true }); }
      if (u.pathname === '/api/send-status') return json({ state: 'sent' });
      next();
    });
  },
};

// 데스크톱 영상 주소만 받침으로 — 나머지 domain/reader 는 진짜
const reader: Plugin = {
  name: 'doc-url',
  enforce: 'pre',
  async resolveId(id, importer) {
    if (id.endsWith('domain/reader') && !importer?.endsWith('readerShim.ts')) return path.join(here, 'readerShim.ts');
    return null;
  },
};

export default defineConfig({
  root: here,
  plugins: [reader, fakeServer, react()],
  server: { port: Number(process.env.E2E_PORT ?? 47431), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..')] } },
});
