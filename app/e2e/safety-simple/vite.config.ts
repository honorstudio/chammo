// 보안 번호 단순화 E2E 받침(11-09) — 진짜 TeamSettings·TeamConvo 에 가짜 맥(team_feed 의 safety 사람 넷)을 붙인다.
// 누른 명령은 /__state 로 — 같아요·막아 두기가 같은 명령(e2e_safety_verify·direct_answer)으로 가는지 본다
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const DAY = 24 * 3600_000;
const now = Date.now();
const num = (n: number) => Array.from({ length: 6 }, (_, i) => String((n * 7919 + i * 10007) % 100000).padStart(5, '0')).join(' ');
const person = (member: string, name: string, x: Record<string, unknown> = {}) => ({ account: `a-${member}`, team: 't-momo', member, name, state: 'ok', verifiedAt: 0, blocked: false, number: num(member.length * 31 + name.length), card: '', identity: 'I', head: 'H', refetched: false, rekeyedAt: 0, ...x });
// 지수(안 견줌) · 민지(견줘 확인함) · 팀원(이틀 전 기기 바뀜 — 저절로 받아들임) · 도윤(막아 둠)
export const SAFETY = [
  person('m-js', '지수'),
  person('m-mj', '민지', { state: 'verified', verifiedAt: now - 5 * DAY }),
  person('m-sh', '팀원', { rekeyedAt: now - 2 * DAY }),
  person('m-dy', '도윤', { state: 'changed', blocked: true, rekeyedAt: now - 3 * DAY }),
];
const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req: import('node:http').IncomingMessage) => new Promise<string>((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });

function fake(): Plugin {
  return {
    name: 'safety-fake',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://x');
        if (u.pathname === '/__state') return send(res, 200, { calls });
        if (u.pathname === '/__reset') { calls.length = 0; return send(res, 200, {}); }
        if (u.pathname !== '/__invoke') return next();
        const { cmd, args } = JSON.parse(await readBody(req)) as { cmd: string; args: Record<string, unknown> };
        calls.push({ cmd, args });
        if (cmd === 'team_locker_poll') return send(res, 200, { v: { uploads: [], changed: false } });
        if (cmd === 'team_feed') return send(res, 200, { v: { view: null, items: [], safety: SAFETY, held: [], reads: {} } });
        if (cmd === 'team_ui_invites' || cmd === 'team_locker_uploads' || cmd === 'team_upload_progress' || cmd === 'team_down_list') return send(res, 200, { v: [] });
        if (cmd === 'team_agents' || cmd === 'team_agents_cached') return send(res, 200, { v: { agents: [], seen: {} } });
        return send(res, 200, { v: null });
      });
    },
  };
}

export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react(), fake()],
  resolve: {
    alias: [{ find: '@pro', replacement: path.resolve(here, '../../src/pro-stub') }],
    dedupe: ['react', 'react-dom', '@tauri-apps/api'],
  },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..'), '/'] } },
});
