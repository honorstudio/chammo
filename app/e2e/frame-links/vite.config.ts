// 시안 칸 링크 E2E 받침 — 진짜 화면 컴포넌트, Rust 는 가짜 invoke(index.html). 시안 문서는 hodoc 처럼 끝에 링크 다리(reader.rs LINK_BRIDGE)를 붙여 낸다
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const reader = fs.readFileSync(path.resolve(__dirname, '../../src-tauri/src/reader.rs'), 'utf8');
const BRIDGE = /pub const LINK_BRIDGE: &str = "([\s\S]*?)";\n/.exec(reader)![1]!;
const docs: Record<string, () => string | null> = {
  '/doc.html': () => fs.readFileSync(path.join(__dirname, 'doc.fixture.html'), 'utf8'),
  '/curation.html': () => (process.env.E2E_CUR ? fs.readFileSync(process.env.E2E_CUR, 'utf8') : null),
};

export default defineConfig({
  root: __dirname,
  cacheDir: process.env.E2E_CACHE ?? path.join(__dirname, '../../node_modules/.vite-e2e-frame-links'),
  plugins: [react(), {
    name: 'frame-docs',
    configureServer(s) {
      s.middlewares.use((req, res, next) => {
        const u = (req.url ?? '').split('?')[0]!;
        // 다리가 없는 남의 페이지 — 칸이 여기로 새면 지킴이가 원래 문서로 되돌려야 한다
        if (u === '/foreign.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>foreign</title><p id="foreign">남의 페이지</p>'); return; }
        const body = docs[u]?.();
        if (body == null) { next(); return; }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(body + BRIDGE);
      });
    },
  }],
  server: { port: Number(process.env.E2E_PORT ?? 47441), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
});
