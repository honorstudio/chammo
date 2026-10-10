import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { filterAvailable, filterSkills, mcpRows, removeScope, respawnTargets, shortMcpName, type Available, type Market, type McpDot, type McpRow, type McpStatus, type PluginRow, type ToolSkill, type ToolsConf } from '../../domain/tools';
import { machine, tr } from '../../i18n';
import { IconClose, IconOpen, IconPlus, IconRefresh, IconSend, IconTrash } from '../Icons';
import { useOrchActions } from '../orchActions';
import { runPool } from '../../domain/runPool';
import './tools.css';

/** 켜기·끄기 — 글자 없이 손잡이만, 이름은 aria-label */
/** 플러그인 토큰 비용 — 앱이 켜진 동안 기억(화면을 다시 열 때마다 claude 를 또 부르지 않게) */
const costMemo = new Map<string, string>();

export function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} className={`tl-sw ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

const dotWord = (d: McpDot) =>
  d === 'ok' ? tr('연결됨', 'Connected') : d === 'fail' ? tr('연결 실패', 'Failed') : d === 'auth' ? tr('인증 필요', 'Needs sign-in')
  : d === 'pending' ? tr('승인 전', 'Pending approval') : d === 'off' ? tr('꺼짐', 'Off') : d === 'checking' ? tr('확인 중', 'Checking')
  : d === 'builtin' ? tr('켜짐 — 새로 켜는 세션부터', 'On — from newly started sessions') : tr('알 수 없음', 'Unknown');

const sourceWord = (r: McpRow) =>
  r.parked ? tr('모든 프로젝트에서 쉬는 중', 'Off in all projects')
  : r.source === 'local' ? tr('이 프로젝트 · 나만', 'This project · just me')
  : r.source === 'project' ? tr('이 프로젝트 · .mcp.json', 'This project · .mcp.json')
  : r.source === 'user' ? tr('모든 프로젝트', 'All projects')
  : r.source === 'connector' ? tr('claude.ai 커넥터', 'claude.ai connector')
  : r.source === 'plugin' ? tr('플러그인', 'Plugin')
  : r.source === 'builtin' ? tr(`Claude Code 내장 · 이 ${machine()} 화면 보고 클릭·입력`, `Built into Claude Code · sees and clicks on this ${machine()}'s screen`) : '';

const skillWhere = (s: ToolSkill) => (s.source === 'project' ? tr('프로젝트', 'Project') : s.source === 'plugin' ? tr('플러그인', 'Plugin') : tr('내 스킬', 'Mine'));

/**
 * 도구 — MCP·플러그인·스킬을 화면으로(2026-10-04 사용자 "슬래시 커맨드랑 mcp skills connector … 피씨 기준으로 먼저", 기획 docs/plans/2026-10-02-mcp-skills-panel.md).
 * 줄마다 토글 + 이름 + 한 줄 설명 + 상태 점. root = 기준 프로젝트(이 프로젝트에서 끄기의 '이 프로젝트')
 */
export function ToolsPage({ root, roots, onRoot, sessions, onInvoke, onOpen, computerUse }: {
  root: string;
  /** 고를 수 있는 기준 폴더(참모 HQ·프로젝트들) */
  roots: { name: string; root: string }[];
  onRoot: (root: string) => void;
  /** 이 폴더에서 도는 세션 — '지금 세션 다시 연결' 대상 */
  sessions: { id: string; kind: string; state: string; waitingFor?: string }[];
  /** 부르기 — 채팅 입력칸에 /이름 */
  onInvoke?: (name: string) => void;
  /** 열기 — SKILL.md 를 스페이스 문서로 */
  onOpen: (path: string) => void;
  /** 내장 화면 조종의 '모든 프로젝트' = 기능 computerUse(설정 저장 → Rust 가 모든 프로젝트에 넣거나 뺀다) */
  computerUse?: { all: boolean; setAll: (on: boolean) => void };
}) {
  const [conf, setConf] = useState<ToolsConf | null>(null);
  const [status, setStatus] = useState<McpStatus[] | null>(null);
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [changed, setChanged] = useState(false);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  // 2단계 — 더하기·지우기·인증·마켓플레이스·설치
  const act = useOrchActions();
  // danger = 빨간 버튼 — 지우기만, 설치·추가는 false
  const ask = (title: string, body: string, ok: string, run: () => void, danger = true) => (act ? act.confirm({ title, body, ok, run, danger }) : window.confirm(`${title}\n${body}`) && run());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', target: '', scope: 'local' });
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [marketAdd, setMarketAdd] = useState<string | null>(null);
  const [avail, setAvail] = useState<Available[] | null>(null);
  const [pq, setPq] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // 개발판 StrictMode 는 한 번 떼었다 붙인다 — 붙을 때 다시 켠다

  const fail = (e: unknown) => alive.current && setErr(String(e));
  const loadConf = () => invoke<ToolsConf>('tools_conf', { root }).then((c) => alive.current && setConf(c), fail);
  const loadStatus = () => invoke<McpStatus[]>('tools_mcp_status', { root }).then((s) => alive.current && setStatus(s), (e) => { fail(e); if (alive.current) setStatus([]); });
  const loadPlugins = () => invoke<PluginRow[]>('tools_plugins', { root }).then((p) => alive.current && setPlugins(p), (e) => { fail(e); if (alive.current) setPlugins([]); });
  const loadMarkets = () => invoke<Market[]>('tools_markets').then((m) => alive.current && setMarkets(m), (e) => { fail(e); if (alive.current) setMarkets([]); });
  const loadAvail = () => invoke<Available[]>('tools_available', { root }).then((a) => alive.current && setAvail(a), fail);
  const reload = () => { setErr(''); void loadConf(); void loadStatus(); void loadPlugins(); void loadMarkets(); if (avail) void loadAvail(); };
  useEffect(() => { setStatus(null); setPlugins(null); reload(); }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  // 토큰 비용 — 플러그인마다 claude 를 한 번씩 부른다. 셋까지만 같이(10개 차례로면 10초쯤 걸렸다), 한 번 물은 건 앱이 켜진 동안 기억
  useEffect(() => {
    if (!plugins) return;
    let stop = false;
    const known = Object.fromEntries(plugins.filter((p) => costMemo.has(p.id)).map((p) => [p.id, costMemo.get(p.id)!]));
    if (Object.keys(known).length) setCosts((m) => ({ ...known, ...m }));
    const ask = plugins.filter((p) => costs[p.id] === undefined && !costMemo.has(p.id));
    void runPool(ask, 3, async (p) => {
      const c = await invoke<string | null>('tools_plugin_cost', { id: p.id }).catch(() => null);
      costMemo.set(p.id, c ?? '');
      if (!stop && alive.current) setCosts((m) => ({ ...m, [p.id]: c ?? '' }));
    }, () => stop);
    return () => { stop = true; };
  }, [plugins]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, f: () => Promise<unknown>, after: () => void) => {
    setBusy((b) => [...b, key]); setErr(''); setNote('');
    try { await f(); setChanged(true); after(); } catch (e) { fail(e); } finally { if (alive.current) setBusy((b) => b.filter((x) => x !== key)); }
  };

  const rows = conf ? mcpRows(conf.mcp, status, conf.parked) : [];
  const toggleMcp = (r: McpRow, on: boolean) => {
    if (r.source === 'builtin' && all) { computerUse?.setAll(on); setChanged(true); return; }
    void run(`m:${r.name}`, () => invoke('tools_mcp_set', { root, name: r.name, on, all }), () => { void loadConf(); void loadStatus(); });
  };
  // 모든 프로젝트 화면 조종을 바꾸면 Rust 가 뒤에서 ~/.claude.json 을 고친다 — 잠깐 뒤 다시 읽어 이 프로젝트 줄도 맞춘다
  const cuAll = computerUse?.all;
  useEffect(() => { if (cuAll === undefined) return; const t = setTimeout(() => void loadConf(), 1200); return () => clearTimeout(t); }, [cuAll]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePlugin = (p: PluginRow, on: boolean) => void run(`p:${p.id}`, () => invoke('tools_plugin_set', { root, id: p.id, scope: p.scope, on }), () => { void loadPlugins(); void loadConf(); });
  const addMcp = () => void run('m+', () => invoke('tools_mcp_add', { root, name: form.name, target: form.target, scope: form.scope }), () => { setAdding(false); setForm({ name: '', target: '', scope: 'local' }); void loadConf(); void loadStatus(); });
  const removeMcp = (r: McpRow) => {
    const scope = removeScope(r);
    if (!scope) return;
    ask(tr(`${shortMcpName(r.name)} 지울까?`, `Remove ${shortMcpName(r.name)}?`),
      scope === 'user' || scope === 'parked' ? tr('모든 프로젝트에서 빠져. 설정은 백업해 두지만 다시 쓰려면 새로 추가해야 해.', 'It goes away for every project. Settings are backed up, but you will need to add it again.')
      : scope === 'project' ? tr('.mcp.json 에서 빠져 — 이 저장소를 같이 쓰는 사람도 안 보이게 돼.', 'Removed from .mcp.json — others using this repo lose it too.')
      : tr('이 프로젝트에서 빠져.', 'Removed from this project.'),
      tr('지우기', 'Remove'), () => void run(`m:${r.name}`, () => invoke('tools_mcp_remove', { root, name: r.name, scope }), () => { void loadConf(); void loadStatus(); }));
  };
  const login = (r: McpRow) => void run(`l:${r.name}`, () => invoke('tools_mcp_login', { root, name: r.name }), () => void loadStatus());
  const market = (action: 'add' | 'update' | 'remove', arg: string) => void run(`k:${action}:${arg}`, () => invoke('tools_market', { action, arg }), () => { setMarketAdd(null); void loadMarkets(); if (action !== 'update') { void loadPlugins(); void loadConf(); } setAvail(null); });
  const install = (a: Available) => ask(tr(`${a.name} 설치할까?`, `Install ${a.name}?`), a.desc || a.market, tr('설치', 'Install'),
    () => void run(`i:${a.id}`, () => invoke('tools_plugin_install', { id: a.id }), () => { void loadPlugins(); void loadConf(); setAvail((v) => v?.filter((x) => x.id !== a.id) ?? null); }), false);
  const targets = respawnTargets(sessions);
  const respawn = () => void run('respawn', () => invoke<number>('tools_respawn', { ids: targets.ids }).then((n) => {
    setNote(targets.busy ? tr(`세션 ${n}개 다시 연결 · 일하는 중 ${targets.busy}개는 끝나면 다시 켜 줘`, `Reconnected ${n} · ${targets.busy} busy — restart them when done`) : tr(`세션 ${n}개 다시 연결했어`, `Reconnected ${n} sessions`));
  }), () => setChanged(false));

  const skills = conf ? filterSkills(conf.skills, q) : [];
  const name = roots.find((r) => r.root === root)?.name ?? root.split(/[\\/]/).pop() ?? root;

  return (
    <div className="cv-dash tl">
      <header className="cv-page-head">
        <div className="cv-titles"><h1>{tr('도구', 'Tools')}</h1>
          <p>
            <select className="tl-root" value={root} onChange={(e) => onRoot(e.target.value)} aria-label={tr('기준 프로젝트', 'Project')}>
              {!roots.some((r) => r.root === root) && <option value={root}>{name}</option>}
              {roots.map((r) => <option key={r.root} value={r.root}>{r.name}</option>)}
            </select>
          </p>
        </div>
        <button className="cv-btn head-act tl-ic" onClick={reload} aria-label={tr('새로고침', 'Refresh')} title={tr('새로고침', 'Refresh')}><IconRefresh /></button>
      </header>
      <div className="cv-files tl-body">
        {err && <div className="tl-err" role="alert">{err}</div>}
        {(changed || note) && (
          <div className="tl-notice" role="status">
            <span>{note || tr('바꾼 건 새로 켜는 세션부터 먹어요', 'Changes apply to sessions started from now')}</span>
            {changed && targets.ids.length > 0 && <button className="cv-btn solid" disabled={busy.includes('respawn')} onClick={respawn}>{tr(`지금 세션 다시 연결 ${targets.ids.length}`, `Reconnect ${targets.ids.length} now`)}</button>}
          </div>
        )}

        <section className="tl-sec">
          <div className="tl-head">
            <h2>MCP</h2>
            <div className="tl-seg" role="radiogroup" aria-label={tr('토글 범위', 'Toggle scope')}>
              <button role="radio" aria-checked={!all} className={!all ? 'on' : ''} onClick={() => setAll(false)}>{tr('이 프로젝트', 'This project')}</button>
              <button role="radio" aria-checked={all} className={all ? 'on' : ''} onClick={() => setAll(true)}>{tr('모든 프로젝트', 'All projects')}</button>
            </div>
            <button className={`tl-act ${adding ? 'on' : ''}`} onClick={() => setAdding((v) => !v)} aria-label={tr('MCP 추가', 'Add MCP')} title={tr('MCP 추가', 'Add MCP')}>{adding ? <IconClose /> : <IconPlus />}</button>
          </div>
          {adding && (
            <form className="tl-form" onSubmit={(e) => { e.preventDefault(); addMcp(); }}>
              <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr('이름', 'Name')} aria-label={tr('이름', 'Name')} />
              <input className="wide" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder={tr('주소(https://…) 또는 명령(npx …)', 'URL (https://…) or command (npx …)')} aria-label={tr('주소 또는 명령', 'URL or command')} />
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} aria-label={tr('어디에', 'Where')}>
                <option value="local">{tr('이 프로젝트 · 나만', 'This project · just me')}</option>
                <option value="project">{tr('이 프로젝트 · .mcp.json', 'This project · .mcp.json')}</option>
                <option value="user">{tr('모든 프로젝트', 'All projects')}</option>
              </select>
              <button className="cv-btn solid" type="submit" disabled={!form.name.trim() || !form.target.trim() || busy.includes('m+')}>{tr('추가', 'Add')}</button>
            </form>
          )}
          {!conf && <div className="tl-empty">{tr('읽는 중…', 'Loading…')}</div>}
          {conf && rows.length === 0 && <div className="tl-empty">{tr('MCP 서버가 없어요', 'No MCP servers')}</div>}
          {rows.map((r) => {
            const on = all ? (r.source === 'builtin' ? !!computerUse?.all : !r.parked) : r.on;
            return (
              <div key={r.name} className={`tl-row ${on ? '' : 'off'}`}>
                <Switch on={on} disabled={busy.includes(`m:${r.name}`) || (all && (!r.canAll || (r.source === 'builtin' && !computerUse)))} label={tr(`${shortMcpName(r.name)} 켜기`, `Turn on ${shortMcpName(r.name)}`)} onChange={(v) => toggleMcp(r, v)} />
                <div className="tl-main" title={r.target}>
                  <b>{shortMcpName(r.name)}</b>
                  <span>{[sourceWord(r), r.target].filter(Boolean).join(' · ')}</span>
                </div>
                {r.dot === 'auth' && <button className="cv-btn tl-login" disabled={busy.includes(`l:${r.name}`)} onClick={() => login(r)} title={tr('브라우저에서 로그인 — 돌아오면 연결돼', 'Sign in in the browser')}>{busy.includes(`l:${r.name}`) ? tr('브라우저에서 기다리는 중…', 'Waiting for browser…') : tr('로그인', 'Sign in')}</button>}
                {removeScope(r) && <button className="tl-act hover" onClick={() => removeMcp(r)} aria-label={tr(`${shortMcpName(r.name)} 지우기`, `Remove ${shortMcpName(r.name)}`)} title={tr('지우기', 'Remove')}><IconTrash /></button>}
                <span className={`tl-dot ${r.dot}`} role="img" aria-label={dotWord(r.dot)} title={r.detail ? `${dotWord(r.dot)} — ${r.detail}` : dotWord(r.dot)} />
              </div>
            );
          })}
        </section>

        <section className="tl-sec">
          <div className="tl-head"><h2>{tr('플러그인', 'Plugins')}</h2><span className="tl-hint">{tr('모든 프로젝트', 'All projects')}</span></div>
          {!plugins && <div className="tl-empty">{tr('읽는 중…', 'Loading…')}</div>}
          {plugins && plugins.length === 0 && <div className="tl-empty">{tr('깔린 플러그인이 없어요', 'No plugins installed')}</div>}
          {plugins?.map((p) => (
            <div key={p.id} className={`tl-row ${p.enabled ? '' : 'off'}`}>
              <Switch on={p.enabled} disabled={busy.includes(`p:${p.id}`)} label={tr(`${p.name} 켜기`, `Enable ${p.name}`)} onChange={(v) => togglePlugin(p, v)} />
              <div className="tl-main" title={`${p.id} · ${p.version}`}>
                <b>{p.name}</b>
                <span>{p.desc || p.market}</span>
              </div>
              <span className="tl-meta">
                {[p.skills ? tr(`스킬 ${p.skills}`, `${p.skills} skills`) : '', p.mcp ? `MCP ${p.mcp}` : '', costs[p.id] ? tr(`늘 ${costs[p.id]} 토큰`, `${costs[p.id]} tok always`) : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
          <div className="tl-sub">
            <input className="tl-find wide" type="search" value={pq} onFocus={() => { if (!avail) void loadAvail(); }} onChange={(e) => setPq(e.target.value)} placeholder={tr('깔 플러그인 찾기', 'Find plugins to install')} aria-label={tr('깔 플러그인 찾기', 'Find plugins to install')} />
          </div>
          {pq.trim() && !avail && <div className="tl-empty">{tr('마켓플레이스 읽는 중…', 'Reading marketplaces…')}</div>}
          {avail && pq.trim() && filterAvailable(avail, pq).length === 0 && <div className="tl-empty">{tr('맞는 플러그인이 없어요', 'No matching plugins')}</div>}
          {avail && filterAvailable(avail, pq).map((a) => (
            <div key={a.id} className="tl-row">
              <div className="tl-main" title={a.id}><b>{a.name}</b><span>{[a.market, a.desc].filter(Boolean).join(' · ')}</span></div>
              <button className="cv-btn" disabled={busy.includes(`i:${a.id}`)} onClick={() => install(a)}>{busy.includes(`i:${a.id}`) ? tr('설치 중…', 'Installing…') : tr('설치', 'Install')}</button>
            </div>
          ))}

          <div className="tl-head sub"><h3>{tr('마켓플레이스', 'Marketplaces')}</h3>
            <button className="cv-btn" onClick={() => setMarketAdd((v) => (v === null ? '' : null))}>{marketAdd === null ? tr('마켓플레이스 추가', 'Add marketplace') : tr('그만', 'Cancel')}</button>
          </div>
          {marketAdd !== null && (
            <form className="tl-form" onSubmit={(e) => { e.preventDefault(); const src = marketAdd.trim(); if (src) ask(tr('이 마켓플레이스를 더할까?', 'Add this marketplace?'), tr(`${src} — 여기 있는 플러그인을 깔 수 있게 돼. 믿을 수 있는 곳만 더해 줘.`, `${src} — its plugins become installable. Only add sources you trust.`), tr('추가', 'Add'), () => market('add', src), false); }}>
              <input autoFocus className="wide" value={marketAdd} onChange={(e) => setMarketAdd(e.target.value)} placeholder={tr('GitHub 저장소(owner/repo)·git 주소·폴더', 'GitHub owner/repo, git URL or folder')} aria-label={tr('마켓플레이스 주소', 'Marketplace source')} />
              <button className="cv-btn solid" type="submit" disabled={!marketAdd.trim() || busy.some((b) => b.startsWith('k:add'))}>{busy.some((b) => b.startsWith('k:add')) ? tr('받는 중…', 'Fetching…') : tr('추가', 'Add')}</button>
            </form>
          )}
          {markets?.map((m) => (
            <div key={m.name} className="tl-row">
              <div className="tl-main" title={m.from}><b>{m.name}</b><span>{m.from}</span></div>
              <button className="tl-act" disabled={busy.includes(`k:update:${m.name}`)} onClick={() => market('update', m.name)} aria-label={tr(`${m.name} 업데이트`, `Update ${m.name}`)} title={tr('업데이트', 'Update')}><IconRefresh /></button>
              <button className="tl-act hover" onClick={() => ask(tr(`${m.name} 지울까?`, `Remove ${m.name}?`), tr('이 마켓플레이스에서 깐 플러그인도 같이 빠질 수 있어.', 'Plugins installed from it may be removed too.'), tr('지우기', 'Remove'), () => market('remove', m.name))} aria-label={tr(`${m.name} 지우기`, `Remove ${m.name}`)} title={tr('지우기', 'Remove')}><IconTrash /></button>
            </div>
          ))}
        </section>

        <section className="tl-sec">
          <div className="tl-head"><h2>{tr('스킬', 'Skills')}</h2>
            <input className="tl-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('찾기', 'Find')} aria-label={tr('스킬 찾기', 'Find skills')} />
          </div>
          {conf && skills.length === 0 && <div className="tl-empty">{q ? tr('맞는 스킬이 없어요', 'No matching skills') : tr('스킬이 없어요', 'No skills')}</div>}
          {skills.map((s) => (
            <div key={`${s.source}:${s.name}`} className="tl-row skill">
              <div className="tl-main" title={s.path}>
                <b>/{s.name}</b>
                <span>{skillWhere(s)}{s.desc ? ` · ${s.desc}` : ''}</span>
              </div>
              {onInvoke && <button className="tl-act" onClick={() => onInvoke(s.name)} aria-label={tr(`채팅에 /${s.name} 넣기`, `Put /${s.name} in chat`)} title={tr(`채팅에 /${s.name} 넣기`, `Put /${s.name} in chat`)}><IconSend /></button>}
              <button className="tl-act" onClick={() => onOpen(s.path)} aria-label={tr('스킬 문서 열기', 'Open skill file')} title={tr('스킬 문서 열기', 'Open skill file')}><IconOpen /></button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
