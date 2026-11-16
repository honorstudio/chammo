// 터미널 한글 E2E 받침 — 진짜 xterm 6 + 앱과 같은 keypress 막이(domain/imeKeypress)를 크로미움에 띄운다
import path from 'node:path';
import { defineConfig } from 'vite';

const here = __dirname;
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..')] } },
});
