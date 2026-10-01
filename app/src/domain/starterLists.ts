// 프로젝트 대시보드 위 목록 — 그 프로젝트 docs/starter.md 의 "다음 할 일"·"최근 결정" 칸에서 맨 윗단계 항목만(2026-09-30 사용자)

type Sec = { title: string; body: string[] };

function sections(md: string): Sec[] {
  const out: Sec[] = [];
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) out.push({ title: h[1]!, body: [] });
    else out[out.length - 1]?.body.push(line);
  }
  return out;
}

const clean = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** 맨 윗단계 목록 항목("- ", "1. ")만 — 들여쓴 하위 항목은 뺀다 */
function items(body: string[], max: number): string[] {
  const out: string[] = [];
  for (const l of body) {
    const m = l.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (m) out.push(clean(m[1]!).slice(0, 180));
    if (out.length >= max) break;
  }
  return out;
}

export function starterLists(md: string, max = 8): { todo: string[]; decisions: string[] } {
  const secs = sections(md);
  // 영어 starter 도(Next (top 5)·To-do·Recent decisions) — 한글 제목만 찾아 영어 사용자는 늘 비었다(0.2.0 검증)
  const todo = secs.find((s) => /다음\s*할\s*일|^\W*next\b/i.test(s.title)) ?? secs.find((s) => (/할\s*일|to-?do/i.test(s.title)) && !/매번/.test(s.title));
  const dec = secs.find((s) => /결정|decision/i.test(s.title));
  return { todo: todo ? items(todo.body, max) : [], decisions: dec ? items(dec.body, max) : [] };
}
