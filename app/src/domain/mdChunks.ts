// 안 바뀐 블록은 원래 md 글 그대로 — 편집기(BlockNote)는 저장할 때 문서 전체를 다시 써서 한 글자만 고쳐도 링크·굵게·목록 모양이
// 바뀌고(일부는 저장할 때마다 번졌다) 참모·세션이 쓴 md 의 diff 가 통째로 시끄러웠다(2026-10-04).
// 원문을 md 블록 경계로 조각내고(splitChunks), 조각을 따로 읽은 블록이 문서 전체를 읽은 블록과 맞는지 확인해 짝짓고(alignChunks),
// 저장할 땐 지금 블록 중 안 바뀐 조각을 찾아(planChunks) 원문 조각과 새로 쓴 조각을 이어 붙인다(joinChunks). 블록 비교는 블록 하나씩 md 로 쓴 글

/** 원문 조각 — md.slice(start, end), 앞뒤 빈 줄은 안 든다 */
export type Piece = { start: number; end: number };
/** 짝지은 조각 — 이 조각을 읽으면 나오는 블록들(블록마다 md 로 쓴 글) */
export type Chunk = Piece & { sers: string[]; /** 편집기가 못 읽는 뒤쪽 글 — 늘 맨 끝에 */ tail?: true };
/** 지금 블록 [from, to) — 원문 조각 그대로(keep) 또는 새로 쓴다(fresh) */
export type Seg = { keep: number; from: number; to: number } | { fresh: true; from: number; to: number };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const blank = (l: string) => !l.trim();
const HTML_OPEN = /^ {0,3}(?:(<!--)|<(script|pre|style|textarea)(?=[\s>]|$))/i;
const LINK_LINE = /^\s*\[[^\]\n]*\]\([^)\n]*\)\s*$/;

/** md 블록 경계로 조각 — 빈 줄, 최상위 목록 항목, 제목 줄(앞뒤), 코드 펜스(통째로). 들여 쓴 줄은 앞 조각에(목록 안쪽·이어진 문단·목록 안 펜스) */
export function splitChunks(md: string): Piece[] {
  const out: Piece[] = [];
  let cur: Piece | null = null;
  let fence: { ch: string; len: number } | null = null;
  /** HTML 블록(주석·script·pre·style·textarea) — 닫는 표시가 나올 때까지 빈 줄이 있어도 한 조각(가운데서 자르면 닫히지 않은 주석이 뒤를 먹는다) */
  let html: string | null = null;
  let afterBlank = true;
  let headingDone = false;
  let at = 0;
  const close = () => { if (cur) out.push(cur); cur = null; };
  for (const line of md.split('\n')) {
    const start = at, end = at + line.length;
    at = end + 1;
    if (fence) {
      cur!.end = end;
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len) { fence = null; close(); afterBlank = false; }
      continue;
    }
    if (html) {
      cur!.end = end;
      if (line.toLowerCase().includes(html)) { html = null; close(); afterBlank = false; }
      continue;
    }
    if (blank(line)) { afterBlank = true; continue; }
    const h = HTML_OPEN.exec(line);
    if (h) {
      close();
      cur = { start, end };
      const endTag = h[1] ? '-->' : `</${h[2]!.toLowerCase()}>`;
      // 같은 줄에서 닫히면 그 줄만
      if (line.toLowerCase().indexOf(endTag, h[0].length) >= 0) { close(); afterBlank = false; } else html = endTag;
      continue;
    }
    const indented = /^\s/.test(line);
    const f = FENCE.exec(line);
    const startsNew = !cur || headingDone || (afterBlank && !indented) || (!indented && (f !== null || LIST.test(line) || HEADING.test(line)));
    if (startsNew) { close(); cur = { start, end }; } else cur!.end = end;
    headingDone = HEADING.test(line) && !indented;
    afterBlank = false;
    if (f) fence = { ch: f[1]![0]!, len: f[1]!.length };
  }
  close();
  // 링크만 있는 줄들 — 편집기는 줄마다 페이지 블록(PageBlock)으로 읽는다. 줄마다 조각이어야 하나를 지워도 나머지가 원래 글로 남는다
  return out.flatMap((p) => {
    const lines = md.slice(p.start, p.end).split('\n');
    if (lines.length < 2 || !lines.every((l) => LINK_LINE.test(l))) return [p];
    let at = p.start;
    return lines.map((l) => { const q = { start: at, end: at + l.length }; at += l.length + 1; return q; });
  });
}

/** 블록이 없어도 원래 글 그대로 남겨도 되는 조각 — 닫힌 HTML 주석과 참조 링크 정의(`[x]: 주소`)뿐 */
const safeZero = (t: string) => t.replace(/<!--[\s\S]*?-->/g, '').split('\n').every((l) => !l.trim() || /^ {0,3}\[[^\]]+\]:\s*\S/.test(l));
const eq = (a: string[], b: string[], at: number) => a.every((x, k) => x === b[at + k]);

