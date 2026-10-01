// 스페이스(리더를 노션처럼 고치는 공간) — 사용자가 페이지에서 고친 것을 모아 참모에게 보낸다(2026-09-30 사용자: 스페이스 기획 v1·v2).
// 페이지 = 로컬 md 파일, 고친 기록 = space-log.jsonl, 보내기는 문서를 연 때(또는 지난번 보낸 때)와 지금을 비교해 한 번에.

export type MdDiff = { added: string[]; removed: string[] };

const lines = (md: string) => md.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

/** 줄 단위 차이 — 같은 줄은 개수로 짝지어 지우고 남은 것. 순서는 원래 문서 순서 */
/** 비교용 줄 — 공백 개수·목록 기호(- * +) 차이는 같게 본다(편집기가 저장하며 모양을 바꾼다) */
const norm = (l: string) => l.replace(/^(\s*)[-*+](\s)/, '$1-$2').replace(/\s+/g, ' ').trim();

export function mdDiff(before: string, after: string): MdDiff {
  const count = (ls: string[]) => ls.reduce((m, l) => m.set(norm(l), (m.get(norm(l)) ?? 0) + 1), new Map<string, number>());
  const b = lines(before), a = lines(after);
  const left = count(b), right = count(a);
  const take = (ls: string[], other: Map<string, number>) =>
    ls.filter((l) => {
      const n = other.get(norm(l)) ?? 0;
      if (n > 0) { other.set(norm(l), n - 1); return false; }
      return true;
    });
  return { added: take(a, left), removed: take(b, right) };
}

const MAX_LINES = 30;

/** 줄 코멘트 — 편집기에서 커서 있던 줄(quote)에 단 말 */
export type LineComment = { path: string; quote: string; text: string };

const cutQuote = (q: string) => { const t = q.replace(/\s+/g, ' ').trim(); return [...t].length > 40 ? `${[...t].slice(0, 40).join('')}…` : t; };

/** 참모에게 보낼 글 — 문서마다 더한 줄(+)·뺀 줄(-)·줄 코멘트(> 인용 → 코멘트), 끝에 메모. 보낼 게 없으면 빈 글 */
export function composeSend(docs: { path: string; diff: MdDiff }[], memo: string, comments: LineComment[] = []): string {
  const out: string[] = [];
  const paths = [...new Set([...docs.map((d) => d.path), ...comments.map((c) => c.path)])];
  for (const path of paths) {
    const diff = docs.find((d) => d.path === path)?.diff ?? { added: [], removed: [] };
    const rows = [...diff.added.map((l) => `+ ${l}`), ...diff.removed.map((l) => `- ${l}`)];
    const notes = comments.filter((c) => c.path === path && c.text.trim()).map((c) => `  > ${cutQuote(c.quote)} → ${c.text.trim()}`);
    if (!rows.length && !notes.length) continue;
    out.push(`■ ${path.split('/').pop()} (${path})`);
    out.push(...rows.slice(0, MAX_LINES));
    if (rows.length > MAX_LINES) out.push(`… ${rows.length - MAX_LINES}줄 더 — 파일에서 보기`);
    out.push(...notes);
  }
  const m = memo.trim();
  if (!out.length && !m) return '';
  return ['[스페이스] 사용자가 고친 것', ...out, ...(m ? [`메모: ${m}`] : [])].join('\n');
}
