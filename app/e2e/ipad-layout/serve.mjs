#!/usr/bin/env node
// 아이패드 화면 하네스 — 진짜 폰 화면(mobile.html)을 vite 로, /api 는 이 파일의 가짜 폰 서버로(phone-chief-flash·옛 .shots/ipad 하네스를 이어 씀).
// 참모 일곱·프로젝트 세션·대화·맡긴 일이 다 찬 화면 — 패드 가로·세로 전후 캡처(shoot.mjs)와 시뮬레이터 사파리가 같이 쓴다.
//   node app/e2e/ipad-layout/serve.mjs [--app <app 폴더>] [--data <이름 덮어쓰기 json>] [--port 47531]
//   → http://127.0.0.1:<port>/__setup 을 열면 열쇠를 넣고 mobile.html 로 간다. Ctrl+C 로 끔
// --data: { "chiefs": [[이름, state, status, 프사|null, 맡은 일]], "projects": [[이름, state, status]] } — 공개 저장소에 못 둘 실제 이름 모양은 .shots 에 두고 넘긴다
// 지어낸 데이터만 기본으로 둔다(이 파일은 공개판에 나간다).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const appDir = path.resolve(arg('--app', path.resolve(here, '../..')));
const PORT = Number(arg('--port', 47531)), FAKE = PORT - 1;

const BLUE = '#2f74e0', PINK = '#d23f6b', GREEN = '#1f9a62';
let CHIEFS = [
  ['참모 · 앱 담당', 'working', 'busy', { kind: 'preset', shape: 'mochi', eyes: 'pill', color: BLUE }, '앱 고치기'],
  ['참모-2 · 문서 담당', 'blocked', 'idle', { kind: 'preset', shape: 'cloud', eyes: 'pill', color: PINK }, '문서 정리'],
  ['참모-3 · 사이트 담당', 'working', 'idle', null, '사이트'],
  ['참모-4 · 운영 담당', 'working', 'busy', null, ''],
  ['참모-5 · 디자인 담당', 'done', 'idle', { kind: 'preset', shape: 'hexa', eyes: 'pill', color: PINK }, '디자인'],
  ['참모-6 · 조사 담당', 'working', 'idle', { kind: 'preset', shape: 'jelly', eyes: 'pill', color: null }, '자료 찾기'],
  ['참모-7 · 메모 담당', 'done', 'idle', { kind: 'preset', shape: 'capsule', eyes: 'dark', color: BLUE }, ''],
];
let PROJECTS = [
  ['alpha-app', 'working', 'busy'], ['beta-site', 'working', 'busy'], ['alpha-app-2', 'done', 'idle'], ['gamma-docs', 'working', 'idle'],
];
const over = arg('--data');
if (over) { const d = JSON.parse(fs.readFileSync(over, 'utf8')); CHIEFS = d.chiefs ?? CHIEFS; PROJECTS = d.projects ?? PROJECTS; }

