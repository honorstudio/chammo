// 하니터 다리 — 하니터 화면(iframe, harnitor://)이 window.__TAURI__ 인 줄 알고 부른 명령을 postMessage 로 받아
// 참모 명령 harnitor_<명령> 으로 넘긴다(Rust src/harnitor.rs). 옮긴 명령만 통과 — iframe 이 참모 명령을 마음대로 부르면 안 된다
import { tr } from '../i18n';
import { IS_WIN } from './reader';

/** 옮긴 하니터 명령(앞의 harnitor_ 뺀 이름). AI(ai_*)·청사진·작업대·스킬 만들기는 참모가 대신해서 안 옮겼다 */
const MOVED = new Set(['scan', 'scan_fast', 'peek_undo', 'plan_disable', 'plan_enable', 'plan_toggle_mcp', 'plan_toggle_hook', 'plan_toggle_plugin', 'apply_plan', 'undo', 'folder_tree', 'sessions']);

export const bridgeCommand = (cmd: string): string | null => (MOVED.has(cmd) ? `harnitor_${cmd}` : null);

/** 하니터 화면 주소 — 윈도우 WebView2 는 사용자 주소를 http://<이름>.localhost 로 받는다(hodoc 과 같은 규칙) */
export const harnitorUrl = (win = IS_WIN): string => (win ? 'http://harnitor.localhost/' : 'harnitor://localhost/');

/** 하니터 안에서 고른 것 — 프로젝트 이름·경로, 고른 항목 id(하니터 sel). 화면 감지와 탭 되돌아올 때 되살리기에 쓴다 */
export type HarnitorSel = { project: string; path: string; item: string };

export type BridgeMsg = { kind: 'invoke'; id: number; cmd: string; args: Record<string, unknown> } | { kind: 'esc' } | { kind: 'ready' } | ({ kind: 'view' } & HarnitorSel);

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

/** 참모가 읽는 말 — "프로젝트 project-b · 고른 것 mcp:p:supabase" */
export const harnitorViewWord = (v: HarnitorSel): string =>
  [v.project && tr(`프로젝트 ${v.project}`, `project ${v.project}`), v.item && tr(`고른 것 ${v.item}`, `picked ${v.item}`)].filter(Boolean).join(' · ');

/** iframe 이 보낸 것 → 할 일. 모양이 틀리면 null */
export function readBridgeMsg(data: unknown): BridgeMsg | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { harnitor?: unknown; id?: unknown; cmd?: unknown; args?: unknown };
  if (d.harnitor === 'esc') return { kind: 'esc' };
  if (d.harnitor === 'ready') return { kind: 'ready' };
  if (d.harnitor === 'view') { const v = d as { project?: unknown; path?: unknown; item?: unknown }; return { kind: 'view', project: str(v.project, 200), path: str(v.path, 300), item: str(v.item, 200) }; }
  if (d.harnitor !== 'invoke' || typeof d.id !== 'number' || typeof d.cmd !== 'string') return null;
  if (d.args != null && (typeof d.args !== 'object' || Array.isArray(d.args))) return null;
  return { kind: 'invoke', id: d.id, cmd: d.cmd, args: (d.args as Record<string, unknown> | undefined) ?? {} };
}

/** 하니터 색 변수 → 참모 테마 토큰(2026-10-01 사용자 "참모 색으로"). 하니터 CSS 는 그대로 두고 :root 변수만 덮는다 */
const TOKEN_OF: Record<string, string> = {
  '--ground': '--panel', '--surface': '--surface', '--surface-2': '--surface-2', '--surface-3': '--tag-bg',
  '--ink': '--text', '--ink-2': '--text-2', '--ink-3': '--text-3', '--line': '--line', '--line-2': '--line-strong',
  '--copper': '--accent', '--alert': '--danger-ink', '--alert-wash': '--danger-bg',
  '--teal': '--idle', '--teal-wash': '--tag-done', '--doc': '--working', '--doc-wash': '--tag-working',
};

/** 부모(참모)의 지금 토큰 값으로 하니터 변수 값을 만든다 — 밝은·어두운이 바뀌면 다시 불러 넘긴다. 못 읽은 토큰은 빼서 하니터 원래 색이 남는다 */
export function themeVars(token: (name: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [h, c] of Object.entries(TOKEN_OF)) {
    const v = token(c).trim();
    if (v) out[h] = v;
  }
  const accent = out['--copper'], surface = out['--surface'];
  if (accent && surface) {
    // 참모엔 강조색의 옅은 판이 없다 — 면 색에 섞어 만든다(하니터 copper-soft·copper-wash 자리)
    out['--copper-soft'] = `color-mix(in srgb, ${accent} 60%, ${surface})`;
    out['--copper-wash'] = `color-mix(in srgb, ${accent} 14%, ${surface})`;
  }
  return out;
}
