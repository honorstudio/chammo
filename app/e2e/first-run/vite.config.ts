// 첫 설치 E2E 받침 — 진짜 화면(ui/FirstRun)에 가짜 앱 명령을 붙인다. 진짜 Rust·받기는 cargo 시험(base_tools)·시험 앱 실측이 잰다
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
