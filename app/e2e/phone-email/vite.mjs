// 폰 입구(/pair → phone.html, /config.json)를 vite 로 — 빌드 없이. ROOT=<app> PORT=<포트> RELAY=<중계 주소> CACHE=<캐시>
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.env.ROOT;
const req = createRequire(resolve(root, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const pair = { name: 'pair', configureServer(s) { s.middlewares.use((q, r, next) => {
  if (q.url === '/config.json') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ relay: process.env.RELAY })); return; }
  const p = q.url.split('?')[0];
  if (p === '/pair' || p === '/') q.url = '/phone.html';
  next();
}); } };
const s = await createServer({ configFile: false, root, publicDir: 'public-phone', plugins: [pair], cacheDir: process.env.CACHE,
  server: { port: Number(process.env.PORT), strictPort: true, host: '127.0.0.1', fs: { strict: false } }, clearScreen: false });
await s.listen();
console.log('vite', process.env.PORT);