const sid = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const HQ = '/Users/me/hq', DEV = '/Users/me/dev';
const sessions = [
  ...CHIEFS.map(([name, state, status], i) => ({ id: `c${i}`, pid: 1000 + i, sessionId: sid(i + 1), cwd: HQ, name, state, status, kind: 'background', startedAt: 1791600000000 + i })),
  ...PROJECTS.map(([name, state, status], i) => ({ id: `p${i}`, pid: 2000 + i, sessionId: sid(100 + i), cwd: `${DEV}/${name}`, name, state, status, kind: 'background', startedAt: 1791600100000 + i })),
];
const lead = sessions[0];
const now = Date.now();
const iso = (m) => new Date(now - m * 60_000).toISOString();
const line = (role, text, m, i) => JSON.stringify(role === 'user'
  ? { type: 'user', uuid: `u${i}`, timestamp: iso(m), message: { role: 'user', content: text }, origin: { kind: 'human' } }
  : { type: 'assistant', uuid: `a${i}`, timestamp: iso(m), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const P = PROJECTS.map((p) => p[0]);
const CHAT = [
  ['user', '태블릿에서 보니까 화면이 너무 휑해. 넓은 화면답게 바꿀 수 있어?', 48],
  ['assistant', `그럴게. ${P[0]} 세션에 시안부터 맡겼어 — 두세 안 받아 올게.`, 47],
  ['user', '어제 고친 거 반영됐어?', 31],
  ['assistant', '응, 반영했어.\n\n- 시험 120개 통과\n- 다시 켜기 3초', 30],
  ['user', '목록 정렬도 같이 봐줘', 12],
  ['assistant', `${P[1]} 세션에 맡겼어. 끝나면 알려 줄게.`, 11],
].map(([r, t, m], i) => line(r, t, m, i)).join('\n') + '\n';
const ev = (o) => JSON.stringify({ from: lead.sessionId.slice(0, 8), fromName: lead.name.split(' · ')[0], ...o });
const TASKS = [
  ev({ ts: iso(47), type: 'send', task: 't-1', target: P[0], title: '넓은 화면 시안', effort: 'design' }),
  ev({ ts: iso(40), type: 'send', task: 't-2', target: P[2], title: '목록 빈 칸 고치기', effort: 'high' }),
  ev({ ts: iso(33), type: 'done', task: 't-2', note: '머지 0a1b2c3d · 시험 통과 · 캡처 list-1.png' }),
  ev({ ts: iso(11), type: 'send', task: 't-3', target: P[1], title: '목록 정렬', effort: 'high' }),
  ev({ ts: iso(25), type: 'send', task: 't-4', target: P[3], title: '첫 화면 빨리 띄우기', effort: 'medium' }),
].join('\n') + '\n';
const tail = (s) => (s.state === 'working' ? '일하는 중' : s.state === 'blocked' ? '답을 기다려' : '끝났어');
const pins = JSON.stringify([sessions[0].sessionId, sessions[1].sessionId]);
const order = JSON.stringify(CHIEFS.map((_, i) => sid(i + 1)));
const roles = JSON.stringify(Object.fromEntries(CHIEFS.map(([n, , , , r]) => [n.split(' · ')[0], { role: r, at: 0 }])));
const avatars = CHIEFS.filter((c) => c[3]).map(([n, , , a]) => ({ key: n.split(' · ')[0], avatar: { voice: null, ...a }, v: 1 }));

// --kids: 참모-7 이 키즈 참모(아이 '서아') — 보호자 채팅에 아이 화면 대화·'오늘 만든 것' 줄(아홉째 조각, kids.mjs)
const KIDS = argv.includes('--kids');
const day = new Date().setHours(0, 0, 0, 0);
const kt = (min) => Math.max(Date.now() - 40 * 60_000, day + 60_000) + min * 60_000;
const kidsToday = { child: '서아', time: { usedMs: 12 * 60_000, limitMs: 20 * 60_000, leftMs: 8 * 60_000 },
  works: [{ name: 'dino', title: '공룡 점프', mtime: kt(9) }, { name: 'cloud', title: '구름 비', mtime: kt(14) }],
  rows: [
    { ts: kt(1), who: 'kid', text: '공룡이 점프하는 게임 만들어 줘' },
    { ts: kt(1.2), who: 'assistant', text: '좋아! 공룡 점프 게임을 만들었어. 톡 누르면 공룡이 껑충 뛰어.' },
    { ts: kt(1.3), who: 'app', text: '만들기 dino: 공룡이 점프하는 게임' },
    { ts: kt(5), who: 'kid', text: '두 마리로 해 줘' },
    { ts: kt(5.2), who: 'app', text: '고치기 dino: 공룡 두 마리로' },
    { ts: kt(9), who: 'app', text: '고치기 dino: 빨간색으로' },
    { ts: kt(13), who: 'kid', text: '구름에서 비 오게 해 줘' },
    { ts: kt(13.2), who: 'assistant', text: '비 오는 구름 만들었어! 우산도 그려 볼까?' },
    { ts: kt(14), who: 'app', text: '만들기 cloud: 구름에서 비가 오는 그림' },
  ] };
const kidsWork = (n) => `<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#e8f4ea;font:48px sans-serif"><div id="w">${n === 'dino' ? '공룡 점프' : '구름 비'}</div></body>`;

function api(u) {
  const id = u.searchParams.get('id') ?? '';
  switch (u.pathname) {
    case '/api/env': return [200, { assistantName: '참모', language: 'ko', devRoot: DEV, extraProjects: [], hqDir: HQ, deviceName: 'MacBook Test', ...(KIDS ? { kids: true, kidsOrchs: ['참모-7'] } : {}) }];
    case '/api/kids-today': return KIDS && u.searchParams.get('key') === '참모-7' ? [200, kidsToday] : [404, 'not a kids assistant'];
    case '/api/kids-work': return KIDS ? [200, kidsWork(u.searchParams.get('name'))] : [404, 'no work'];
    case '/api/sessions': return [200, `{"tag":"t1","same":false}\n${JSON.stringify(sessions)}`];
    case '/api/shows': return [200, '{"tag":"s1","same":false}\n'];
    case '/api/tasks': return [200, u.searchParams.get('from') && u.searchParams.get('from') !== '0' ? '' : TASKS];
    case '/api/transcript': {
      if (u.searchParams.has('before')) return [200, { text: '', start: 0 }];
      const from = Number(u.searchParams.get('from') ?? 0);
      if (from > 0) return [200, { text: '', next: CHAT.length, reset: false, start: 0 }];
      return [200, { text: id === lead.sessionId ? CHAT : '', next: CHAT.length, reset: true, start: 0 }];
    }
    case '/api/tails': return [200, Object.fromEntries((u.searchParams.get('ids') ?? '').split(',').filter(Boolean).map((k) => { const s = sessions.find((x) => x.sessionId === k); return [k, s ? tail(s) : '']; }))];
    case '/api/send-status': return [200, { state: 'done' }];
    case '/api/usage': case '/api/load': return [200, '{}'];
    case '/api/roles': return [200, roles];
    case '/api/pins': return [200, pins];
    case '/api/order': return [200, order];
    case '/api/avatars': return [200, avatars];
    case '/api/peer-devices': case '/api/stopped': case '/api/routines': case '/api/browsers': case '/api/notes': case '/api/modes': return [200, []];
    case '/api/direct': case '/api/peer-cards': return [200, ''];
    case '/api/accounts': return [502, 'unsupported'];
    case '/api/phone-account': return [200, { line: 'relay' }];
    case '/api/push-key': return [404, 'no'];
    case '/api/locker': return [200, { items: [], ids: {} }];
    case '/api/team': return [200, { view: { joined: false }, items: [] }];
    default: return [404, 'not found'];
  }
}
const misses = new Set();
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  req.resume();
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer tok-e2e') { res.writeHead(401); res.end('no key'); return; }
    const [st, body] = api(u);
    if (st === 404 && !misses.has(u.pathname)) { misses.add(u.pathname); console.log('404', u.pathname); }
    res.writeHead(st, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}).listen(FAKE, '127.0.0.1');

const req = createRequire(path.join(appDir, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const react = (await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default;
const pro = path.resolve(appDir, '../pro/web');
const setup = { name: 'setup', configureServer(s) { s.middlewares.use((q, r, next) => {
  if (q.url.startsWith('/__setup')) { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<script>localStorage.clear();localStorage.setItem('chammo.token','tok-e2e');var o=new URLSearchParams(location.search).get('orch');if(o)localStorage.setItem('m.orch',o);location.replace('/mobile.html?v='+Date.now())</script>`); return; }
  next();
}); } };
const vite = await createServer({ configFile: false, root: appDir, plugins: [react(), setup], cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ipad-vite-')),
  optimizeDeps: { entries: ['mobile.html'] }, resolve: { alias: { '@pro': fs.existsSync(pro) ? pro : path.resolve(appDir, 'src/pro-stub') }, dedupe: ['react', 'react-dom', '@tauri-apps/api'] },
  server: { port: PORT, strictPort: true, host: '127.0.0.1', fs: { strict: false }, proxy: { '/api': `http://127.0.0.1:${FAKE}` } }, logLevel: 'error', clearScreen: false });
await vite.listen();
console.log('ready', PORT);
