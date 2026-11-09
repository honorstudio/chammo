// 팀 보관함 → 팀챗 E2E 받침(11-09) — 진짜 TeamLocker·TeamConvo·PhoneTeamLocker 에 가짜 맥(팀 보관함 목록·사람 말 기록)을 붙인다.
// E2E_OLD_CHATDROP=<파일> 이면 chatDrop.ts 를 그 파일(고치기 전 main 판)로 바꿔 끼운다 — 전후 비교. 진짜 Rust 거름(fits)은 cargo 시험이 잰다
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const item = (id: string, name: string, x: Record<string, unknown> = {}) => ({ id, name, size: 1200, cipher: 1300, at: 1762650000000, state: 'live', kind: 'file', room: '', folder: '', by: '사용자', byMember: 'm-me', mine: true, why: '', deletedAt: null, ...x });
const view = () => ({
  rev: 3, usage: { used: 3600, limit: 30e9, seats: 3 }, skipped: [], shared: 0,
  items: [item('f-quote', '견적서.pdf'), item('f-plan', '회의 자료.pptx'), item('f-lock', '잠긴 것.pdf', { why: '이 기기 몫 열쇠를 기다려요' }), item('f-photo', '현장 사진.png')],
});
const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req: import('node:http').IncomingMessage) => new Promise<string>((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });

function fake(): Plugin {
  return {
    name: 'team-chat-fake',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://x');
        if (u.pathname === '/__state') return send(res, 200, { calls });
        if (u.pathname === '/__reset') { calls.length = 0; return send(res, 200, {}); }
        if (u.pathname !== '/__invoke') return next();
        const { cmd, args } = JSON.parse(await readBody(req)) as { cmd: string; args: Record<string, unknown> };
        if (!/poll|cached|down_list|thumb|peek/.test(cmd)) calls.push({ cmd, args });
        if (cmd === 'team_locker_list' || cmd === 'team_locker_cached') return send(res, 200, { v: view() });
        if (cmd === 'team_locker_poll') return send(res, 200, { v: { uploads: [], changed: false } });
        if (cmd === 'team_down_list') return send(res, 200, { v: [] });
        if (cmd === 'team_human_say') return send(res, 200, { v: { room: (args.room as string) || 'r-dm-new', seq: 41 } });
        if (cmd === 'team_locker_give') return send(res, 200, { v: '/tmp/x' });
        return send(res, 200, { v: null });
      });
    },
  };
}

const old = process.env.E2E_OLD_CHATDROP;
export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react(), fake()],
  resolve: {
    alias: [
      { find: '@pro', replacement: path.resolve(here, '../../src/pro-stub') },
      ...(old ? [{ find: /^\.\/chatDrop$/, replacement: old }] : []),
    ],
    dedupe: ['react', 'react-dom', '@tauri-apps/api'],
  },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..'), '/'] } },
});
