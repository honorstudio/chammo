// 참모가 Agent 도구로 띄운 분신(하위 에이전트) — 별도 세션이 아니라 `claude agents --json` 에 안 나온다.
// 참모 대화 기록에서 Agent 호출·띄운 결과·<task-notification> 을 모아 대시보드 제목 아래에 보여 준다(2026-10-02 사용자)
import { tr } from '../i18n';
import { termTail } from './termTail';

export type SubAgent = {
  /** Agent 호출 tool_use id */
  id: string;
  /** description(없으면 종류) */
  name: string;
  kind?: string;
  /** 이번에 일하기 시작한 때 — 다시 말 걸면 그때로 */
  since: string;
  end?: string;
  status: 'run' | 'done' | 'failed' | 'killed';
  /** subagents/agent-<agentId>.jsonl 의 그 id */
  agentId?: string;
  /** 끝난 결과 첫 줄 */
  result?: string;
};

type Block = { type?: string; id?: string; name?: string; text?: string; tool_use_id?: string; is_error?: boolean; content?: unknown; input?: Record<string, unknown> };
type Row = { type?: string; timestamp?: string; toolUseResult?: unknown; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown } };

const DAY = 24 * 3600_000;
const firstLine = (t: string) => (t.split('\n').map((x) => x.trim()).find(Boolean) ?? '').slice(0, 200);
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? (c as Block[]).map((b) => (b?.type === 'text' ? b.text ?? '' : '')).join('\n') : '');
const tag = (s: string, t: string) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim();
const ended: Record<string, SubAgent['status']> = { completed: 'done', failed: 'failed', killed: 'killed', stopped: 'killed' };

/** 기록 줄(scan_spawn_lines 가 고른 것)을 앞의 목록에 접어 넣는다 — 이어 읽을 때마다 늘어난 줄만 넘긴다 */
export function foldAgents(lines: string, prev: SubAgent[]): SubAgent[] {
  const list = prev.map((a) => ({ ...a }));
  const byId = new Map(list.map((a) => [a.id, a]));
  const finish = (a: SubAgent, status: SubAgent['status'], ts?: string, result?: string) => {
    a.status = status;
    if (ts) a.end = ts;
    if (result) a.result = firstLine(result);
  };
  for (const line of lines.split('\n')) {
    let r: Row;
    try { r = JSON.parse(line); } catch { continue; }
    const c = r.message?.content;
    if (r.type === 'assistant') {
      for (const b of (Array.isArray(c) ? c : []) as Block[]) {
        if (b.type !== 'tool_use' || !b.id) continue;
        if (b.name === 'Agent' && !byId.has(b.id)) {
          const kind = typeof b.input?.subagent_type === 'string' ? b.input.subagent_type : undefined;
          const desc = typeof b.input?.description === 'string' ? b.input.description.trim() : '';
          const a: SubAgent = { id: b.id, name: desc || kind || 'Agent', ...(kind ? { kind } : {}), since: r.timestamp ?? '', status: 'run' };
          list.push(a);
          byId.set(a.id, a);
        } else if (b.name === 'SendMessage' && typeof b.input?.to === 'string') {
          const a = list.find((x) => x.agentId === b.input!.to);
          if (a && a.status !== 'run') { a.status = 'run'; a.since = r.timestamp ?? a.since; delete a.end; delete a.result; }
        }
      }
    } else if (r.type === 'user' || (r.type === 'attachment' && r.attachment?.type === 'queued_command')) {
      // 끝 알림은 사람 말 자리(글)로만 온다 — 도구 결과 안에 섞인 글자(grep 출력)는 아니다.
      // 참모가 일하는 도중에 끝나면 끼워 넣은 명령(attachment queued_command)으로 온다(실제 참모 기록에서 8개 확인)
      const q = r.attachment?.prompt;
      const said = typeof q === 'string' ? q : typeof c === 'string' ? c : Array.isArray(c) ? (c as Block[]).filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n') : '';
      for (const n of said.split('<task-notification>').slice(1)) {
        const a = byId.get(tag(n, 'tool-use-id') ?? '') ?? list.find((x) => x.agentId && x.agentId === tag(n, 'task-id'));
        const st = ended[tag(n, 'status') ?? ''];
        if (a && st) finish(a, st, r.timestamp, tag(n, 'result'));
      }
      for (const b of (Array.isArray(c) ? c : []) as Block[]) {
        const a = b?.type === 'tool_result' ? byId.get(b.tool_use_id ?? '') : undefined;
        if (!a) continue;
        const t = (r.toolUseResult ?? {}) as { status?: string; agentId?: string };
        if (typeof t.agentId === 'string') a.agentId = t.agentId;
        if (b.is_error) finish(a, 'failed', r.timestamp);
        else if (t.status !== 'async_launched' && a.status === 'run') finish(a, 'done', r.timestamp, textOf(b.content)); // 동기 호출 — 결과가 곧 끝
      }
    }
  }
  return list;
}

