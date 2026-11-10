// 터미널에 파일 끌어다 놓기 — iTerm 처럼 경로를 셸 이스케이프해서 입력칸에 넣는다.
// Claude Code 는 붙여넣은 글자를 ' /' 앞에서 경로별로 자르고 \x → x 로 풀어서, 이미지 확장자면 [Image #n] 으로 읽는다(2.1.283 실측)
import { kindOf } from './reader';
import { tr } from '../i18n';

const SPECIAL = /[\s\\'"$!&;*?[\]{}()|<>#~^`]/g;

/** 경로 하나를 셸 이스케이프. 줄바꿈 같은 제어 문자가 섞이면 $'…' (그대로 넣으면 입력칸에서 Enter 로 먹힌다) */
export function shellEscape(path: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(path)) {
    const inner = path
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    return `$'${inner}'`;
  }
  return path.replace(SPECIAL, (c) => `\\${c}`);
}

/** 드롭한 경로들 → 입력칸에 넣을 글자. 여러 개는 공백으로, 끝에 공백 하나(이어서 쓰기 좋게) */
export const dropText = (paths: string[]) => (paths.length ? `${paths.map(shellEscape).join(' ')} ` : '');

/** 경로 하나를 큰따옴표로 — 안의 \ 와 " 는 앞에 \, 줄바꿈 같은 제어 문자는 \n·\xNN(그대로 넣으면 입력칸에서 Enter 로 먹힌다) */
export function quotePath(path: string): string {
  const inner = path
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `"${inner}"`;
}

