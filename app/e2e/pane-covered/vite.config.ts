// 덮인 칸 E2E 받침 — 진짜 usePanePlace·InboxPopover, 비추기(Rust·Swift)는 가짜 api
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-pane-covered'),
  plugins: [react()],
  server: { port: Number(process.env.E2E_PORT ?? 47441), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
