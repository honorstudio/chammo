import path from 'node:path';
import { defineConfig } from 'vite';

// 사무실 E2E — 진짜 컴포넌트에 지어낸 뽑기 파일을 넣어 띄운다(Tauri 없음). 캐시는 CACHE_DIR 로 따로
const app = path.resolve(__dirname, '../..');
export default defineConfig({
  root: app,
  cacheDir: process.env.CACHE_DIR,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 47437), strictPort: true, fs: { strict: false } },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@pro': path.join(app, 'src/pro-stub') } },
});
