// 채팅 뷰 스페이스 왼쪽 목록 — 지금 채팅 탭 참모가 잡고 있는 세션, 그 세션이 보여 준 파일(2026-09-30 사용자)
import { parseAt, type ShowAt } from './showAt';
import type { TaskEvent } from './tasks';

const DAY = 24 * 3600_000;

/** 일마다 주인 참모 — send 의 from, 사용자가 나중에 붙인 own 이 있으면 그것. 둘 다 없으면 주인 없음 */
export function owners(events: TaskEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) if ((e.type === 'send' || e.type === 'own') && e.from) m.set(e.task, e.from);
  return m;
}
const openSends = (events: TaskEvent[], now: number) => {
  const done = new Set(events.filter((e) => e.type === 'done').map((e) => e.task));
  return events.filter((e) => e.type === 'send' && e.target && !done.has(e.task) && now - Date.parse(e.ts) <= DAY);
};

const HOLD = 3 * DAY;
/** 같은 세션인지 — `task send` 는 "이름 [id 앞자리]" 로 남긴다 */
const targetKey = (t: string) => t.replace(/ \[[0-9a-f]{4,}\]$/, '');

/** 이 참모가 잡고 있는 세션 — 그 세션에 마지막으로 일을 보낸(또는 사용자가 붙인) 참모가 잡는다. 끝으로 닫아도 유지하고
 *  다른 참모가 보내거나 사흘이 지나면 풀린다(2026-09-30 사용자 — 답 받자마자 닫아서 표시가 사라졌다). 최근 순·한 번씩 */
export function heldBy(events: TaskEvent[], orchId: string, now: number): string[] {
  const own = owners(events);
  const last = new Map<string, TaskEvent>();
  for (const e of events) {
    if (e.type !== 'send' || !e.target || !own.has(e.task) || now - Date.parse(e.ts) > HOLD) continue;
    const k = targetKey(e.target);
    const prev = last.get(k);
    if (!prev || Date.parse(e.ts) >= Date.parse(prev.ts)) last.set(k, e);
  }
  return [...last.values()].filter((e) => own.get(e.task) === orchId)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).map((e) => e.target!);
}

/** 누가 시켰는지 모르는 열린 일(하루 안) — 대시보드 힌트로 보여 주고 사용자가 주인을 붙이거나 끝으로 정리 */
export function orphanSends(events: TaskEvent[], now: number): { task: string; target: string; title?: string; ts: string }[] {
  const own = owners(events);
  return openSends(events, now).filter((e) => !own.has(e.task)).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .map((e) => ({ task: e.task, target: e.target!, title: e.title, ts: e.ts }));
}

