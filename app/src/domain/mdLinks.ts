// md 링크·그림 주소의 띄어쓰기 — 편집기(BlockNote)는 `[다른 문서](다른 문서.md)` 를 첫 낱말에서 잘라 `다른` 으로 읽고(괄호까지 들면
// 링크째 사라진다), 꺾쇠 `<다른 문서.md>` 는 온전히 읽지만 쓸 때 꺾쇠를 벗겨 다시 띄어쓰기로 내보낸다(2026-10-04 실측).
// 참모·세션이 손으로 쓴 md 를 한 글자만 고쳐도 주소가 잘려 저장됐다 → 읽기 전·쓴 뒤에 표준 꺾쇠로(%20 보다 원래 글 그대로 읽힌다)

/** 툴팁이 붙은 주소(`a.md "툴팁"`) — 띄어쓰기가 있어도 주소가 아니다 */
const TITLED = /^\S+\s+("[^"]*"|'[^']*'|\([^()]*\))$/;

/** 줄 안 코드(백틱) 구간 */
export function codeRanges(line: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i++; continue; }
    let n = 0;
    while (line[i + n] === '`') n++;
    const close = line.indexOf('`'.repeat(n), i + n);
    if (close < 0) { i += n; continue; }
    out.push([i, close + n]);
    i = close + n;
  }
  return out;
}

/** 모든 인라인 링크·그림의 `](주소)` 주소를 fn 으로 바꾼다(null = 그대로). 코드 블록·코드 구간 안, 줄을 넘는 것은 안 건드린다 */
function mapDests(md: string, fn: (dest: string) => string | null): string {
  let fence: string | null = null;
  return md.split('\n').map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1]![0]!;
      else if (m[1]![0] === fence) fence = null;
      return line;
    }
    if (fence || !line.includes('](')) return line;
    const code = codeRanges(line);
    let out = '';
    let from = 0;
    for (let i = line.indexOf(']('); i >= 0; i = line.indexOf('](', i + 1)) {
      if (i < from || code.some(([s, e]) => i >= s && i < e)) continue;
      const start = i + 2;
      if (line[start] === '<') continue;
      let j = start, depth = 0;
      for (; j < line.length; j++) {
        const c = line[j];
        if (c === '\\') { j++; continue; }
        if (c === '(') depth++;
        else if (c === ')') { if (depth === 0) break; depth--; }
      }
      if (j >= line.length) continue; // 닫는 괄호 없음
      const next = fn(line.slice(start, j));
      if (next === null) continue;
      out += line.slice(from, start) + next;
      from = j;
      i = j;
    }
    return out + line.slice(from);
  }).join('\n');
}

/** 꺾쇠로 감쌀 주소면 감싼 모양, 아니면 null */
function angle(dest: string): string | null {
  const t = dest.trim();
  if (!/\s/.test(t) || TITLED.test(t) || /[<>]/.test(t)) return null;
  return `<${t}>`;
}

/** 편집기가 읽기 전에 — 띄어쓰기 든 주소를 꺾쇠로(온전히 읽게) */
export const readableLinks = (md: string) => mapDests(md, angle);

const balanced = (s: string) => {
  let d = 0;
  for (const c of s) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; }
  return d === 0;
};

/** 편집기가 쓴 뒤에 — 띄어쓰기 든 주소는 꺾쇠로(괄호 탈출은 꺾쇠 안에선 푼다), 띄어쓰기 없이 짝 맞는 괄호는 탈출을 풀어 원래 모양으로 */
export const writeLinks = (md: string) => mapDests(md, (dest) => {
  const plain = dest.replace(/\\([()])/g, '$1');
  const wrapped = angle(plain);
  if (wrapped) return wrapped;
  return plain !== dest && !/\s/.test(plain) && balanced(plain) ? plain : null;
});

/** 주소 풀기(%20 → 띄어쓰기) — 이름에 진짜 % 가 든 파일(`100% 계획.md`)은 decodeURI 가 예외를 던져 그대로 둔다 */
export function safeDecode(s: string): string {
  try { return decodeURI(s); } catch { return s; }
}
