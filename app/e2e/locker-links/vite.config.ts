// 보관함 링크 칸 해피패스 E2E 받침 — 진짜 LockerPage·PhoneLocker 에 가짜 맥(링크 저장소)을 붙인다. 진짜 Rust(대화 기록 이어 읽기·저장)는 cargo 시험이 잰다
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
type Link = { id: string; url: string; ts: string; by: string; how: string; label?: string };
const links: Link[] = [
  { id: 'u1#0', url: 'https://github.com/o/r/pull/418', ts: '2026-11-06T05:06:00.000Z', by: 'o2', how: 'answer', label: 'PR #418' },
  { id: 'u2#0', url: 'https://shop-landing.vercel.app/en', ts: '2026-11-06T04:40:00.000Z', by: 'me', how: 'said' },
];
const hidden = new Set<string>();
const calls: string[] = [];
let n = 0;
const view = () => ({ links: links.filter((l) => !hidden.has(l.id)).sort((a, b) => (a.ts < b.ts ? 1 : -1)), hidden: [...hidden] });
const add = (url: string) => {
  if (!/^https?:\/\/[^\s/]+\.[^\s]+$/.test(url)) throw new Error('주소꼴이 아니야');
  const l = { id: `me-${++n}`, url, ts: new Date().toISOString(), by: 'me', how: 'hand' };
  links.push(l);
  return l;
};
const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req: import('node:http').IncomingMessage) => new Promise<string>((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });

/** 앱 명령(locker_links·locker_link_add·locker_link_hide) + 폰 길(/api/locker-links…) 흉내 — 모양은 locker_links.rs·mobile_http 와 같다 */
function fake(): Plugin {
  return {
    name: 'links-fake',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://x');
        if (u.pathname === '/__state') return send(res, 200, { ...view(), calls });
        try {
          if (u.pathname === '/__invoke') {
            const { cmd, args } = JSON.parse(await readBody(req)) as { cmd: string; args: Record<string, unknown> };
            calls.push(cmd);
            if (cmd === 'locker_links') return send(res, 200, { v: view() });
            if (cmd === 'locker_link_add') return send(res, 200, { v: add(String(args.url)) });
            if (cmd === 'locker_link_hide') { if (args.hide) hidden.add(String(args.link)); else hidden.delete(String(args.link)); return send(res, 200, { v: null }); }
            return send(res, 200, { v: null });
          }
          if (u.pathname === '/api/locker-links') { calls.push(`phone-links ${u.searchParams.get('owner')}`); return send(res, 200, view()); }
          if (u.pathname === '/api/locker-link-add') { const b = JSON.parse(await readBody(req)) as { url: string }; calls.push('phone-add'); return send(res, 200, add(b.url)); }
          if (u.pathname === '/api/locker-link-hide') { const b = JSON.parse(await readBody(req)) as { id: string; hide: boolean }; calls.push(`phone-hide ${b.hide}`); if (b.hide) hidden.add(b.id); else hidden.delete(b.id); return send(res, 200, { ok: true }); }
        } catch (e) {
          return send(res, 400, { e: String(e) });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: here,
  cacheDir: process.env.E2E_CACHE,
  plugins: [react(), fake()],
  resolve: { alias: { '@pro': path.resolve(here, '../../src/pro-stub') }, dedupe: ['react', 'react-dom', '@tauri-apps/api'] },
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..')] } },
});