/** 조각마다 따로 읽어(parse) 문서 전체를 읽은 블록(base)과 차례로 맞춘다. 블록이 없는 조각(주석 등)은 블록 없는 조각으로 두고,
 *  따로 읽으면 다르게 읽히는 조각은 다음 조각과 합쳐 다시(최대 8개). 끝내 안 맞으면 거기서 멈춘다 — 그 뒤 블록은 새로 쓴다 */
export async function alignChunks(md: string, base: string[], parse: (text: string) => Promise<string[]>): Promise<{ chunks: Chunk[]; complete: boolean }> {
  const ps = splitChunks(md);
  const chunks: Chunk[] = [];
  let p = 0;
  let i = 0;
  while (i < ps.length) {
    // 문서 전체를 읽은 블록이 다 짝지어졌는데 원문이 남았다 — 편집기가 못 읽은 글(빈 줄 든 주석 뒤 등). 블록 없는 조각으로 원래 글 그대로 남긴다
    // (안 그러면 저장할 때 편집기에 안 보이던 뒤쪽이 통째로 지워진다)
    if (p === base.length) { chunks.push({ start: ps[i]!.start, end: ps[ps.length - 1]!.end, sers: [], tail: true }); break; }
    let found: Chunk | null = null;
    let used = 0;
    for (let k = 1; k <= 8 && i + k <= ps.length; k++) {
      const piece = { start: ps[i]!.start, end: ps[i + k - 1]!.end };
      const sers = await parse(md.slice(piece.start, piece.end));
      // 블록이 없는 조각(주석·참조 링크 정의) — 따로 둔다. 이웃 조각이 남으면 같이 남는다(joinChunks)
      if (sers.length && p + sers.length <= base.length && eq(sers, base, p)) { found = { ...piece, sers }; used = k; break; }
      // 빈 블록만 나오면(편집기는 주석을 빈 문단으로 읽는다) 블록 없는 조각 — 닫힌 주석·참조 링크 정의뿐일 때만(아니면 합쳐 다시)
      if (sers.every((x) => !x.trim()) && safeZero(md.slice(piece.start, piece.end))) { found = { ...piece, sers: [] }; used = k; break; }
    }
    if (!found) return { chunks, complete: false };
    chunks.push(found);
    p += found.sers.length;
    i += used;
  }
  return { chunks, complete: p === base.length };
}

/** 지금 블록(cur, 블록마다 md 로 쓴 글)에서 원문 조각 그대로 쓸 곳 — 다음 차례 조각을 먼저, 아니면 안 쓴 아무 조각(옮긴 블록).
 *  같은 조각은 한 번만(복제한 블록은 새로) */
export function planChunks(chunks: Chunk[], cur: string[]): Seg[] {
  const segs: Seg[] = [];
  const used = new Set<number>();
  const fits = (j: number, i: number) => j < chunks.length && !used.has(j) && chunks[j]!.sers.length > 0 && i + chunks[j]!.sers.length <= cur.length && eq(chunks[j]!.sers, cur, i);
  let next = 0;
  for (let i = 0; i < cur.length;) {
    let j = fits(next, i) ? next : -1;
    if (j < 0) {
      // 가까운 것부터(앞으로 → 뒤로)
      for (let d = 1; d <= chunks.length * 2 + 1 && j < 0; d++) {
        const c = d % 2 ? next + (d + 1) / 2 : next - d / 2;
        if (c >= 0 && c < chunks.length && fits(c, i)) j = c;
      }
    }
    if (j >= 0) {
      used.add(j);
      segs.push({ keep: j, from: i, to: i + chunks[j]!.sers.length });
      i += chunks[j]!.sers.length;
      next = j + 1;
      continue;
    }
    const last = segs[segs.length - 1];
    if (last && 'fresh' in last) last.to = i + 1;
    else segs.push({ fresh: true, from: i, to: i + 1 });
    i++;
  }
  return segs;
}

/** 닫히지 않은 코드 펜스 조각이면 닫는 표시, 아니면 null */
function unclosedFence(t: string): string | null {
  const lines = t.split('\n');
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]!);
  if (!m) return null;
  const ch = m[1]![0]!, len = m[1]!.length;
  const close = new RegExp(`^ {0,3}\\${ch}{${len},}\\s*$`);
  return lines.slice(1).some((l) => close.test(l)) ? null : m[1]!;
}

