// 고른 곳을 짚은 채 참모에게 묻기(2026-11-13 사용자) — 스페이스 문서에서 고른 글(#sel)·그림에서 고른 상자(#area).
// 글만 복사해 보내면 참모는 어느 문서의 어디인지 모른다 → 경로·줄·제목·상자를 칩에 같이 싣는다.
// 받는 쪽 꼴: #sel1 "<파일>:<줄>[-<끝 줄>]" + [참조 #sel1 · …] 인용 블록, #area1 "<파일>" box=x,y,w,h(0~1 비율 — scripts/show --box 와 같다)
import { unquote } from './chat';
import { quotePath } from './drop';
import { mdCells } from './showAt';

/** 그림 속 상자 — 왼쪽·위·너비·높이, 그림 크기에 대한 0~1 비율 */
export type Box = [number, number, number, number];
export type Rect = { left: number; top: number; width: number; height: number };

/** 칩 하나 — refBus RefAsk 에 그대로(label 은 받는 입력칸이 매긴다). who = 화면에 보이는 짧은 이름(파일:줄·파일),
 *  head = 참모에게 가는 인용 머리(파일:줄 · 제목) — 화면엔 글을 늘리지 않는다(11-13 사용자 "텍스트 많은 거 싫어") */
export type AskChip = { kind: 'sel' | 'area'; who: string; head?: string; text: string; at: string };

const nameOf = (p: string) => p.split(/[\\/]/).pop() || p;
const count = (hay: string, needle: string) => { let n = 0; for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++; return n; };
/** 찾을 글 길이 — 길면 더 정확하지만 원본 표시(탈출 글자 등)와 어긋날 수 있어 짧게 한 번 더 */
const NEEDLES = [40, 12];
const cut = (s: string, n: number, tail: boolean) => { const cs = [...s]; return (tail ? cs.slice(-n) : cs.slice(0, n)).join(''); };

/** 원본 md 에서 화면 글 기준 nth 번째(0부터) needle 이 든 줄(1부터) */
function lineOfNth(src: string, needle: string, nth: number): number | null {
  const lines = src.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const c = count(mdCells(lines[i]!).join(' '), needle);
    if (seen + c > nth) return i + 1;
    seen += c;
  }
  return null;
}

/** 줄(1부터) 위로 가장 가까운 md 제목(그 줄 포함) — 코드 칸 속 # 줄은 빼고, 표시(굵게 등)는 뺀 글 */
export function headingAbove(src: string, line: number): string | undefined {
  const lines = src.split('\n');
  let fence = false;
  let found: string | undefined;
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence && /^#{1,6}\s+\S/.test(l)) found = mdCells(l).join(' ') || found;
  }
  return found;
}

/**
 * 편집기에서 고른 글 → 원본 md 의 줄. picked = 고른 글(블록 사이 \n), before = 문서 처음부터 고른 곳 앞까지의 화면 글(같은 꼴).
 * 같은 글이 여러 번 나오면 before 에 나온 수로 몇 번째인지 가린다(showAt lineNeedle 의 반대)
 */
export function pickSpot(src: string, picked: string, before: string): { line?: number; lineEnd?: number; heading?: string } {
  const raw = picked.split('\n');
  const ls = raw.map((l) => l.trim()).filter(Boolean);
  if (!ls.length) return {};
  // 앞 글(hay) 안에 그 글이 몇 번 나왔나로 몇 번째인지 — back = 고른 곳 자기 자신까지 hay 에 든 수
  const find = (tries: { nd: string; hay: string; back: number }[]) => {
    for (const t of tries) {
      const at = lineOfNth(src, t.nd, Math.max(0, count(t.hay, t.nd) - t.back));
      if (at) return at;
    }
    return null;
  };
  const first = ls[0]!;
  const firstRaw = raw.find((l) => l.trim())!;
  const lead = picked.slice(0, picked.indexOf(firstRaw) + firstRaw.length);
  // 시작 — 첫 줄 앞 40자·12자, 앞쪽이 원본 표시(\* 같은 탈출)와 어긋나면 첫 줄 끝 12자
  const line = find([...NEEDLES.map((n) => ({ nd: cut(first, n, false), hay: before, back: 0 })), { nd: cut(first, NEEDLES[1]!, true), hay: before + lead, back: 1 }]);
  if (!line) return {};
  // 끝 줄 — 마지막 줄 끝 글이 '앞 글 + 고른 글' 안에서 마지막으로 나온 자리
  const end = ls.length > 1 ? find(NEEDLES.map((n) => ({ nd: cut(ls[ls.length - 1]!, n, true), hay: before + picked, back: 1 }))) : null;
  const heading = headingAbove(src, line);
  return { line, ...(end && end > line ? { lineEnd: end } : {}), ...(heading ? { heading } : {}) };
}

