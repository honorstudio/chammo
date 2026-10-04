// 고친 블록 안에서 BlockNote 가 망가뜨리는 글 모양 — 안 고친 블록은 원래 글 그대로 남고(mdChunks), 이건 고친 블록을 쓸 때만(2026-10-04 실측).
// 편집기(tiptap)의 코드 꾸밈은 다른 꾸밈과 같이 못 있어서 링크·굵게·기울임 안의 코드가 그 꾸밈을 밀어낸다
import { codeRanges } from './mdLinks';

const FENCE = /^\s*(`{3,}|~{3,})/;

/** 코드 펜스 밖 줄마다 f — 닫는 펜스는 같은 기호·같거나 긴 길이·뒤에 글 없음(긴 펜스 안 짧은 펜스는 글이다) */
function prose(md: string, f: (line: string, i: number, lines: string[]) => string, onFence?: (line: string, i: number, opening: boolean) => string): string {
  let fence: { ch: string; len: number } | null = null;
  const lines = md.split('\n');
  return lines.map((l, i) => {
    const m = FENCE.exec(l);
    if (m && !fence) { fence = { ch: m[1]![0]!, len: m[1]!.length }; return onFence ? onFence(l, i, true) : l; }
    if (m && fence && m[1]![0] === fence.ch && m[1]!.length >= fence.len && !l.slice(m[0].length).trim()) { fence = null; return l; }
    return fence ? l : f(l, i, lines);
  }).join('\n');
}

const count = (s: string, d: string) => s.split(d).length - 1;
const inCode = (line: string, at: number) => codeRanges(line).some(([s, e]) => at >= s && at < e);
const CODE_LINK = /(!?)\[([^\[\]\n]*`[^\[\]\n]*)\]\(([^)\n]*)\)/g;
const PLAIN_LINK = /(!?)\[([^\[\]\n`]*)\]\(([^)\n]*)\)/g;
const destKey = (d: string) => d.trim().replace(/^<(.*)>$/, '$1');

/** 읽기 전에 — 글자가 코드인 링크(`[`a.md`](a.md)`)는 편집기에서 링크가 통째로 사라진다. 링크 글자의 백틱을 빼서 링크를 살린다(그림은 그대로) */
export const codeLinkText = (md: string) => prose(md, (line) => line.replace(CODE_LINK, (all, bang: string, text: string, dest: string, at: number) =>
  (bang || inCode(line, at) ? all : `[${text.replace(/`/g, '')}](${dest})`)));

/** 쓴 뒤에 — 원래 글(base)에 코드 글자로 있던 링크면 그 글자로 되돌린다(같은 글자·같은 주소일 때만) */
export function keepCodeLinks(base: string, md: string): string {
  const orig = new Map<string, string>();
  prose(base, (line) => {
    for (const m of line.matchAll(CODE_LINK)) if (!m[1] && !inCode(line, m.index!)) orig.set(`${m[2]!.replace(/`/g, '')}\u0001${destKey(m[3]!)}`, m[2]!);
    return line;
  });
  if (!orig.size) return md;
  return prose(md, (line) => line.replace(PLAIN_LINK, (all, bang: string, text: string, dest: string, at: number) => {
    const o = bang || inCode(line, at) ? undefined : orig.get(`${text}\u0001${destKey(dest)}`);
    return o ? `[${o}](${dest})` : all;
  }));
}

/** 굵게·기울임·취소선 안의 코드 — 편집기는 `**a `b` c**` 를 `**a** `b`** c**` 로 쓴다(`** c**` 는 굵게가 아니라 다시 읽으면 별표가 글자로 남고
 *  저장할 때마다 번졌다). 코드 하나만 사이에 두고 닫고 바로 여는 같은 꾸밈을 하나로 합친다 */
export const mergeAroundCode = (md: string) => prose(md, (line) => {
  let out = line
    // 닫는 기호는 글자 바로 뒤에만 온다(줄 앞 목록 기호 * 를 기울임으로 보지 않게)
    .replace(/(?<=[^\s\\])\*\*(\s*)(`[^`\n]+`)\*\*/g, '$1$2')
    .replace(/(?<=[^\s\\])~~(\s*)(`[^`\n]+`)~~/g, '$1$2')
    .replace(/(?<=[^\s\\*])\*(\s*)(`[^`\n]+`)\*(?!\*)/g, '$1$2');
  // 코드로 시작하는 꾸밈 — `**`A` 이 B**` 를 `` `A`** 이 B** `` 로 쓴다(여는 ** 뒤 띄어쓰기). 앞에 열린 같은 꾸밈이 없으면(짝수) 여는 것이라 코드 앞으로
  for (const d of ['**', '~~']) {
    const re = new RegExp(`(\`[^\`\\n]+\`)${d.replace(/\*/g, '\\*')}(\\s+)`, 'g');
    out = out.replace(re, (all, code: string, sp: string, at: number) => (count(out.slice(0, at), d) % 2 === 0 ? `${d}${code}${sp}` : all));
  }
  return out;
});

/** 줄을 넘던 굵게·취소선 — 편집기는 `**A\nB**` 를 줄마다 끊어 `**A**` / `**B**` 로 쓴다. 원래 글에서 그 줄들이 꾸밈을 열고 넘기던 줄이면 되돌린다 */
export function keepSpanBreaks(base: string, md: string): string {
  const opens = new Set<string>();
  const closes = new Set<string>();
  for (const d of ['**', '~~']) {
    prose(base, (line, i, lines) => {
      const next = lines[i + 1];
      if (next !== undefined && count(line, d) % 2 === 1 && count(next, d) % 2 === 1) { opens.add(d + line.trim()); closes.add(d + next.trim()); }
      return line;
    });
  }
  if (!opens.size) return md;
  const lines = md.split('\n');
  prose(md, (line, i) => {
    const next = lines[i + 1];
    if (next === undefined) return line;
    for (const d of ['**', '~~']) {
      // 다음 줄은 들여 써 있을 수 있다(이어진 줄 들여쓰기를 되살린 뒤)
      const ind = /^[ \t]*/.exec(next)![0];
      if (!line.endsWith(d) || !next.slice(ind.length).startsWith(d)) continue;
      const a = line.slice(0, -d.length), b = ind + next.slice(ind.length + d.length);
      if (opens.has(d + a.trim()) || closes.has(d + b.trim())) { lines[i] = a; lines[i + 1] = b; }
      break;
    }
    return line;
  });
  return lines.join('\n');
}

/** 언어 없는 코드 펜스 — 편집기는 ``` 를 ```text 로 쓴다. 원래 문서에 ```text 가 없으면 여는 펜스만 되돌린다(코드 안 글은 그대로) */
export function keepFences(base: string, md: string): string {
  const TEXT = /^(\s*)(`{3,}|~{3,})text\s*$/;
  if (base.split('\n').some((l) => TEXT.test(l))) return md;
  return prose(md, (l) => l, (l, _i, opening) => (opening ? l.replace(TEXT, '$1$2') : l));
}