/** 목록 항목 줄의 종류 — 기호 목록 / 번호 목록 (같은 종류끼리만 한 목록) */
const kindOf = (line: string) => { const m = LIST.exec(line); return !m ? null : /\d/.test(m[1]!) ? 'ord' : 'bul'; };
const firstLine = (t: string) => t.slice(0, t.indexOf('\n') < 0 ? t.length : t.indexOf('\n'));
const lastLine = (t: string) => t.slice(t.lastIndexOf('\n') + 1);
const lastTopLine = (t: string) => t.split('\n').reverse().find((l) => l.trim() && !/^\s/.test(l)) ?? '';

/** 앞 글 p 와 뒤 글 o 를 줄바꿈 하나로 붙여도 md 가 안 섞이나 — 앞이 제목 줄·닫힌 펜스면, 뒤가 제목·펜스면, 목록 항목끼리면,
 *  문단 뒤에 문단을 끊는 목록(기호·1.)이면. 그 밖(문단 뒤 문단은 한 문단으로, 목록 뒤 문단은 항목에, 문단 뒤 --- 는 제목 밑줄로)은 빈 줄 */
function tightOk(p: string, o: string): boolean {
  const pl = lastLine(p), of = firstLine(o);
  if (HEADING.test(pl) && !/^\s/.test(pl)) return true;
  if (FENCE.test(pl) && FENCE.test(firstLine(p)) && p.includes('\n')) return true;
  if (HEADING.test(of) || FENCE.test(of)) return true;
  if (!LIST.test(of)) return false;
  // 목록 항목끼리 — 앞이 항목으로 시작하는 조각이면 그 뒤 최상위 줄은 항목의 이어진 줄이다("2.5. …" 같은)
  return LIST.test(lastTopLine(p)) || LIST.test(firstLine(p)) || /^ {0,3}([-*+]|1[.)])\s+\S/.test(of);
}

/** 원문 조각(keep)과 새로 쓴 조각(fresh(seg) — BlockNote 가 쓴 그 블록들의 md)을 이어 붙인다. 붙은 두 원문 조각이 원래도 이웃이면 그 사이 글
 *  그대로, 아니면 원래 사이 글을 쓰되 줄바꿈 하나로 붙이면 md 가 섞이는 곳(tightOk)은 빈 줄. 앞 글·끝 글(끝 줄바꿈 유무)은 원래 문서를 따른다.
 *  돌려주는 chunks = 이어 붙인 글의 조각 지도(새로 쓴 조각은 cur 의 그 블록들) — 다음 저장의 기준 */
