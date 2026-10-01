// 짚어 보여 주기 — scripts/show --line/--find/--page/--box 로 파일의 한 곳을 가리키면 앱이 그리로 스크롤하고 반짝인다
// (2026-09-30 사용자 "그 부분을 잠깐 반짝이게, 스크롤도, PDF·PPT 면 페이지도")

export type ShowAt = { line?: number; lineEnd?: number; find?: string; page?: number; box?: [number, number, number, number] };

const posInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/** show.jsonl 한 줄의 at — 맞는 값만. 남는 게 없으면 undefined */
export function parseAt(raw: unknown): ShowAt | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const at: ShowAt = {};
  if (posInt(r.line)) at.line = r.line as number;
  if (posInt(r.lineEnd)) at.lineEnd = r.lineEnd as number;
  if (typeof r.find === 'string' && r.find.trim()) at.find = r.find.trim();
  if (posInt(r.page)) at.page = r.page as number;
  if (Array.isArray(r.box) && r.box.length === 4 && r.box.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) at.box = r.box as ShowAt['box'];
  return Object.keys(at).length ? at : undefined;
}

/** 마크다운 한 줄에서 화면에 보이는 글 — 칸이 있으면 칸들 */
function cells(line: string): string[] {
  let t = line.trim();
  if (/^\|?\s*:?-{2,}/.test(t) || /^([-*_])\1{2,}$/.test(t)) return []; // 표 구분선·가로줄
  t = t.replace(/^>+\s*/, '').replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '');
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)/g, '').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2');
  const parts = t.includes('|') ? t.replace(/^\||\|$/g, '').split('|') : [t];
  return parts.map((c) => c.trim()).filter(Boolean);
}

const count = (hay: string, needle: string) => { let n = 0; for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++; return n; };

/** 원본 줄 번호(1부터) → 그려진 화면에서 찾을 글과 그 글이 몇 번째 나오는지. 빈 줄이면 아래로 내려가 첫 글 있는 줄 */
export function lineNeedle(src: string, line: number, raw = false): { needle: string; nth: number } | null {
  const lines = src.split('\n');
  const cellsOf = (l: string) => (raw ? (l.trim() ? [l.trim()] : []) : cells(l)); // raw = 글 파일(그대로 보인다)
  for (let i = Math.max(0, line - 1); i < lines.length; i++) {
    const cs = cellsOf(lines[i]!);
    if (!cs.length) continue;
    const needle = cs.reduce((a, b) => (b.length > a.length ? b : a));
    const before = lines.slice(0, i).map((l) => cellsOf(l).join(' ')).join('\n');
    return { needle, nth: count(before, needle) + count(cs.slice(0, cs.indexOf(needle)).join(' '), needle) };
  }
  return null;
}
