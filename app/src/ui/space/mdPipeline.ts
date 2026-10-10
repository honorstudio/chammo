// 편집기(BlockNote) ↔ md 파일 — 읽기·쓰기 길 하나(docSync·SpaceEditor·시험 하네스가 같이 쓴다).
// 쓸 땐 안 바뀐 블록은 원래 md 글 그대로(domain/mdChunks), 고친 블록만 BlockNote 출력 — BlockNote 의 md 는 손실이 있어(링크·굵게·목록 모양)
// 고친 블록에도 원래 글 모양을 지키는 손질을 한다(mdLinks·mdBreaks·mdMarkers·mdTables)
import type { BlockNoteEditor } from '@blocknote/core';
import { alignChunks, joinChunks, nestChildren, planChunks, type Chunk, type Seg } from '../../domain/mdChunks';
import { keepTables } from '../../domain/mdTables';
import { readableLinks, writeLinks } from '../../domain/mdLinks';
import { dropBreakSpace, keepBreaks, keepItemLines } from '../../domain/mdBreaks';
import { keepMarkers, keepNumbers } from '../../domain/mdMarkers';
import { codeLinkText, keepCodeLinks, keepFences, keepLinkTitles, keepMarkedCode, keepSpanBreaks, mergeAroundCode, mergeInStrike, mergeSplitLinks, mergeSplitMarks } from '../../domain/mdInline';
import { toPageBlocks } from './PageBlock';

type Ed = BlockNoteEditor;
type Blocks = Ed['document'];

/** md → 블록(CRLF 는 LF 로 — 편집기는 \r 을 공백처럼 읽었다 · 띄어쓰기 든 링크 주소가 안 잘리게 · 글자가 코드인 링크가 안 사라지게 ·
 *  그냥 줄바꿈 뒤 끼어든 공백 빼기 · 링크만 있는 줄은 페이지 블록) */
export const parseMd = async (editor: Ed, md: string) =>
  toPageBlocks(dropBreakSpace(await editor.tryParseMarkdownToBlocks(codeLinkText(readableLinks(md.replace(/\r\n/g, '\n')))))) as Blocks;

/** BlockNote 가 쓴 md(고친 블록)를 원래 글(base) 모양에 맞춘다 — 꾸밈 안 코드, 취소선 안 굵게, 기울임·굵게 안 꾸밈, 꾸밈으로 감싼 코드, 갈라진 링크, 링크 툴팁, 띄어쓰기 든 링크 주소는 꺾쇠로, 목록 기호·번호·구분선,
 *  목록 항목에 붙어 있던 이어진 줄, 그냥 줄바꿈·이어진 줄 들여쓰기, 줄을 넘던 굵게, 표, 코드 글자 링크, 언어 없는 펜스 */
export const fixWritten = (base: string, md: string) =>
  keepLinkTitles(base, keepMarkedCode(base, keepFences(base, keepCodeLinks(base, keepTables(base, keepSpanBreaks(base, keepItemLines(base, keepBreaks(base, keepMarkers(base, writeLinks(mergeSplitLinks(mergeSplitMarks(mergeInStrike(mergeAroundCode(md))))))))))))));

type Mapping = { chunks: Chunk[]; complete: boolean };
/** 편집기마다 — 블록 하나를 md 로 쓴 글(블록 내용이 같으면 다시 안 쓴다) · 문서 글마다 조각 지도(최근 몇 개) */
type State = { ser: Map<string, string>; maps: Map<string, Promise<Mapping>> };
const states = new WeakMap<Ed, State>();
const stateOf = (ed: Ed) => {
  let st = states.get(ed);
  if (!st) { st = { ser: new Map(), maps: new Map() }; states.set(ed, st); }
  return st;
};
const MAPS = 6;
const SERS = 20_000;
const remember = (st: State, text: string, m: Promise<Mapping>) => {
  st.maps.delete(text);
  st.maps.set(text, m);
  while (st.maps.size > MAPS) st.maps.delete(st.maps.keys().next().value!);
};

/** 블록마다 md 로 쓴 글 — 블록을 비교하는 열쇠(블록 id 는 빼고 내용으로 기억) */
async function sersOf(ed: Ed, st: State, blocks: Blocks): Promise<string[]> {
  const out: string[] = [];
  for (const b of blocks) {
    const k = JSON.stringify(b, (key, v) => (key === 'id' ? undefined : v));
    let v = st.ser.get(k);
    if (v === undefined) {
      v = await serOne(ed, b);
      if (st.ser.size > SERS) st.ser.clear();
      st.ser.set(k, v);
    }
    out.push(v);
  }
  return out;
}
// 번호 목록 항목은 따로 쓰면 그 항목 번호(start)가 나와 문서 전체에서 읽은 것(1.)과 갈린다 — 비교 열쇠에선 번호를 뺀다
// (번호는 편집기에서 못 고친다 — 안 바뀐 항목은 원래 번호 글 그대로 남는다)
const serOne = async (ed: Ed, b: Blocks[number]) => (await ed.blocksToMarkdownLossy([b])).replace(/^(\s*)\d{1,9}([.)])(?=\s)/, '$1#$2');

