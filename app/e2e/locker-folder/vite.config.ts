// 보관함 폴더 끌어 놓기 전후 캡처 받침 — 진짜 LockerPage·앱 띠 모양에 가짜 나무. 진짜 넣기(링크·표식·짧은 줄)는 cargo 시험이 잰다
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const here = __dirname;
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react()],
  resolve: { alias: { '@pro': path.resolve(here, '../../src/pro-stub') }, dedupe: ['react', 'react-dom', '@tauri-apps/api'] },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..')] } },
});
