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

/** 취소선 안 굵게·기울임 — 편집기는 꾸밈을 굵게 → 기울임 → 취소선 순으로 감싸서 `~~a **b** c~~` 를 `~~a ~~**~~b~~**~~ c~~` 로 쓴다
 *  (`~~a ~~` 는 닫는 기호 앞 띄어쓰기라 취소선이 아니어서 다시 읽으면 물결이 글자로 남았다). 끊었다 다시 연 취소선을 하나로 합친다 —
 *  `~~x~~**~~y~~**` 처럼 원래 따로였어도 보이는 꾸밈은 같다 */
export const mergeInStrike = (md: string) => prose(md, (line) => {
  const sub = (s: string, re: RegExp, f: (m: string[], before: string) => string | null) =>
    s.replace(re, (...a) => {
      const at = a[a.length - 2] as number;
      if (inCode(s, at)) return a[0] as string;
      return f(a as string[], s.slice(0, at)) ?? (a[0] as string);
    });
  let out = sub(line, /~~(\*{1,3})~~([^~\n]+?)~~\1~~/g, (m) => `${m[1]}${m[2]}${m[1]}`); // 가운데 — 앞뒤 취소선이 이어진다
  // 굵게로 시작하는 취소선(앞에 열린 취소선이 없을 때) · 굵게로 끝나는 취소선(앞 ~~ 가 닫는 것일 때)
  out = sub(out, /(?<!\*)(\*{1,3})~~([^~\n]+?)~~\1~~/g, (m, before) => (count(before, '~~') % 2 === 0 ? `~~${m[1]}${m[2]}${m[1]}` : null));
  return sub(out, /~~(\*{1,3})~~([^~\n]+?)~~\1(?![*~])/g, (m, before) => (count(before, '~~') % 2 === 1 ? `${m[1]}${m[2]}${m[1]}~~` : null));
});

