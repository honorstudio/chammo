// 문서 표 고르기·복사 E2E 받침 — 진짜 DocPage(BlockNote), Rust 는 가짜 invoke(main.tsx). run.mjs 가 시스템 WKWebView(wk.swift)로 띄운다
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-doc-table'),
  plugins: [react()],
  resolve: { alias: { '@pro': path.resolve(__dirname, '../../src/pro-stub') } },
  server: { port: Number(process.env.E2E_PORT ?? 47452), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