/** 문서 글의 조각 지도 — 조각마다 따로 읽어 문서 전체를 읽은 블록과 맞춘다(열 때·바깥 판이 들어올 때 한 번) */
function mappingFor(ed: Ed, st: State, text: string): Promise<Mapping> {
  const hit = st.maps.get(text);
  if (hit) return hit;
  const m = (async () => {
    const base = await sersOf(ed, st, await parseMd(ed, text));
    return alignChunks(text, base, async (t) => sersOf(ed, st, await parseMd(ed, t)));
  })().catch(() => {
    st.maps.delete(text); // 실패한 지도는 기억하지 않는다 — 이번엔 전부 새로 쓰고 다음에 다시
    return { chunks: [], complete: false };
  });
  remember(st, text, m);
  return m;
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);
const isList = (b: Blocks[number]) => LIST_TYPES.has(b.type);

/** 블록들 → md(고친 블록) — BlockNote 는 목록 항목 아래 하위 문단을 최상위로 꺼내 써서(다시 읽으면 형제) 하위 블록은 우리가 들여 쓴다(nestChildren).
 *  같은 종류 목록 항목끼리는 줄바꿈 하나, 나머지는 빈 줄 — BlockNote 가 쓰는 모양 그대로 */
async function blocksToMd(ed: Ed, blocks: Blocks): Promise<string> {
  let out = '';
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k]!;
    const head = (await ed.blocksToMarkdownLossy([{ ...b, children: [] }])).replace(/\s+$/, '');
    const text = b.children.length ? nestChildren(head, await blocksToMd(ed, b.children), isList(b.children[0]!)) : head;
    const prev = blocks[k - 1];
    if (k) out += prev && isList(prev) && isList(b) && prev.type === b.type ? '\n' : '\n\n';
    out += text;
  }
  return out;
}

/** 지금 편집기 → 파일에 쓸 md. base = 이 편집기가 마지막으로 본 파일 글 — 그 글에서 안 바뀐 블록은 원래 글 그대로, 나머지는 BlockNote 출력 + 손질.
 *  쓴 글의 조각 지도도 기억해 둔다(저장하면 그게 다음 base). 원래 파일이 CRLF 면 LF 로 다루고 돌려줄 때 CRLF 로(한 파일에 섞이지 않게).
 *  여기서 무엇이든 실패하면 예전처럼 문서 전체를 BlockNote 출력 + 손질로 — 저장이 멈추는 것보단 모양이 바뀌는 게 낫다 */
export async function writeMd(editor: Ed, base: string): Promise<string> {
  const crlf = base.includes('\r\n');
  const b = crlf ? base.replace(/\r\n/g, '\n') : base;
  let out: string;
  try {
    out = await preserve(editor, b);
  } catch {
    out = fixWritten(b, await editor.blocksToMarkdownLossy(editor.document));
  }
  return crlf ? out.replace(/\r?\n/g, '\r\n') : out;
}

async function preserve(editor: Ed, base: string): Promise<string> {
  const st = stateOf(editor);
  const blocks = editor.document;
  const [m, cur] = await Promise.all([mappingFor(editor, st, base), sersOf(editor, st, blocks)]);
  const segs = planChunks(m.chunks, cur);
  const fresh = new Map<Seg, string>();
  const chunkText = (j: number) => base.slice(m.chunks[j]!.start, m.chunks[j]!.end);
  // 번호 목록 첫 항목(앞 블록이 번호 목록이 아님)은 편집기 시작 번호 — 첫 항목을 지우면 원래 2. 가 첫 항목이 된다
  const listFirst = (i: number) => blocks[i]!.type === 'numberedListItem' && (i === 0 || blocks[i - 1]!.type !== 'numberedListItem');
  const startOf = (i: number) => (blocks[i]!.props as { start?: number }).start ?? 1;
  const preset = new Set<Seg>();
  segs.forEach((s, k) => {
    if (!('keep' in s) || !listFirst(s.from)) return;
    const t = chunkText(s.keep);
    const n = /^(\d{1,9})([.)])/.exec(t);
    if (!n || Number(n[1]) === startOf(s.from)) return;
    const f: Seg = { fresh: true, from: s.from, to: s.to }; // 원래 글 그대로, 번호만
    segs[k] = f;
    fresh.set(f, `${startOf(s.from)}${n[2]}${t.slice(n[0].length)}`);
    preset.add(f);
  });
  for (const s of segs) if ('fresh' in s && !preset.has(s)) fresh.set(s, fixWritten(base, await blocksToMd(editor, blocks.slice(s.from, s.to))));
  // 번호 목록 번호는 이웃 조각의 맞닿은 줄을 보고(고친 항목 하나만 쓰면 늘 1. 이다)
  const textOf = (s: Seg | undefined) => (!s ? '' : 'keep' in s ? chunkText(s.keep) : fresh.get(s) ?? '');
  segs.forEach((s, k) => {
    if (!('fresh' in s) || preset.has(s)) return;
    const before = textOf(segs[k - 1]).split('\n').pop() ?? '', after = textOf(segs[k + 1]).split('\n')[0] ?? '';
    const starts: number[] = [];
    for (let i = s.from; i < s.to; i++) if (listFirst(i)) starts.push(startOf(i));
    fresh.set(s, keepNumbers(base, fresh.get(s)!.replace(/\n+$/, ''), before, after, starts));
  });
  const r = joinChunks(base, m.chunks, segs, (s) => fresh.get(s) ?? '', m.complete, cur);
  if (!st.maps.has(r.text)) remember(st, r.text, Promise.resolve({ chunks: r.chunks, complete: true }));
  return r.text;
}