/** 폴더 칩 — 경로 끝 / 가 폴더 표시(칩 아이콘, 참모가 읽는 따옴표 경로 둘 다). 보관함·팀 보관함 머리줄 '이 폴더 보내기'가 붙인다(2026-10-30 사용자) */
export const folderChip = (p: string) => (p.endsWith('/') ? p : `${p}/`);
export const isFolderChip = (p: string) => p.length > 1 && p.endsWith('/');
/** 칩 이름 — 폴더(끝 /)도 마지막 이름 */
export const chipName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** Claude Code 가 붙여넣은 경로를 [Image #n] 으로 바꾸는 확장자(2.1.303) */
const CLAUDE_IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * 채팅에 붙인 칩(#img·#file) → 터미널 입력칸에 붙여넣을 글 조각들(조각마다 따로 붙여넣는다).
 * 폴더·문서는 이름표 바로 뒤 따옴표 경로(`#file1 "…/보고 폴더"`) — 띄어쓰기를 \ 로 펼치면 바로 뒤 사람 글과 경계가 안 보여
 * 참모가 '보고 폴더 보낼 파일'이라는 새 폴더를 만들었다(2026-10-19 사용자).
 * Claude 가 읽는 그림은 지금처럼 이스케이프 경로만 앞 조각에 모은다 — Claude 는 붙여넣은 글을 ' /' 앞에서만 잘라 그림을 알아봐서
 * 따옴표로 묶거나 이름표를 사이에 섞으면 [Image #n] 으로 안 바뀐다(바뀐 뒤엔 [Image #n] 이 경계라 문제없다)
 */
export function chipPastes(items: { path: string; label?: string; from?: string }[], win = false): string[] {
  // 윈도우 Claude(2.1.319 실측)는 붙여넣은 그림 경로를 어떤 꼴(그대로·\\·따옴표·/)로도 [Image #n] 으로 안 바꾼다 — 이스케이프 경로만 덩그러니
  // 남아 #img1 이 어느 그림인지 몰랐다(공개 이슈 #19). 윈도우는 그림도 파일처럼 이름표 + 따옴표 경로로(참모가 경로로 읽는다)
  const asImage = (p: string) => !win && CLAUDE_IMAGE.test(p);
  const imgs = items.filter((i) => asImage(i.path)).map((i) => i.path);
  // 홈 밖 파일의 사본이면 원본도 — 참모가 사본만 고치고 사용자 원본(D:\\Desktop)은 그대로인 걸 모르고 끝냈다(공개 이슈 #19 리뷰)
  const rest = items.filter((i) => !asImage(i.path)).map((i) => `${i.label ? `${i.label} ` : ''}${quotePath(i.path)}${i.from && i.from !== i.path ? ` ${originNote(i.from)}` : ''}`);
  return [dropText(imgs), rest.length ? `${rest.join(' ')} ` : ''].filter(Boolean);
}

export type PaneRect = { id: string; left: number; top: number; right: number; bottom: number };

/** 점(창 안 좌표)이 들어 있는 칸. 경계는 오른쪽·아래 끝을 빼서 한 칸만 잡히게, 겹치면 나중 것(위에 그려진 것) */
export function paneAt(panes: PaneRect[], x: number, y: number): string | null {
  for (let i = panes.length - 1; i >= 0; i--) {
    const p = panes[i]!;
    if (x >= p.left && x < p.right && y >= p.top && y < p.bottom) return p.id;
  }
  return null;
}

/** 채팅 칸 안 어디에 놓든 받을 세션 칸(2026-10-12 사용자 — 입력창까지 안 옮겨도) — 칸 위면 그 칸, 칸 밖(채팅 머리·카드 여백)이면 위아래로 가장 가까운 칸 */
export function chatCellAt(cells: PaneRect[], x: number, y: number): string | null {
  const hit = paneAt(cells, x, y);
  if (hit !== null || !cells.length) return hit;
  const gap = (p: PaneRect) => (y < p.top ? p.top - y : y >= p.bottom ? y - p.bottom : 0);
  return cells.reduce((a, b) => (gap(b) < gap(a) ? b : a)).id;
}

export type DocDropBlock = { path: string; type: 'image' | 'video' | 'audio' | 'file' };

/** 스페이스 문서 편집기에 끌어다 놓은 파일 → 넣을 블록 종류. 그림·영상·소리는 그 블록, 나머지(PDF 등)는 파일 블록(md 엔 링크) — 2026-10-01 사용자 */
export const docDropBlocks = (paths: string[]): DocDropBlock[] => paths.map((path) => {
  const k = kindOf(path);
  return { path, type: k === 'image' || k === 'video' || k === 'audio' ? k : 'file' };
});

export type BlockRect = { id: string; top: number; bottom: number };
export type DropSlot = { id: string; place: 'before' | 'after'; y: number };

/** 문서에 놓을 자리 — y 가 들어 있는 블록(겹치면 안쪽 작은 것)의 위/아래 절반, 빈 곳·여백이면 가장 가까운 블록 가장자리.
 *  정확히 블록 위에 놓아야만 들어가서 불편했다(2026-10-01 사용자) */
export function dropSlot(blocks: BlockRect[], y: number): DropSlot | null {
  const inside = blocks.filter((b) => y >= b.top && y <= b.bottom).sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top))[0];
  if (inside) return y < (inside.top + inside.bottom) / 2 ? { id: inside.id, place: 'before', y: inside.top } : { id: inside.id, place: 'after', y: inside.bottom };
  let best: DropSlot | null = null;
  let dist = Infinity;
  for (const b of blocks) {
    const d = y < b.top ? b.top - y : y - b.bottom;
    if (d < dist) { dist = d; best = y < b.top ? { id: b.id, place: 'before', y: b.top } : { id: b.id, place: 'after', y: b.bottom }; }
  }
  return best;
}

/** 사본 뒤에 붙는 원본 표시 — (원본 "D:\\…"). termRest·staleRefs 가 이 꼴을 안다 */
export const originNote = (from: string): string => `(${tr('원본', 'original')} ${quotePath(from)})`;
/** 입력칸 글에서 원본 표시 찾기(한·영) */
export const ORIGIN_NOTE = /\((?:원본|original)\s*"(?:[^"\\]|\\.)*"\)/g;

/** 사람이 준 파일을 열 수 있는 경로로 바꾼 결과(Rust outside::attach_given) — 홈·허용 폴더 밖이면 <데이터>/attach 사본, 못 하면 이유 */
export type Given = { from: string; path?: string; copied?: boolean; error?: string };

/** attach_given 결과 → 붙일 경로 · 못 붙인 것(이유). 답이 이상하면(옛 앱·실패) 원래 경로 그대로 — 붙이기 자체는 막지 않는다 */
export function splitGiven(asked: string[], got: unknown): { ok: string[]; bad: { from: string; error: string }[] } {
  if (!Array.isArray(got) || got.length !== asked.length) return { ok: asked, bad: [] };
  const ok: string[] = [];
  const bad: { from: string; error: string }[] = [];
  asked.forEach((from, i) => {
    const g = got[i] as Given | null;
    if (g && typeof g.path === 'string' && g.path) ok.push(g.path);
    else if (g && typeof g.error === 'string') bad.push({ from, error: g.error });
    else ok.push(from);
  });
  return { ok, bad };
}

/** 채팅 첨부 사본(<데이터>/attach/<숫자>-이름) — 맥 / · 윈도우 \ 둘 다. 이 파일들만 참모 보관함에도 넣는다(집이 따로 없는 것) */
export const isAttachCopy = (p: string): boolean => /[\\/]attach[\\/]\d+-[^\\/]+$/.test(p);
