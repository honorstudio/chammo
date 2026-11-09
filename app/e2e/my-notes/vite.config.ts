// 내 메모 해피패스 E2E 받침 — 진짜 패널·문서 페이지(BlockNote)·폰 탭에 가짜 맥 저장소를 붙인다. 진짜 Rust 는 cargo 시험(notes::·mobile)이 잰다
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = __dirname;
const dir = process.env.E2E_NOTES!;
const calls: string[] = [];
/** notes/.meta.json 흉내 — 스킨·띄움·따로 창 */
const meta: Record<string, { skin?: string; shown?: boolean; win?: boolean }> = {};
let macOff = false;
/** 가짜 중계 지연(ms) — 폰 길(/api/note*) 요청마다. 재기(bench.mjs)는 300 */
const DELAY = Number(process.env.E2E_DELAY ?? 0);
const api: string[] = [];
/** 폰 받기 고리의 세션 목록(/api/sessions) — 메모 도장을 머리줄에 싣는다(mobile_http tagged_with). 메모 길(api)과 따로 센다 */
const sess: number[] = [];

const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req: import('node:http').IncomingMessage) => new Promise<string>((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });
const file = (name: string) => path.join(dir, name);
const titleOf = (t: string) => { const l = t.split('\n').map((x) => x.replace(/^#+\s*/, '').trim()).filter(Boolean); return { title: l[0] ?? '', preview: l[1] ?? '' }; };
const row = (name: string) => ({ name, path: file(name), ...titleOf(fs.readFileSync(file(name), 'utf8')), at: fs.statSync(file(name)).mtimeMs, skin: meta[name]?.skin ?? 'paper', shown: !!meta[name]?.shown, win: !!(meta[name]?.shown && meta[name]?.win) });
const list = () => fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map(row).sort((a, b) => b.at - a.at);
const create = () => {
  const top = list()[0];
  if (top && !top.title) { meta[top.name] = { ...meta[top.name], shown: true }; return row(top.name); }
  const name = `note-${Date.now()}.md`;
  fs.writeFileSync(file(name), '');
  meta[name] = { shown: true };
  return row(name);
};
const trash = (name: string) => {
  fs.mkdirSync(file('휴지통'), { recursive: true });
  fs.renameSync(file(name), path.join(dir, '휴지통', `${Date.now()}--${name}`));
};

/** 앱 명령(invoke) 흉내 + 폰 길(/api/note*) 흉내 — 모양은 notes.rs·mobile_http 와 같다 */
function fake(): Plugin {
  return {
    name: 'notes-fake',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://x');
        if (u.pathname === '/__state') return send(res, 200, { calls, api, sess: sess.length, meta, files: fs.readdirSync(dir), trash: fs.existsSync(file('휴지통')) ? fs.readdirSync(file('휴지통')) : [] });
        if (u.pathname === '/__apireset') { api.length = 0; sess.length = 0; return send(res, 200, {}); }
        if (u.pathname === '/__macoff') { macOff = u.searchParams.get('on') === '1'; return send(res, 200, {}); }
        if (u.pathname === '/__invoke') {
          const { cmd, args } = JSON.parse(await readBody(req)) as { cmd: string; args: Record<string, string> };
          calls.push(cmd);
          const ok = (v: unknown) => send(res, 200, { v: v ?? null });
          switch (cmd) {
            case 'notes_list': return ok(list());
            case 'notes_new': return ok(create());
            case 'notes_trash': trash(args.name!); return ok(null);
            case 'notes_meta': meta[args.name!] = { ...meta[args.name!], ...(args.patch as unknown as object) }; return ok(row(args.name!));
            case 'read_doc_text': return ok(fs.readFileSync(args.path!, 'utf8'));
            case 'doc_stamp': { const m = fs.statSync(args.path!); return ok(`${m.mtimeMs}:${m.size}`); }
            case 'write_doc_text': {
              if (args.expected !== undefined && fs.readFileSync(args.path!, 'utf8') !== args.expected) return send(res, 500, { e: 'CHANGED_OUTSIDE' });
              fs.writeFileSync(args.path!, args.text!);
              const m = fs.statSync(args.path!);
              return ok(`${m.mtimeMs}:${m.size}`);
            }
            default: return ok(null);
          }
        }
        if (u.pathname === '/api/sessions') {
          if (macOff) { res.destroy(); return; }
          sess.push(Date.now());
          if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
          const same = u.searchParams.get('since') === 't';
          return send(res, 200, `${JSON.stringify({ tag: 't', same, notes: String(fs.statSync(dir, { bigint: true }).mtimeNs) })}\n${same ? '' : '[]'}`);
        }
        if (u.pathname.startsWith('/api/note')) {
          if (macOff) { res.destroy(); return; }
          api.push(u.pathname);
          if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
          if (u.pathname === '/api/notes') return send(res, 200, list());
          if (u.pathname === '/api/note') return send(res, 200, fs.readFileSync(file(u.searchParams.get('name')!), 'utf8'));
          const b = JSON.parse(await readBody(req)) as { name: string; text: string; base?: string };
          if (u.pathname === '/api/note-new') return send(res, 200, create());
          if (u.pathname === '/api/note-trash') { trash(b.name); return send(res, 200, { ok: true }); }
          if (u.pathname === '/api/note-meta') { const { name, ...patch } = b as Record<string, unknown>; meta[b.name] = { ...meta[b.name], ...patch }; return send(res, 200, row(b.name)); }
          if (fs.readFileSync(file(b.name), 'utf8') !== b.base) return send(res, 409, 'CHANGED_OUTSIDE');
          fs.writeFileSync(`${file(b.name)}.tmp`, b.text); // 맥처럼 바꿔 끼우기(reader::write_checked) — 폴더 도장이 바뀐다
          fs.renameSync(`${file(b.name)}.tmp`, file(b.name));
          return send(res, 200, row(b.name));
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
  server: { port: Number(process.env.E2E_PORT), strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(here, '../..')] } },
});
