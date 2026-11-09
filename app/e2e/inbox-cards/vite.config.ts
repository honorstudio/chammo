// 결정 대기함 해피패스 E2E 받침 — 진짜 화면 컴포넌트만, Rust 는 가짜 invoke(index.html)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-inbox'),
  plugins: [react()],
  server: { port: Number(process.env.E2E_PORT ?? 47433), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
