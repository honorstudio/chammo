// 도구 화면(스페이스 '도구') 판단 — MCP 설정·상태·쉬어 둔 것을 한 목록으로, 다시 연결할 세션 고르기, 스킬 찾기.
// 읽고 고치는 건 Rust tools.rs(claude 명령줄·설정 파일). 2026-10-04 사용자 "슬래시 커맨드랑 mcp skills connector … 피씨 기준으로 먼저"

/** 설정 파일에서 본 MCP(Rust McpConf) — local = 이 프로젝트 나만, project = .mcp.json, user = 모든 프로젝트,
 *  builtin = Claude Code 내장 화면 조종(computer-use, 맥만 — 켬은 ~/.claude.json enabledMcpServers, 모든 프로젝트는 기능 computerUse) */
export type McpConf = { name: string; source: 'user' | 'local' | 'project' | 'builtin'; target: string; http: boolean; offHere: boolean };
/** `claude mcp list` 한 줄(Rust McpStatus) */
export type McpStatus = { name: string; target: string; state: 'ok' | 'fail' | 'off' | 'pending' | 'auth' | 'unknown'; detail: string };
export type McpSource = McpConf['source'] | 'connector' | 'plugin' | 'other';
/** builtin = 내장이라 mcp list 에 안 나온다 — 켬만 안다 */
export type McpDot = McpStatus['state'] | 'checking' | 'builtin';
export type McpRow = {
  name: string;
  source: McpSource;
  target: string;
  http: boolean;
  /** 이 프로젝트에서 켜져 있나 */
  on: boolean;
  dot: McpDot;
  detail: string;
  /** 모든 프로젝트에서 쉬어 둔 것(mcp-parked.json) */
  parked: boolean;
  /** 모든 프로젝트 토글이 되나 — 사용자 범위만 */
  canAll: boolean;
};
export type ToolSkill = { name: string; desc: string; source: 'user' | 'project' | 'plugin'; path: string; plugin: string | null };
export type ToolsConf = { mcp: McpConf[]; parked: string[]; skills: ToolSkill[] };
export type PluginRow = { id: string; name: string; market: string; scope: string; enabled: boolean; version: string; desc: string; installPath: string; skills: number; mcp: number };

const ORDER: McpSource[] = ['local', 'project', 'user', 'builtin', 'connector', 'plugin', 'other'];
const sourceOf = (name: string): McpSource => (name.startsWith('claude.ai ') ? 'connector' : name.startsWith('plugin:') ? 'plugin' : 'other');

/** 설정 + 상태(아직 없으면 null) + 쉬어 둔 이름 → 화면 줄. 이 프로젝트 것 → 사용자 → 커넥터 → 플러그인 */
export function mcpRows(conf: McpConf[], status: McpStatus[] | null, parked: string[]): McpRow[] {
  const st = new Map((status ?? []).map((s) => [s.name, s]));
  const dot = (name: string, on: boolean): McpDot => (!on ? 'off' : status === null ? 'checking' : st.get(name)?.state ?? 'unknown');
  const rows: McpRow[] = conf.map((c) => ({ name: c.name, source: c.source, target: c.target, http: c.http, on: !c.offHere,
    dot: c.source === 'builtin' ? (c.offHere ? 'off' : 'builtin') : dot(c.name, !c.offHere), detail: st.get(c.name)?.detail ?? '', parked: false, canAll: c.source === 'user' || c.source === 'builtin' }));
  const known = new Set(rows.map((r) => r.name));
  for (const p of parked) {
    if (known.has(p)) continue;
    known.add(p);
    rows.push({ name: p, source: 'user', target: '', http: false, on: false, dot: 'off', detail: '', parked: true, canAll: true });
  }
  for (const s of status ?? []) {
    if (known.has(s.name)) continue;
    known.add(s.name);
    const on = s.state !== 'off';
    rows.push({ name: s.name, source: sourceOf(s.name), target: s.target, http: /\((HTTP|SSE)\)$/.test(s.target), on, dot: dot(s.name, on), detail: s.detail, parked: false, canAll: false });
  }
  return rows.map((r, i) => [r, i] as const).sort((a, b) => ORDER.indexOf(a[0].source) - ORDER.indexOf(b[0].source) || a[1] - b[1]).map(([r]) => r);
}

/** 화면 이름 — 커넥터는 'claude.ai ' 를, 플러그인은 'plugin:' 을 뗀다(플러그인과 서버 이름이 같으면 하나만) */
export function shortMcpName(name: string): string {
  if (name.startsWith('claude.ai ')) return name.slice('claude.ai '.length);
  const m = name.match(/^plugin:([^:]+):(.+)$/);
  if (m) return m[1] === m[2] ? m[1]! : `${m[1]} · ${m[2]}`;
  return name;
}

/** 바꾼 도구를 지금 세션에 먹이기 — 쉬는 백그라운드 세션만 respawn. 일하는 중·창(선택지·권한)을 기다리는 세션은 건너뛰고 수만 */
export function respawnTargets(sessions: { id: string; kind: string; state: string; waitingFor?: string }[]): { ids: string[]; busy: number } {
  const bg = sessions.filter((s) => s.kind === 'background');
  const busy = bg.filter((s) => s.state === 'working' || !!s.waitingFor);
  return { ids: bg.filter((s) => !busy.includes(s)).map((s) => s.id), busy: busy.length };
}

/** 스킬 찾기 — 이름·설명, 대소문자 없이 */
export function filterSkills(skills: ToolSkill[], q: string): ToolSkill[] {
  const k = q.trim().toLowerCase();
  return k ? skills.filter((s) => s.name.toLowerCase().includes(k) || s.desc.toLowerCase().includes(k)) : skills;
}

/** 깔 수 있는 플러그인(Rust Available) · 마켓플레이스(Rust Market) */
export type Available = { id: string; name: string; desc: string; market: string };
export type Market = { name: string; from: string };

/** 지우기 범위 — 설정에 적힌 건 그 범위, 쉬어 둔 건 'parked'(쉬어 둔 설정만 지움). 커넥터·플러그인·출처 모름은 여기서 못 지운다 */
export function removeScope(r: McpRow): 'user' | 'local' | 'project' | 'parked' | null {
  if (r.parked) return 'parked';
  return r.source === 'user' || r.source === 'local' || r.source === 'project' ? r.source : null; // builtin(내장)은 못 지운다
}

/** 깔 플러그인 찾기 — 목록이 수천 개라 빈 글이면 안 보인다. 이름 앞이 맞는 것 먼저 */
export function filterAvailable(list: Available[], q: string, max = 20): Available[] {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  const hit = list.filter((a) => a.name.toLowerCase().includes(k) || a.desc.toLowerCase().includes(k) || a.market.toLowerCase().includes(k));
  const head = hit.filter((a) => a.name.toLowerCase().startsWith(k));
  return [...head, ...hit.filter((a) => !head.includes(a))].slice(0, max);
}
