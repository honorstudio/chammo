// 참모 브라우저 메모리 상한 줄(BrowserMemCap) 받침 — 진짜 컴포넌트 + 가짜 browser_memcap_get/set
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const here = __dirname;
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react()],
  resolve: { alias: { '@pro': path.resolve(here, '../../../pro/web') } },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../../..')] } },
});