/** 문서 고른 곳 칩 — at = "경로:줄[-끝]"(scripts/show 에 그대로), who = 파일:줄, head = 파일:줄 · 제목(인용 머리), text = 고른 글 */
export function selRef(path: string, src: string, picked: string, before: string): AskChip {
  const s = pickSpot(src, picked, before);
  const lines = s.line ? `:${s.line}${s.lineEnd ? `-${s.lineEnd}` : ''}` : '';
  const who = `${nameOf(path)}${lines}`;
  return { kind: 'sel', who, head: `${who}${s.heading ? ` · ${s.heading}` : ''}`, text: picked.trim(), at: quotePath(`${path}${lines}`) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** 이보다 작게 끌면(누르기·손 떨림) 상자로 안 친다 */
const MIN_PX = 6;

/** 끈 두 점(화면 좌표) → 그림 비율 상자. 그림 밖은 가장자리에서 자르고, 너무 작으면 null */
export function boxOf(a: { x: number; y: number }, b: { x: number; y: number }, img: Rect): Box | null {
  if (img.width <= 0 || img.height <= 0) return null;
  const x1 = clamp01((Math.min(a.x, b.x) - img.left) / img.width);
  const x2 = clamp01((Math.max(a.x, b.x) - img.left) / img.width);
  const y1 = clamp01((Math.min(a.y, b.y) - img.top) / img.height);
  const y2 = clamp01((Math.max(a.y, b.y) - img.top) / img.height);
  if ((x2 - x1) * img.width < MIN_PX || (y2 - y1) * img.height < MIN_PX) return null;
  // 끝점을 따로 반올림하고 뺀다 — x+w 가 1 을 넘거나 0.30000000000000004 같은 찌꺼기가 안 생기게
  return [r3(x1), r3(y1), r3(r3(x2) - r3(x1)), r3(r3(y2) - r3(y1))];
}

/** 상자 글 — x,y,w,h(scripts/show --box 와 같은 꼴) */
export const boxText = (b: Box) => b.map((v) => String(v)).join(',');

/** 비율 상자 → 그림 위 화면 자리(px) */
export const boxPx = (b: Box, img: Rect) => ({ left: img.left + b[0] * img.width, top: img.top + b[1] * img.height, width: b[2] * img.width, height: b[3] * img.height });

/** 그림 상자 칩 — at = "경로" box=x,y,w,h, who = 파일 이름 */
export function areaRef(path: string, box: Box): AskChip {
  const b = boxText(box);
  return { kind: 'area', who: nameOf(path), text: `box=${b}`, at: `${quotePath(path)} box=${b}` };
}

/** 칩 자리 글("경로" box=x,y,w,h) → 경로·상자. #sel 자리·깨진 상자(네 값 아님·그림 밖)는 null — 입력칸 칩에 상자 부분 그림을 그릴 때 */
export function areaOf(at: string | undefined): { path: string; box: Box } | null {
  const m = at?.match(/^"((?:\\.|[^"\\])*)" box=([\d.,]+)$/);
  if (!m) return null;
  const b = m[2]!.split(',').map(Number);
  if (b.length !== 4 || b.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || b[2]! <= 0 || b[3]! <= 0 || b[0]! + b[2]! > 1.001 || b[1]! + b[3]! > 1.001) return null;
  return { path: unquote(m[1]!), box: b as Box };
}

/** 상자 부분만 보이는 작은 그림 — 높이를 맞추고 상자 모양 그대로(그림 크기 nat 로 비율), 너비는 20~64px(넘치면 가로 가운데).
 *  w·h = 보이는 칸, img = 그 칸 안에 놓을 그림 크기·자리(px) */
export function cropOf(b: Box, nat: { w: number; h: number }, height: number) {
  const s = height / Math.max(1e-6, b[3] * nat.h);
  const bw = b[2] * nat.w * s;
  const w = Math.round(Math.min(64, Math.max(20, bw)));
  const width = nat.w * s, tall = nat.h * s;
  const r = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 = -0 을 0 으로
  return { w, h: height, img: { width: r(width), height: r(tall), left: r(-b[0] * width + (w - bw) / 2), top: r(-b[1] * tall) } };
}
