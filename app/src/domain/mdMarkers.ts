// 목록 기호·구분선 — 편집기(BlockNote 0.51.4)는 저장할 때 목록 기호를 모두 `*`, 구분선을 `***` 로 쓴다.
// `-` 로 쓴 문서(참모·세션이 쓴 거의 모든 md)는 한 글자만 고쳐도 목록 줄이 통째로 바뀌었다(2026-10-04 실측) → 원래 파일 모양으로

const FENCE = /^\s*(`{3,}|~{3,})/;
/** 목록 줄 — 앞(인용 > 포함) · 기호 · 나머지 */
const ITEM = /^((?:\s*>)*\s*)([-*+])( +)(.*)$/;
const HR = /^ {0,3}([-*_])(?: *\1){2,} *$/;
/** 번호 목록 줄 — 앞 · 번호 · 기호(. )) · 띄어쓰기 · 나머지 */
const ORD = /^((?:\s*>)*\s*)(\d{1,9})([.)])( +)(.*)$/;

function prose(lines: string[], f: (l: string, i: number) => void) {
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const m = FENCE.exec(l);
    if (m) {
      if (!fence) fence = m[1]![0]!;
      else if (m[1]![0] === fence) fence = null;
      return;
    }
    if (!fence) f(l, i);
  });
}

const most = (count: Map<string, number>) => [...count].sort((a, b) => b[1] - a[1])[0]?.[0];

/** next(편집기가 쓴 글)의 목록 기호·구분선을 original(원래 파일)이 쓰던 모양으로 — 같은 줄이 있으면 그 줄 기호, 새 줄은 문서에서 많이 쓴 기호 */
export function keepMarkers(original: string, next: string): string {
  const o = original.split('\n');
  const byLine = new Map<string, string>();
  const marks = new Map<string, number>();
  const hrs = new Map<string, number>();
  prose(o, (l, i) => {
    const prev = o[i - 1];
    if (HR.test(l)) {
      // 바로 위가 글이면 `---` 는 제목 밑줄(setext)이다
      if (prev === undefined || !prev.trim() || HR.test(prev)) hrs.set(l.trim(), (hrs.get(l.trim()) ?? 0) + 1);
      return;
    }
    if (ORD.test(l)) return;
    const m = ITEM.exec(l);
    if (!m) return;
    byLine.set(`${m[1]}\u0001${m[4]}`, m[2]!);
    marks.set(m[2]!, (marks.get(m[2]!) ?? 0) + 1);
  });
  const mark = most(marks);
  const hr = most(hrs);
  if (!mark && !hr) return next;
  const n = next.split('\n');
  prose(n, (l, i) => {
    if (hr && l === '***' && !(n[i - 1] ?? '').trim()) { n[i] = hr; return; }
    const m = ITEM.exec(l);
    if (!m || m[2] !== '*' || !mark) return;
    const want = byLine.get(`${m[1]}\u0001${m[4]}`) ?? mark;
    if (want !== '*') n[i] = `${m[1]}${want}${m[3]}${m[4]}`;
  });
  return n.join('\n');
}

/** 번호 목록 번호 — 편집기는 0. 으로 시작한 목록도 1. 부터 다시 매기고, 고친 항목 하나만 쓰면 늘 1. 이다.
 *  원래 같은 줄이면 원래 번호(같은 글이 여러 목록에 있으면 지금 번호가 그중 하나면 그대로), 아니면 앞 항목 + 1, 첫 항목이면 다음 항목 - 1.
 *  before·after = 앞뒤 조각의 맞닿은 줄(고친 블록만 쓸 때 이웃 번호를 보려고) — 그 줄은 안 바꾼다.
 *  starts = 이 글 안 최상위 목록 첫 항목들의 편집기 시작 번호(start, 없으면 1) — 첫 항목을 지우거나 맨 위에 넣어도 목록이 2.·0. 부터 시작하지 않게 */
export function keepNumbers(original: string, md: string, before = '', after = '', starts: number[] = []): string {
  const queue = [...starts];
  const nums = new Map<string, Set<number>>();
  prose(original.split('\n'), (l) => {
    const d = ORD.exec(l);
    if (!d) return;
    const k = `${d[1]}\u0001${d[5]}`;
    if (!nums.has(k)) nums.set(k, new Set());
    nums.get(k)!.add(Number(d[2]));
  });
  if (!nums.size) return md;
  const lines = [before, ...md.split('\n'), after];
  const known = (d: RegExpExecArray) => {
    const set = nums.get(`${d[1]}\u0001${d[5]}`);
    return set ? (set.has(Number(d[2])) ? Number(d[2]) : [...set][0]!) : undefined;
  };
  let prev: { pre: string; num: number } | null = null;
  prose(lines, (l, i) => {
    const d = ORD.exec(l);
    if (!d) { if (l.trim() && !/^\s/.test(l)) prev = null; return; }
    const inside = i > 0 && i < lines.length - 1;
    const first = inside && d[1] === '' && !(prev && prev.pre === '') && queue.length > 0;
    let want = first ? queue.shift()! : known(d);
    if (want === undefined) {
      const nx = ORD.exec(lines[i + 1] ?? '');
      const k = nx && nx[1] === d[1] ? known(nx) : undefined;
      want = prev && prev.pre === d[1] ? prev.num + 1 : k !== undefined && k > 0 ? k - 1 : Number(d[2]);
    }
    if (inside) lines[i] = `${d[1]}${want}${d[3]}${d[4]}${d[5]}`;
    prev = { pre: d[1]!, num: inside ? want : Number(d[2]) };
  });
  return lines.slice(1, -1).join('\n');
}
