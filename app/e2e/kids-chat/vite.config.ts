// 키즈 보호자 채팅 E2E 받침(11-17) — 진짜 ChatView 에 아이 화면 대화(useKidsChat)를 끼운다.
// E2E_SRC=<옛 app/src> 면 그 소스로(고치기 전 main 판 — 전후 비교, run.mjs 가 git archive 로 만든다)
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const src = process.env.E2E_SRC ?? path.resolve(here, '../../src');
const send = (res: import('node:http').ServerResponse, body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
function fake(): Plugin {
  return {
    name: 'kids-chat-fake',
    configureServer(s) {
      // 앱 명령은 다 빈 답 — 프로필 창 명령은 main.tsx 의 가짜 invoke 가 받는다
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
