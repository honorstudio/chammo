// 진짜 FirstRun + 가짜 앱 명령. 상태는 sessionStorage 에 둬 '껐다 켜기'(새로 읽기)를 넘어간다 — run.mjs 가 window.__fake 로 조건을 건다
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import type { Config } from '../../src/data/tauri';

type Acc = { id: string; name: string; email: string };
type Fake = {
  python: boolean; claude: boolean; loggedIn: boolean; browser: boolean; git: boolean; winPython: boolean; winget: boolean;
  /** 다음 실패 — 그 일에서 한 번 실패 */ fail: Record<string, string>;
  loginDone: boolean; browserMs: number; installMs: number; live: string | null; accounts: Acc[]; nextEmail: string | null;
  calls: { cmd: string; args?: unknown }[]; closed: number[]; consented: boolean;
};
const KEY = 'fake-state';
const init: Fake = { python: false, claude: false, loggedIn: false, browser: false, git: false, winPython: false, winget: true, fail: {}, loginDone: true, browserMs: 400, installMs: 250, live: null, accounts: [], nextEmail: null, calls: [], closed: [], consented: false };
const f: Fake = { ...init, ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}') };
const save = () => sessionStorage.setItem(KEY, JSON.stringify(f));
(window as unknown as { __fake: Fake; __save: () => void }).__fake = f;
(window as unknown as { __save: () => void }).__save = save;

const config: Config = { language: 'ko', assistantName: '', devRoot: '~/Developer', hqDir: '~/.chammo/hq', extraProjects: [], hiddenProjects: [], githubUser: '', ttsCommand: 'say', memoDir: '~/.chammo/memo', setupDone: false, features: { git: false, usagePing: true } } as unknown as Config;

const cbs = new Map<number, (m: unknown) => void>();
let cb = 0, ptyId = 0;
const enc = new TextEncoder();
const ptys = new Map<number, { end: () => void }>();

function openPty(command: string, onData: { id: number }) {
  const id = ++ptyId;
  const send = (i: number, b: Uint8Array) => cbs.get(onData.id)?.({ message: Array.from(b), index: i });
  let i = 0, over = false;
  const say = (t: string) => send(i++, enc.encode(t));
  const end = () => { if (over) return; over = true; send(i++, new Uint8Array()); };
  ptys.set(id, { end });
  const fin = (key: string, ok: () => void, ms = f.installMs) => setTimeout(() => {
    if (over) return;
    if (f.fail[key]) { say(f.fail[key]!); delete f.fail[key]; save(); } else { ok(); save(); }
    end();
  }, ms);
  if (/get-tool'? python/.test(command)) fin('python', () => { f.python = true; });
  else if (/install\.sh|winInstall|powershell/i.test(command)) fin('claude', () => { f.claude = true; });
  else if (/Git\.Git/.test(command)) fin('git', () => { f.git = true; });
  else if (/Python\.Python/.test(command)) fin('winpy', () => { f.winPython = true; });
  else if (/auth login/.test(command)) {
    say('Opening browser to sign in…\r\n');
    // 진짜 auth login 은 사람이 브라우저에서 허용해야 끝난다
    if (f.loginDone) setTimeout(() => { if (over) return; f.loggedIn = true; f.live = f.nextEmail ?? f.live ?? 'me@example.com'; save(); end(); }, 300);
  } else end();
  return id;
}

const view = () => ({ accounts: f.accounts, active: f.accounts.find((a) => a.email === f.live)?.id ?? null, liveEmail: f.live, livePlan: null });

const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
  f.calls.push({ cmd, args: cmd === 'pty_open' ? { command: args.command } : args }); save();
  switch (cmd) {
    case 'trust_consented': return f.consented;
    case 'trust_consent': f.consented = true; save(); return null;
    case 'app_env': return { home: '/Users/me', dataDir: '/Users/me/.chammo', platform: 'macos' };
    case 'base_tools': return { needed: true, python: f.python, git: f.git, getter: '/Users/me/.chammo/tools/bin/chammo-get-tool' };
    case 'check_env': return { claudePath: f.claude ? '/Users/me/.local/bin/claude' : null, claudeVersion: f.claude ? '2.1.318 (Claude Code)' : '', loggedIn: f.loggedIn, loginUnknown: false, clt: f.git, ghPath: null, ghUser: null, ghStale: false, python: /Windows/.test(navigator.userAgent) ? f.winPython : f.python, winget: f.winget, gitName: '', gitEmail: '' };
    case 'browser_status': return { node: null, nodeVersion: '', nodeOk: f.browser, nodeSource: '', installed: f.browser, chrome: f.browser, chromeBeta: f.browser, checked: f.browser, ready: f.browser };
    case 'browser_setup_start': {
      const s = { running: true, step: 'node', pct: null, text: '', error: null as string | null, done: false };
      (window as unknown as { __b: unknown }).__b = s;
      setTimeout(() => { s.running = false; if (f.fail.browser) { s.error = f.fail.browser; delete f.fail.browser; } else { s.done = true; f.browser = true; } save(); }, f.browserMs);
      return null;
    }
    case 'browser_setup_state': return (window as unknown as { __b?: unknown }).__b ?? { running: false, step: null, pct: null, text: '', error: null, done: false };
    case 'folder_status': return { exists: true, hqReady: false };
    case 'create_hq': return { written: [], kept: [] };
    case 'pty_open': return openPty(args.command as string, args.onData as { id: number });
    case 'pty_close': f.closed.push(args.id as number); ptys.get(args.id as number)?.end(); save(); return null;
    case 'accounts_view': return view();
    case 'accounts_capture': if (f.live && !f.accounts.some((a) => a.email === f.live)) { f.accounts.push({ id: `a${f.accounts.length}`, name: '', email: f.live }); save(); } return view();
    case 'accounts_auto_patch': return view();
    case 'write_config': return null;
    default: return null;
  }
};
const w = window as unknown as { __TAURI_INTERNALS__: unknown };
w.__TAURI_INTERNALS__ = {
  invoke,
  transformCallback: (fn: (m: unknown) => void) => { const id = ++cb; cbs.set(id, fn); return id; },
  unregisterCallback: (id: number) => cbs.delete(id),
  convertFileSrc: (p: string) => p,
};

const { FirstRun } = await import('../../src/ui/FirstRun');
createRoot(document.getElementById('root')!).render(<FirstRun config={config} />);