/** scripts/show 기록(show.jsonl)에서 그 세션이 보여 준 파일 — 최근 순, 같은 파일은 한 번 */
export function shownFiles(log: string, sessionId: string): { path: string; ts: string; at?: ShowAt }[] {
  const rows: { path: string; ts: string; at?: ShowAt }[] = [];
  for (const line of log.split('\n')) {
    try {
      const r = JSON.parse(line) as { path?: string; ts?: string; from?: string; at?: unknown; gone?: boolean };
      const at = parseAt(r.at);
      // gone = 앱이 기록을 읽을 때 본 폴더에서도 못 찾은 파일(reader::read_show_log) — 눌러도 열 게 없어 뺀다
      if (r.from === sessionId && r.path && !r.gone) rows.push({ path: r.path, ts: r.ts ?? '', ...(at ? { at } : {}) });
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  const seen = new Set<string>();
  return rows.reverse().filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

/** 프로젝트 세션마다 잡고 있는 참모들(참모 순서대로) — 메뉴에서 세션 옆 참모 색 점. resolve = 대상 이름 → 살아 있는 세션 id(없으면 뺀다) */
export function holderMap(events: TaskEvent[], orchIds: string[], resolve: (target: string) => string | undefined, now: number): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const o of orchIds) {
    for (const t of heldBy(events, o, now)) {
      const id = resolve(t);
      if (!id || orchIds.includes(id)) continue;
      const list = m.get(id) ?? [];
      if (!list.includes(o)) m.set(id, [...list, o]);
    }
  }
  return m;
}

/** 대화 기록으로 잡은 세션(`claude --bg … -n`·SendMessage)을 holderMap 에 더한다 — 단 작업 기록에 이미 주인이 있으면 그 세션은 건너뛴다.
 *  task handoff 로 넘긴 세션이 처음 띄운 참모 대시보드에 계속 남았다(2026-10-02 사용자). 원본 지도는 안 바꾼다 */
export function addSpawned(m: Map<string, string[]>, spawned: Map<string, Set<string>>, resolve: (target: string) => string | undefined, orchIds: string[]): Map<string, string[]> {
  const out = new Map(m);
  for (const [oid, names] of spawned) {
    for (const n of names) {
      const id = resolve(n);
      if (!id || orchIds.includes(id) || m.has(id)) continue;
      const list = out.get(id) ?? [];
      if (!list.includes(oid)) out.set(id, [...list, oid]);
    }
  }
  return out;
}

/** since(ms) 뒤에 지켜보는 세션들이 띄운 파일 — 오래된 순. 채팅 뷰에선 이걸 스페이스 위 모달로 띄운다 */
export function newShows(log: string, ids: string[] | null, since: number): { path: string; ts: string; by: string; at?: ShowAt }[] {
  const out: { path: string; ts: string; by: string; at?: ShowAt }[] = [];
  for (const line of log.split('\n')) {
    try {
      const r = JSON.parse(line) as { path?: string; ts?: string; from?: string; at?: unknown };
      if (r.path && (ids === null || (r.from && ids.includes(r.from))) && Date.parse(r.ts ?? '') > since) {
        const at = parseAt(r.at);
        out.push({ path: r.path, ts: r.ts!, by: r.from ?? '', ...(at ? { at } : {}) });
      }
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return out;
}

/** 메뉴에서 보고 있는 참모 — 채팅 탭이 바뀌면 따라가고, 아니면 메뉴에서 고른 걸 유지(메뉴 → 채팅 탭은 안 바꾼다) */
export function followChat(s: { view?: string; chat?: string }, chat: string | undefined): { view?: string; chat?: string } {
  return chat !== s.chat ? { view: chat, chat } : s;
}

/** 참모 대화 기록 꼬리에서 그 참모가 띄웠거나(`claude --bg … -n 이름`) 말을 건(SendMessage) 세션 이름 — 작업 기록(task send) 없이 띄운 세션도
 *  '맡긴 세션'으로 잡으려고(2026-10-01 사용자: 참모가 띄운 프로젝트 세션 셋 중 대시보드엔 하나). 변수($…)·main·뒤 [ref] 는 뺀다 */
export function transcriptTargets(tail: string): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => {
    const v = (n ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    if (v && v !== 'main' && !v.includes('$') && !out.includes(v)) out.push(v);
  };
  for (const line of tail.split('\n')) {
    if (!line.includes('tool_use')) continue;
    let d: { type?: string; message?: { content?: { type?: string; name?: string; input?: { command?: unknown; to?: unknown } }[] } };
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant') continue;
    for (const c of d.message?.content ?? []) {
      if (c.type !== 'tool_use') continue;
      if (c.name === 'SendMessage' && typeof c.input?.to === 'string') add(c.input.to);
      else if (c.name === 'Bash' && typeof c.input?.command === 'string') {
        for (const words of shellCommands(c.input.command)) {
          if (words[0] !== 'claude' || !words.includes('--bg')) continue;
          const i = words.indexOf('-n');
          if (i > 0) add(words[i + 1]);
        }
      }
    }
  }
  return out;
}

/** 셸 명령을 실제로 실행되는 명령들(단어 목록)로 — heredoc 본문은 버리고, 따옴표는 한 단어로 묶고, ; && || | 줄바꿈에서 나눈다.
 *  따옴표·heredoc 안 글자(테스트 예시·grep 검색어·echo)는 실행이 아니라서 안 센다(2026-10-01 오탐) */
export function shellCommands(cmd: string): string[][] {
  const lines = cmd.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    kept.push(line);
    const h = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/.exec(line);
    if (h) { while (i + 1 < lines.length && lines[i + 1]!.trim() !== h[1]) i++; i++; } // 본문과 끝 표시 건너뜀
  }
  const text = kept.join('\n');
  const out: string[][] = [];
  let words: string[] = [];
  let w = '';
  let has = false;
  const endWord = () => { if (has) words.push(w); w = ''; has = false; };
  const endCmd = () => { endWord(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"') {
      const j = text.indexOf(ch, i + 1);
      const end = j < 0 ? text.length : j;
      w += text.slice(i + 1, end); has = true; i = end;
    } else if (ch === '\\' && i + 1 < text.length) { w += text[i + 1]; has = true; i++; }
    else if (ch === ' ' || ch === '\t') endWord();
    else if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') endCmd();
    else { w += ch; has = true; }
  }
  endCmd();
  return out;
}

/** 띄운 문서를 둘 참모 — 참모가 띄웠으면 그 참모, 하위 세션이 띄웠으면 그 세션을 잡은 참모(첫째), 모르면 null(지금 보는 화면).
 *  참모1 이 띄운 문서가 보고 있던 참모2 화면에 뜨고, 참모1 탭엔 없었다(2026-10-01 사용자) */
export function showOwner(by: string, orchIds: string[], holders: Map<string, string[]>): string | null {
  if (!by) return null;
  if (orchIds.includes(by)) return by;
  return holders.get(by)?.find((o) => orchIds.includes(o)) ?? null;
}

/** 하니터 열기·닫기 → 다음 화면. 하니터도 탭마다 기억되는 스페이스 화면 하나('h:')다 — 큐레이션처럼.
 * 앱 전체에 고정이면 다른 탭으로 가도 남아 있고 다른 참모가 띄운 게 가려졌다(2026-10-02 사용자).
 * before = 그 탭에서 열기 전에 보던 화면(닫으면 거기로), home = 그 참모 대시보드 */
export function harnitorPick(pick: string, req: 'open' | 'close' | 'toggle', before: string, home: string): { pick: string; before: string } {
  return screenPick('h:', pick, req, before, home);
}

/** 도구(t:, 프로젝트 도구는 t:<폴더>) — 위 막대 아이콘으로 여닫는다(2026-10-05 사용자). 열면 참모 HQ 기준 't:' */
export function toolsPick(pick: string, req: 'open' | 'close' | 'toggle', before: string, home: string): { pick: string; before: string } {
  return screenPick('t:', pick, req, before, home);
}

/** 리뷰(rv:, PR 하나는 rv:<키>) — 위 막대 아이콘으로 여닫는다(2026-10-06 사용자, 사이드바 줄에서 옮김) */
export function reviewPick(pick: string, req: 'open' | 'close' | 'toggle', before: string, home: string): { pick: string; before: string } {
  return screenPick('rv:', pick, req, before, home);
}

function screenPick(key: string, pick: string, req: 'open' | 'close' | 'toggle', before: string, home: string): { pick: string; before: string } {
  const open = pick.startsWith(key);
  const want = req === 'toggle' ? !open : req === 'open';
  if (want === open) return { pick, before };
  return want ? { pick: key, before: pick } : { pick: before || home, before: '' };
}

/** 채팅 뷰의 focus — 터미널 뷰로 넘어가지 않고 스페이스에 그 대시보드를 띄운다(2026-10-02 사용자 "보여 달라기 전엔 CLI 안 보여 줘도").
 *  세션 → 그 프로젝트 대시보드(참모면 참모 대시보드), 프로젝트 이름 → 그 프로젝트(세션이 안 떠 있어도). 모르면 null */
export function focusPick(
  plan: { session: string } | { project: string },
  sessions: { id: string; cwd: string; project: string }[],
  groups: { name: string; root: string }[],
  idle: { name: string; root: string }[],
  orchIds: string[],
): string | null {
  const rootOf = (name: string) => groups.find((g) => g.name === name)?.root ?? idle.find((g) => g.name === name)?.root;
  if ('session' in plan) {
    if (orchIds.includes(plan.session)) return `o:${plan.session}`;
    const s = sessions.find((x) => x.id === plan.session);
    const r = s && (rootOf(s.project) ?? groups.find((g) => s.cwd === g.root || s.cwd.startsWith(`${g.root}/`))?.root);
    return r ? `p:${r}` : null;
  }
  const r = rootOf(plan.project);
  return r ? `p:${r}` : null;
}