/** 꾸밈 이름 — 굵게(b)·기울임(i)·취소선(s). 편집기는 바깥부터 굵게 → 기울임 → 취소선 순으로 감싼다 */
type Mark = 'b' | 'i' | 's';
const OPENS: [string, Mark[]][] = [['***~~', ['b', 'i', 's']], ['**~~', ['b', 's']], ['*~~', ['i', 's']], ['***', ['b', 'i']], ['**', ['b']], ['*', ['i']], ['~~', ['s']]];
const openOf = (m: Set<Mark>) => (m.has('b') && m.has('i') ? '***' : m.has('b') ? '**' : m.has('i') ? '*' : '') + (m.has('s') ? '~~' : '');
const closeOf = (m: Set<Mark>) => [...openOf(m)].reverse().join('');
const LINE_HEAD = /^(\s*(?:(?:[*+-]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)*)/;
type Tok = { text: string; marks?: Set<Mark> };

/** 줄을 글 조각으로 — 편집기가 조각마다 감싼 꾸밈(`*a*`, `***b***`, `**~~b~~**`)은 꾸밈 조각, 나머지·코드는 글. 여는 기호는 긴 것부터 */
function runs(s: string): Tok[] {
  const out: Tok[] = [];
  const plain = (c: string) => { const l = out[out.length - 1]; if (l && !l.marks) l.text += c; else out.push({ text: c }); };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') { plain(s.slice(i, i + 2)); i += 2; continue; }
    if (s[i] === '`') {
      const tick = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(tick, i + tick.length);
      const j = end < 0 ? i + tick.length : end + tick.length;
      plain(s.slice(i, j)); i = j; continue;
    }
    let hit: Tok | null = null;
    for (const [o, m] of OPENS) {
      if (!s.startsWith(o, i)) continue;
      const c = [...o].reverse().join('');
      const body = /^(?:\\.|[^*~`\n\\])+/.exec(s.slice(i + o.length))?.[0];
      if (body && body.trim() && s.startsWith(c, i + o.length + body.length)) { hit = { text: body, marks: new Set(m) }; break; }
    }
    if (hit) { out.push(hit); i += openOf(hit.marks!).length * 2 + hit.text.length; } else { plain(s[i]!); i += 1; }
  }
  return out;
}

const sub = (a: Set<Mark>, b: Set<Mark>) => [...a].every((x) => b.has(x));
const wrap = (m: Set<Mark>, text: string) => {
  if (!m.size) return text;
  const [, lead, core, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return `${lead}${openOf(m)}${core}${closeOf(m)}${tail}`;
};

/** 꾸밈 안 꾸밈 — 편집기는 글 조각마다 꾸밈을 따로 감싸서 `*a **b** c*` 를 `*a* ***b**** c*`, `**a *b* c**` 를 `**a** ***b***** c**`,
 *  `*a ~~b~~ c*` 를 `*a* *~~b~~** c*` 로 쓴다(진짜 BlockNote 0.51 실측, md-harness). `* c*` 는 여는 기호 뒤 띄어쓰기라 꾸밈이 아니어서
 *  다시 읽으면 별표가 글자로 남았다. 띄어쓰기만 사이에 둔 꾸밈 조각들이 한쪽이 다른 쪽을 품으면(겹치는 꾸밈이 남으면) 바깥 꾸밈 하나로 합친다 —
 *  `*a* ***b***` 처럼 원래 따로였어도 보이는 꾸밈은 같다. 둘 다 같은 꾸밈뿐(`*a* *b*`)이면 안 건드린다 */
export const mergeSplitMarks = (md: string) => prose(md, (line) => {
  const head = LINE_HEAD.exec(line)![0];
  const toks = runs(line.slice(head.length));
  return toks.some((t) => t.marks && t.marks.size > 1) ? head + emit(toks) : line;
});

/** 조각들을 다시 쓴다 — 띄어쓰기만 사이에 둔 꾸밈 조각들이 같은 꾸밈(common)을 품는 동안 묶고, 묶음 안에 그보다 많은 꾸밈이 있으면
 *  바깥 꾸밈 하나로 감싼 뒤 안쪽(남는 꾸밈)도 같은 규칙으로(`*a **b ~~c~~ d** e*`) */
function emit(toks: Tok[]): string {
  let out = '';
  for (let i = 0; i < toks.length;) {
    const t = toks[i]!;
    if (!t.marks?.size) { out += t.text; i++; continue; }
    let common = new Set(t.marks);
    let j = i;
    while (true) {
      const gap = toks[j + 1], nx = gap && !gap.marks && /^ +$/.test(gap.text) ? toks[j + 2] : gap;
      if (!nx?.marks?.size || !(sub(common, nx.marks) || sub(nx.marks, common))) break;
      common = new Set([...common].filter((x) => nx.marks!.has(x)));
      j = nx === gap ? j + 1 : j + 2;
    }
    const group = toks.slice(i, j + 1);
    if (j === i || !group.some((g) => g.marks && g.marks.size > common.size)) { out += wrap(t.marks, t.text); i++; continue; }
    out += wrap(common, emit(group.map((g) => (g.marks ? { text: g.text, marks: new Set([...g.marks].filter((x) => !common.has(x))) } : g))));
    i = j + 1;
  }
  return out;
}

/** 링크 글자 안 꾸밈 — 편집기는 `[링크 **굵게**](a.md)` 를 `[링크 ](a.md)**[굵게](a.md)**` 로 써서 링크가 조각으로 갈라졌다(BlockNote 0.51 실측).
 *  같은 주소로 바로 이어 붙은 링크 조각(조각마다 꾸밈으로 감쌌을 수 있다)을 링크 하나로 합치고 꾸밈은 글자 안으로 */
export const mergeSplitLinks = (md: string) => prose(md, (line) => {
  const piece = /(?<!!)(\*\*\*|\*\*|\*|~~)?\[([^\[\]\n]*)\]\(([^()\s]+)\)\1?/y;
  let out = '';
  for (let i = 0; i < line.length;) {
    if (line[i] === '`' && !inCode(line, i - 1)) {
      const j = line.indexOf('`', i + 1);
      if (j > i) { out += line.slice(i, j + 1); i = j + 1; continue; }
    }
    const parts: { w: string; text: string; dest: string; end: number }[] = [];
    let at = i;
    while (true) {
      piece.lastIndex = at;
      const m = piece.exec(line);
      if (!m || inCode(line, at)) break;
      const w = m[1] && line.slice(at + m[0].length - m[1].length, at + m[0].length) === m[1] ? m[1] : '';
      if (m[1] && !w) break; // 여는 꾸밈만 있고 닫는 게 없다 — 조각이 아니다
      if (parts.length && parts[0]!.dest !== m[3]) break;
      parts.push({ w, text: m[2]!, dest: m[3]!, end: at + m[0].length });
      at += m[0].length;
    }
    if (parts.length >= 2) {
      out += `[${parts.map((p) => (p.w ? `${p.w}${p.text}${p.w}` : p.text)).join('')}](${parts[0]!.dest})`;
      i = parts.at(-1)!.end;
    } else {
      out += line[i];
      i += 1;
    }
  }
  return out;
});

/** 링크·그림 툴팁 — 편집기는 `[a](a.md "툴팁")` 의 툴팁을 버린다(BlockNote 0.51 실측). 원래 글(base)에 같은 글자·같은 주소로 툴팁이 있었으면 되살린다 */
export function keepLinkTitles(base: string, md: string): string {
  const LINK_T = /(!?)\[([^\[\]\n]*)\]\((<[^>\n]*>|[^()\s]+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
  const titles = new Map<string, string>();
  prose(base, (line) => {
    for (const m of line.matchAll(LINK_T)) if (m[4] && !inCode(line, m.index!)) titles.set(`${m[1]}${m[2]}\u0001${destKey(m[3]!)}`, m[4]);
    return line;
  });
  if (!titles.size) return md;
  return prose(md, (line) => line.replace(LINK_T, (all, bang: string, text: string, dest: string, title: string | undefined, at: number) => {
    const t = title || inCode(line, at) ? undefined : titles.get(`${bang}${text}\u0001${destKey(dest)}`);
    return t ? `${bang}[${text}](${dest}${t})` : all;
  }));
}

/** 꾸밈으로만 감싼 코드(**`a`**·*`a`*·~~`a`~~) — 편집기는 코드에 다른 꾸밈을 못 얹어 읽을 때 꾸밈이 사라지고, 그 블록을 고쳐 쓰면 `a` 만 남았다
 *  (BlockNote 0.51 실측). 원래 글(base)에서 그 코드가 늘 감싸여 있었으면 쓴 글의 맨 코드를 같은 꾸밈으로 되돌린다 — 맨 것으로도 있었으면 모르니 그대로 */
export function keepMarkedCode(base: string, md: string): string {
  const wrapped = new Map<string, string>();
  const bare = new Set<string>();
  prose(base, (line) => {
    for (const m of line.matchAll(/(\*\*\*|\*\*|\*|~~)?(`[^`\n]+`)(\*\*\*|\*\*|\*|~~)?/g)) {
      const [, a, code, b] = m;
      if (a && a === b) { if (wrapped.has(code!) && wrapped.get(code!) !== a) bare.add(code!); else wrapped.set(code!, a); } else bare.add(code!);
    }
    return line;
  });
  for (const c of bare) wrapped.delete(c);
  if (!wrapped.size) return md;
  return prose(md, (line) => line.replace(/(\*\*\*|\*\*|\*|~~)?(`[^`\n]+`)(\*\*\*|\*\*|\*|~~)?/g, (all, a: string | undefined, code: string, b: string | undefined) => {
    const d = wrapped.get(code);
    return d && !a && !b ? `${d}${code}${d}` : all;
  }));
}

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