const last = (a: SubAgent) => Date.parse(a.end ?? a.since) || 0;
const sinceMs = (a: SubAgent) => Date.parse(a.since) || 0;

/** 하루 넘은 건 버린다(저장할 때도) */
export function pruneAgents(list: SubAgent[], now: number): SubAgent[] {
  return list.filter((a) => now - last(a) <= DAY).slice(-80);
}

/** 일하는 중(최근 시작 먼저) · 끝난 지 1시간 안(최근 끝 먼저) · 그보다 오래된 것(접기) */
export function agentRows(list: SubAgent[], now: number): { running: SubAgent[]; recent: SubAgent[]; folded: SubAgent[] } {
  const live = pruneAgents(list, now);
  const done = live.filter((a) => a.status !== 'run').sort((a, b) => last(b) - last(a));
  return {
    running: live.filter((a) => a.status === 'run').sort((a, b) => sinceMs(b) - sinceMs(a)),
    recent: done.filter((a) => now - last(a) <= 3600_000),
    folded: done.filter((a) => now - last(a) > 3600_000),
  };
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const QUIET = 30 * 60_000;

/** 일하는 중 N분 / 끝 hh:mm / 실패 hh:mm / 멈춤 hh:mm. 분신 기록이 30분 넘게 그대로면 조용함(lastMs = 기록 파일 고친 때) */
export function agentWord(a: SubAgent, now: number, lastMs?: number): string {
  if (a.status === 'run') {
    if (lastMs && now - lastMs > QUIET) return tr(`조용함 · 마지막 ${hhmm(lastMs)}`, `Quiet · last ${hhmm(lastMs)}`);
    const m = Math.floor((now - sinceMs(a)) / 60_000);
    return m < 1 ? tr('일하는 중 방금', 'Working · just now') : tr(`일하는 중 ${m}분`, `Working ${m}m`);
  }
  const t = hhmm(last(a));
  return a.status === 'done' ? tr(`끝 ${t}`, `Done ${t}`) : a.status === 'failed' ? tr(`실패 ${t}`, `Failed ${t}`) : tr(`멈춤 ${t}`, `Stopped ${t}`);
}

/** 분신 기록 꼬리 → 지금 하는 일 한 줄(마지막 도구 호출, 없으면 마지막 말) */
export function nowDoing(tail: string): string {
  const lines = termTail(tail, 40, { sidechain: true }).filter((l) => l.startsWith('⏺ ')).map((l) => l.slice(2));
  return [...lines].reverse().find((l) => /^[\w.-]+\(/.test(l)) ?? lines[lines.length - 1] ?? '';
}

/** 끝 알림 뒤에 분신 기록이 또 쓰였으면 다시 일하는 중(그 끝부터) — 백그라운드 일을 걸어 두고 멈췄다가 스스로 깨어난 분신.
 *  끝 알림은 '멈출 때마다' 온다(실제 시험: sleep 을 뒤로 돌리고 중간 보고 → 끝으로 남았다). 다시 끝나면 새 알림이 끝 시각을 바꾼다 */
export function revive(a: SubAgent, mtime: number | undefined): SubAgent {
  const end = Date.parse(a.end ?? '');
  if (a.status === 'run' || !mtime || !end || mtime <= end + 5000) return a;
  return { id: a.id, name: a.name, ...(a.kind ? { kind: a.kind } : {}), since: a.end!, status: 'run', ...(a.agentId ? { agentId: a.agentId } : {}) };
}
