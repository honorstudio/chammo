// 대화 기록(jsonl) 꼬리 → 터미널에 보이는 모양 몇 줄. 대시보드 세션 칸이 "한 줄 요약"으론 뭘 하는지 못 알아봐서(2026-09-30 사용자).
// 진짜 터미널을 붙이면 세션마다 attach 가 떠서 무겁다 — 기록을 터미널처럼 그린다
import { toolTarget } from './activity';

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown };
const cut = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n)}…` : t);
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: Block) => (b?.type === 'text' ? b.text ?? '' : '')).join('\n') : '');

export function termTail(jsonl: string, n: number): string[] {
  const out: string[] = [];
  for (const line of jsonl.split('\n')) {
    let r: { type?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.isMeta || r.isSidechain || r.isCompactSummary) continue;
    const c = r.message?.content;
    if (r.type === 'user') {
      if (typeof c === 'string') { if (!c.startsWith('<')) out.push(`> ${cut(c.split('\n')[0]!.trim())}`); continue; }
      for (const b of (Array.isArray(c) ? c : []) as Block[]) {
        if (b.type === 'tool_result') { const t = textOf(b.content).split('\n').find((x) => x.trim()); if (t) out.push(`  ⎿ ${cut(t.trim())}`); }
        else if (b.type === 'text' && b.text && !b.text.startsWith('<')) out.push(`> ${cut(b.text.split('\n')[0]!.trim())}`);
      }
    } else if (r.type === 'assistant') {
      for (const b of (Array.isArray(c) ? c : []) as Block[]) {
        if (b.type === 'text' && b.text?.trim()) {
          const ls = b.text.trim().split('\n').filter((x) => x.trim()).slice(0, 3);
          ls.forEach((x, i) => out.push(`${i ? '  ' : '⏺ '}${cut(x.trim())}`));
        } else if (b.type === 'tool_use' && b.name) {
          const d = typeof b.input?.description === 'string' ? b.input.description : toolTarget(b.input);
          out.push(`⏺ ${b.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')}(${cut(d, 90)})`);
        }
      }
    }
  }
  return out.slice(-n);
}
