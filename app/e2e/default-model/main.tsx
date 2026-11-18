// ?view=desktop|phone · ?before=1 = 기본 모델 길이 없는 맥(옛 판과 같은 화면) · ?dark=1
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/setup.css';

const q = new URLSearchParams(location.search);
const before = q.get('before') === '1';
const view = { model: '', effort: '', models: ['opus', 'sonnet', 'haiku', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], userModel: 'opus', userEffort: 'high' };
const w = window as unknown as Record<string, unknown>;
w.__dm = before ? null : { ...view };
const calls: { cmd: string; args: unknown }[] = [];
w.__calls = calls;
const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
  calls.push({ cmd, args });
  if (cmd === 'default_model_view') { if (before) throw new Error('unknown command'); return { ...view }; }
  if (cmd === 'app_version') return '0.0.0';
  if (cmd === 'get_app_env') return { home: '/Users/me' };
  if (cmd === 'folder_status') return { exists: true, hqReady: true };
  if (cmd === 'claude_trusted') return true;
  if (cmd === 'check_env') return { claudePath: '/usr/local/bin/claude', claudeVersion: '2.1.326', loggedIn: true, clt: true, ghPath: null, ghUser: null, ghStale: false, python: true, gitName: 'me', gitEmail: 'me@example.com' };
  if (cmd === 'project_access') return { state: 'ok' };
  if (cmd === 'notify_status') return 'granted';
  if (cmd === 'ax_trusted' || cmd === 'screen_trusted') return true;
  if (cmd === 'write_config') { sessionStorage.setItem('saved', JSON.stringify(args.config)); return null; } // 저장 뒤 창을 다시 연다(reopen) — 페이지 밖에 남긴다
  return null;
};
w.__TAURI_INTERNALS__ = { invoke, transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (p: string) => p, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } } };

const root = createRoot(document.getElementById('root')!);
if (q.get('view') === 'phone') {
  await import('../../src/ui/mobile/mobile.css');
  const { MoreSheet } = await import('../../src/ui/mobile/MoreSheet');
  const push = { on: true, can: 'ok', busy: false };
  root.render(<MoreSheet busy={2} routines={1} left={63} push={push as never} onSessions={() => {}} onRoutines={() => {}} onAccount={() => {}} onPush={() => {}} onClose={() => {}} />);
} else {
  const { Setup } = await import('../../src/ui/Setup');
  const features = { office: true, gacha: true, review: true, voice: true, autoRevive: false, autoTidy: true, chiefCompact: true, agentView: true, computerUse: false, usagePing: true, craftBasics: false, bubble: true, bubbleDesk: true, animation: 'auto', kids: false };
  const config = { language: 'ko', assistantName: '참모', devRoot: '~/Developer', hqDir: '~/.chammo/hq', extraProjects: [], hiddenProjects: [], openFolders: [], githubUser: '', ttsCommand: 'say', memoDir: '~/.chammo/memo', features, setupDone: true, defaultModel: '', defaultEffort: '' };
  root.render(<Setup config={config as never} fontSize={13} onClose={() => {}} tab="agent" />);
}
