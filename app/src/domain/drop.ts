// 터미널에 파일 끌어다 놓기 — iTerm 처럼 경로를 셸 이스케이프해서 입력칸에 넣는다.
// Claude Code 는 붙여넣은 글자를 ' /' 앞에서 경로별로 자르고 \x → x 로 풀어서, 이미지 확장자면 [Image #n] 으로 읽는다(2.1.283 실측)
import { kindOf } from './reader';

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

export type PaneRect = { id: string; left: number; top: number; right: number; bottom: number };

/** 점(창 안 좌표)이 들어 있는 칸. 경계는 오른쪽·아래 끝을 빼서 한 칸만 잡히게, 겹치면 나중 것(위에 그려진 것) */
export function paneAt(panes: PaneRect[], x: number, y: number): string | null {
  for (let i = panes.length - 1; i >= 0; i--) {
    const p = panes[i]!;
    if (x >= p.left && x < p.right && y >= p.top && y < p.bottom) return p.id;
  }
  return null;
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
