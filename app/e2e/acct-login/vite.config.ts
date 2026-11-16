// 계정 메뉴 로그인 필요 줄 E2E 받침 — 진짜 화면 컴포넌트만, Rust 는 가짜 invoke(index.html)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-acct-login'),
  plugins: [
    react(),
    // 폰 계정 시트(ui/mobile/AccountSheet)가 부르는 data/web 만 가짜로 — 맥 터널·열쇠 없이. 다른 모듈의 data/web 은 그대로
    { name: 'fake-phone-web', enforce: 'pre', resolveId: (src, importer) => (src === '../../data/web' && importer?.endsWith('ui/mobile/AccountSheet.tsx') ? path.join(__dirname, 'fakeWeb.ts') : null) },
  ],
  server: { port: Number(process.env.E2E_PORT ?? 47439), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