export function joinChunks(md: string, chunks: Chunk[], segs: Seg[], fresh: (seg: Seg) => string, complete: boolean, cur: string[] = []): { text: string; chunks: Chunk[] } {
  const gapAfter = (j: number) => (j + 1 < chunks.length ? md.slice(chunks[j]!.end, chunks[j + 1]!.start) : '');
  const gapBefore = (j: number) => (j > 0 ? md.slice(chunks[j - 1]!.end, chunks[j]!.start) : '');
  const loose = (g: string) => /\n[ \t]*\n/.test(g);
  const chunkText = (j: number) => md.slice(chunks[j]!.start, chunks[j]!.end);
  type Out = { text: string; keep?: number; seg: Seg };
  const outs: Out[] = [];
  // 블록 없는 조각(주석·참조 링크 정의)은 편집기에 안 보여 사람이 지울 수 없다 — 앞 조각이 남으면 그 뒤에, 아니면 뒤 조각 앞에 같이 남긴다
  const zero = (j: number) => chunks[j]!.sers.length === 0 && !chunks[j]!.tail;
  const kept = new Set(segs.flatMap((x) => ('keep' in x ? [x.keep] : [])));
  const emitted = new Set<number>();
  const keep = (j: number, seg: Seg) => {
    if (emitted.has(j)) return;
    emitted.add(j);
    outs.push({ text: md.slice(chunks[j]!.start, chunks[j]!.end), keep: j, seg });
  };
  // 문서 맨 위 블록 없는 조각(주석·지시문)은 첫 블록을 고쳐도 맨 위에
  for (let j = 0; j < chunks.length && zero(j); j++) keep(j, { keep: j, from: 0, to: 0 });
  for (const seg of segs) {
    if ('keep' in seg) {
      let z = seg.keep;
      while (z > 0 && zero(z - 1) && !emitted.has(z - 1)) z--;
      for (let q = z; q < seg.keep; q++) keep(q, seg);
      keep(seg.keep, seg);
      for (let w = seg.keep + 1; w < chunks.length && zero(w) && !emitted.has(w); w++) keep(w, seg);
      continue;
    }
    const t = fresh(seg).replace(/^\n+|\s+$/g, '');
    if (t.trim()) outs.push({ text: t, seg });
  }
  // 양쪽 이웃이 다 새로 쓰인 블록 없는 조각 — 원래 순서로 그다음 원문 조각 앞에(없으면 끝에)
  chunks.forEach((c, j) => {
    if (!zero(j) || emitted.has(j)) return;
    emitted.add(j);
    const at = outs.findIndex((o) => o.keep !== undefined && o.keep > j);
    const o = { text: md.slice(c.start, c.end), keep: j, seg: { keep: j, from: 0, to: 0 } as Seg };
    if (at < 0) outs.push(o); else outs.splice(at, 0, o);
  });
  // 편집기가 못 읽는 꼬리 — 늘 맨 끝(새로 넣은 블록이 그 뒤에 붙으면 다시 열 때 안 보인다)
  chunks.forEach((c, j) => { if (c.tail) outs.push({ text: md.slice(c.start, c.end), keep: j, seg: { keep: j, from: 0, to: 0 } }); });
  let text = outs[0]?.keep === 0 ? md.slice(0, chunks[0]!.start) : '';
  const out: Chunk[] = [];
  outs.forEach((o, k) => {
    const p = outs[k - 1];
    if (p) {
      // 원래 끝에 닫히지 않은 코드 펜스였던 조각 뒤에 무언가 오면 펜스를 닫는다(안 닫으면 뒤 블록이 코드 안으로 들어간다)
      const open = p.keep !== undefined ? unclosedFence(p.text) : null;
      if (open) { text += `\n${open}`; out[out.length - 1]!.end = text.length; }
      if (p.keep !== undefined && o.keep === p.keep + 1) text += gapAfter(p.keep);
      else {
        // 원래 사이 글 — 뒤 조각이 원래 있던 자리 앞 글(지운 블록 자리), 없으면 앞 조각 뒤 글(새로 넣은 블록)
        let g = (o.keep !== undefined ? gapBefore(o.keep) : '') || (p.keep !== undefined ? gapAfter(p.keep) : '') || '\n\n';
        // 같은 종류 목록 항목끼리면 그 목록의 촘촘함(이웃 항목 사이 글) — 목록 끝 빈 줄을 따라가지 않게
        const pk = kindOf(lastTopLine(p.text)) ?? kindOf(firstLine(p.text)), ok = kindOf(firstLine(o.text));
        // (원문 조각 뒤에 끼워 넣은 새 항목만 — 원래 다음 조각이 남아 있으면 끼워 넣은 것, 없으면 그 자리를 고친 것이라 원래 사이 글)
        if (pk && pk === ok && p.keep !== undefined && o.keep === undefined && kept.has(p.keep + 1)) {
          const sib = p.keep > 0 && kindOf(firstLine(chunkText(p.keep - 1))) === pk ? gapBefore(p.keep) : null;
          g = sib ?? (loose(gapAfter(p.keep)) ? '\n' : gapAfter(p.keep));
        } else if (pk && pk === ok && p.keep === undefined && o.keep !== undefined && (o.keep === 0 || kept.has(o.keep - 1))) {
          // 원문 항목 앞에 끼워 넣은 새 항목 — 그 목록의 촘촘함(원문 항목 뒤 사이 글)
          g = o.keep + 1 < chunks.length && kindOf(firstLine(chunkText(o.keep + 1))) === ok ? gapAfter(o.keep) : '\n';
        }
        text += loose(g) ? g : tightOk(p.text, o.text) ? g : '\n\n';
      }
    }
    const start = text.length;
    text += o.text;
    out.push({ start, end: text.length, sers: o.keep !== undefined ? chunks[o.keep]!.sers : cur.slice(o.seg.from, o.seg.to), ...(o.keep !== undefined && chunks[o.keep]!.tail ? { tail: true as const } : {}) });
  });
  const last = outs[outs.length - 1];
  if (last?.keep !== undefined && last.keep === chunks.length - 1 && complete) text += md.slice(chunks[last.keep]!.end);
  else if (outs.length && (md === '' || md.endsWith('\n'))) text += '\n';
  return { text, chunks: out };
}

/** 블록 하나 + 하위 블록 — BlockNote 는 목록 항목의 하위 문단을 들여쓰기 없이 최상위로 꺼내 써서 다시 읽으면 형제가 됐다(번호도 1부터 다시, 2026-10-04 실측).
 *  목록 항목이면 하위 블록 줄을 항목 글자 폭만큼 들여 쓴다(하위 목록은 빈 줄 없이). 목록이 아닌 블록 아래 들여쓰기는 md 로 못 나타내 그대로 이어 쓴다 */
export function nestChildren(head: string, kids: string, kidsList: boolean): string {
  const m = /^([-*+]|\d{1,9}[.)])( +)/.exec(firstLine(head));
  if (!m) return `${head}\n\n${kids}`;
  const pad = ' '.repeat(m[0].length);
  return `${head}${kidsList ? '\n' : '\n\n'}${kids.split('\n').map((l) => (l ? pad + l : l)).join('\n')}`;
}
