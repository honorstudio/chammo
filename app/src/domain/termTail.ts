// 대화 기록(jsonl) 꼬리 → 터미널에 보이는 모양 몇 줄. 대시보드 세션 칸이 "한 줄 요약"으론 뭘 하는지 못 알아봐서(2026-09-30 사용자).
// 진짜 터미널을 붙이면 세션마다 attach 가 떠서 무겁다 — 기록을 터미널처럼 그린다
import { toolTarget } from './activity';

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown };
/** 터미널 색·커서 코드(ESC[…m 등)와 남은 제어 문자 — 화면에선 네모 X 로 보였다(2026-10-02 사용자) */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])|[\x00-\x08\x0b-\x1f\x7f]/g;
const cut = (raw: string, n = 140) => { const t = raw.replace(ANSI, ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: Block) => (b?.type === 'text' ? b.text ?? '' : '')).join('\n') : '');

/** sidechain = 분신(하위 에이전트) 기록을 읽을 때 — 거기선 모든 줄이 isSidechain 이다 */
export function termTail(jsonl: string, n: number, opt: { sidechain?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const line of jsonl.split('\n')) {
    let r: { type?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.isMeta || (r.isSidechain && !opt.sidechain) || r.isCompactSummary) continue;
    const c = r.message?.content;
    if (r.type === 'user') {
      if (typeof c === 'string') { if (!c.startsWith('<')) out.push(`> ${cut(c.split('\n')[0]!.trim())}`); continue; }
      for (const b of (Array.isArray(c) ? c : []) as Block[]) {
        if (b.type === 'tool_result') { const t = textOf(b.content).replace(ANSI, '').split('\n').find((x) => x.trim()); if (t) out.push(`  ⎿ ${cut(t.trim())}`); }
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
