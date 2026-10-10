// 문단 안 '그냥 줄바꿈'(빈 줄 없이 이어 쓴 줄) — 편집기(BlockNote 0.51.4)는 이걸 <br>+공백으로 읽어 둘째 줄부터 앞에 공백 한 칸이 붙고,
// 쓸 때는 모든 줄바꿈을 `\` 강제 줄바꿈으로 내보낸다. 참모·세션이 쓴 md 를 한 글자만 고쳐도 파일 전체 줄바꿈이 바뀌었다(2026-10-04 QA N1).
// 읽을 땐 끼어든 공백을 빼고, 쓸 땐 원래 파일에서 그냥 줄바꿈이던 자리를 되살린다(mdTables 처럼 원래 글 기준)

type Part = { type: string; text?: string; styles?: { code?: unknown }; content?: Part[] };
type Block = { type: string; content?: unknown; children?: Block[] };

/** 읽은 블록 — 줄바꿈 바로 뒤 공백 한 칸(md 에선 줄 앞 공백이 원래 글이 아니다)을 뺀다. 코드 블록·줄 안 코드는 진짜 글이라 그대로 */
export function dropBreakSpace<B extends Block>(blocks: B[]): B[] {
  return blocks.map((b) => {
    let out = b;
    if (b.type !== 'codeBlock' && Array.isArray(b.content)) {
      let afterBreak = false;
      const walk = (parts: Part[]): Part[] => parts.flatMap((p) => {
        if (p.type === 'link' && Array.isArray(p.content)) return [{ ...p, content: walk(p.content) }];
        if (p.type !== 'text' || typeof p.text !== 'string') { afterBreak = false; return [p]; }
        let t = p.text;
        if (!p.styles?.code) {
          if (afterBreak && t.startsWith(' ')) t = t.slice(1);
          t = t.replace(/\n /g, '\n');
        }
        afterBreak = t.endsWith('\n');
        if (!t && p.text) return [];
        return [t === p.text ? p : { ...p, text: t }];
      });
      out = { ...b, content: walk(b.content as Part[]) };
    }
    return b.children?.length ? { ...out, children: dropBreakSpace(b.children) } : out;
  });
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST = /^\s*([-*+]|\d+[.)])\s/;
/** 줄 끝 `\` 가 강제 줄바꿈인가 — 홀수 개여야(짝수면 글자 \ 를 탈출한 것) */
const hardSlash = (l: string) => (/\\+$/.exec(l)?.[0].length ?? 0) % 2 === 1;
/** 줄 비교 열쇠 — 편집기는 줄을 넘는 굵게·기울임을 줄마다 끊어 쓰고(`**a**\` / `**b**`) 글자를 탈출(`\_`)하니 그 기호·띄어쓰기는 빼고 본다 */
const key = (l: string) => l.replace(/[\\*_`]/g, '').replace(/\s+/g, ' ').trim();

/** i 번째 줄이 목록 항목 글(항목 줄부터 빈 줄 없이 이어진 줄)인가 */
function inItemText(lines: string[], i: number): boolean {
  for (let k = i; k >= 0; k--) {
    if (!lines[k]!.trim()) return false;
    if (LIST.test(lines[k]!)) return true;
  }
  return false;
}

/** 코드 블록 밖 줄마다 f(i) — 펜스 줄과 그 안은 건너뛴다 */
function eachProse(lines: string[], f: (i: number) => void) {
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const m = FENCE.exec(l);
    if (m) {
      if (!fence) fence = m[1]![0]!;
      else if (m[1]![0] === fence) fence = null;
      return;
    }
    if (!fence) f(i);
  });
}

/** next(편집기가 쓴 글)의 `\` 강제 줄바꿈 중 original(원래 파일)에서 그냥 줄바꿈이던 자리는 그냥 줄바꿈으로, 두 칸 공백이던 자리는 두 칸 공백으로.
 *  고친 줄도 앞이나 뒤 줄 하나가 원래대로면 원래 모양을 따른다. 사람이 새로 넣은 줄바꿈(Shift+Enter)은 `\` 그대로 */
export function keepBreaks(original: string, next: string): string {
  const o = original.split('\n');
  const softLeft = new Set<string>();
  const softRight = new Set<string>();
  /** 이어진 줄의 원래 들여쓰기 — 편집기는 지운다 */
  const indentOf = new Map<string, string>();
  const spaceLeft = new Map<string, string>();
  const blank = (l: string | undefined) => l === undefined || !l.trim() || FENCE.test(l);
  eachProse(o, (i) => {
    const l = o[i]!;
    if (blank(l) || blank(o[i + 1])) return;
    if (hardSlash(l)) return;
    const sp = /[ \t]{2,}$/.exec(l)?.[0];
    if (sp) spaceLeft.set(key(l), sp);
    else { softLeft.add(key(l)); softRight.add(key(o[i + 1]!)); }
    const ind = /^[ \t]+/.exec(o[i + 1]!)?.[0];
    if (ind && !LIST.test(o[i + 1]!)) indentOf.set(key(o[i + 1]!), ind);
  });
  softLeft.delete(''); softRight.delete(''); // 기호만 있는 줄은 열쇠가 안 된다
  if (!softLeft.size && !spaceLeft.size) return next;
  const src = next.split('\n');
  const n = [...src];
  eachProse(src, (i) => {
    const l = src[i]!;
    // 목록 항목 글 안 줄바꿈은 `\` 그대로 — 그냥 줄바꿈이면 편집기가 다시 읽을 때 항목을 둘로 쪼갠다(항목 아래 빈 줄 뒤 하위 문단은 괜찮다)
    if (!hardSlash(l) || blank(src[i + 1]) || LIST.test(l) || (/^\s/.test(src[i + 1]!) && inItemText(src, i))) return;
    const left = n[i]!.slice(0, -1);
    const k = key(left);
    const sp = spaceLeft.get(k);
    if (sp) n[i] = left.replace(/[ \t]+$/, '') + sp;
    else if (softLeft.has(k) || softRight.has(key(src[i + 1]!))) {
      n[i] = left;
      // 이어진 줄의 원래 들여쓰기 — 문단 이어진 줄의 들여쓰기는 md 에서 뜻이 없어(목록 안이어도 같은 문단) 모양만 되살린다
      const ind = indentOf.get(key(src[i + 1]!));
      if (ind) n[i + 1] = ind + n[i + 1]!.trimStart();
    }
  });
  return n.join('\n');
}

/** 목록 항목에 바로 붙어 있던 들여 쓴 이어진 줄 — 편집기는 항목 + 하위 문단으로 읽고, 쓸 땐 하위 문단을 빈 줄 + 들여쓰기로 쓴다(nestChildren).
 *  원래 글에서 그 항목 바로 다음 줄로 붙어 있던 글이면(또는 그런 줄을 가졌던 항목이면) 빈 줄을 빼고 원래 들여쓰기로. 들여 쓰지 않은 문단은 항목 밖이라 안 건드린다 */
export function keepItemLines(original: string, next: string): string {
  const o = original.split('\n');
  const cont = new Map<string, string>();
  /** 이어진 줄을 가졌던 항목(기호 뺀 글) → 그 들여쓰기 — 이어진 줄 자체를 고쳤을 때 */
  const items = new Map<string, string>();
  const itemKey = (l: string) => key(l.replace(/^\s*([-*+]|\d{1,9}[.)])\s+/, ''));
  eachProse(o, (i) => {
    const nx = o[i + 1];
    if (!LIST.test(o[i]!) || nx === undefined || !nx.trim() || FENCE.test(nx) || LIST.test(nx)) return;
    const ind = /^[ \t]+/.exec(nx)?.[0];
    if (ind && key(nx)) { cont.set(key(nx), ind); items.set(itemKey(o[i]!), ind); }
  });
  if (!cont.size) return next;
  const n = next.split('\n');
  const drop = new Set<number>();
  eachProse(n, (i) => {
    const t = n[i + 2];
    if (!LIST.test(n[i]!) || n[i + 1] !== '' || t === undefined || !t.trim() || LIST.test(t) || FENCE.test(t)) return;
    // 체크 항목(그리고 블록 하나로 쓴 항목)의 이어진 줄은 편집기가 들여쓰기 없는 형제 문단으로 쓴다 — 원래 글에서 그 줄이 이어진 줄이었을 때만(BlockNote 0.51 실측)
    if (!/^\s/.test(t) && !cont.has(key(t))) return;
    const ind = cont.get(key(t)) ?? items.get(itemKey(n[i]!));
    if (!ind) return;
    drop.add(i + 1);
    n[i + 2] = ind + t.trimStart();
  });
  return n.filter((_, i) => !drop.has(i)).join('\n');
}
