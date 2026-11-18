// 폰 일하는 중 줄 E2E 받침(11-17 stream-task-count) — 진짜 ChatView·폰 MessageList 에 가짜 기록(jsonl 줄)을 붙인다.
// E2E_SRC=<옛 app/src> 면 그 소스로(고치기 전 main 판 — 전후 비교, run.mjs 가 git archive 로 만든다)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const src = process.env.E2E_SRC ?? path.resolve(here, '../../src');
const send = (res: import('node:http').ServerResponse, body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
function fake(): Plugin {
  return {
    name: 'stream-task-count-fake',
    configureServer(s) {
      // 앱 명령은 다 빈 답 — ChatView 는 기록을 readFn(가짜)으로만 읽는다
      s.middlewares.use((req, res, next) => (req.url?.startsWith('/__invoke') ? send(res, { v: null }) : next()));
    },
  };
}
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react(), fake()],
  resolve: {
    alias: [
      { find: /^@src\//, replacement: `${src}/` },
      { find: '@pro', replacement: path.join(src, 'pro-stub') },
    ],
    dedupe: ['react', 'react-dom', '@tauri-apps/api'],
  },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: ['/'] } },
});
