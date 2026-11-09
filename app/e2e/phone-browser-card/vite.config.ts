// 폰 사람 부르기 카드 E2E 받침 — 진짜 ChatSheet·MessageList·PhoneAskCards, /api 만 가짜(main.tsx)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-phone-browser-card'),
  plugins: [react()],
  server: { port: Number(process.env.E2E_PORT ?? 47436), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
