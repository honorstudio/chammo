// 터미널에 파일 끌어다 놓기 — iTerm 처럼 경로를 셸 이스케이프해서 입력칸에 넣는다.
// Claude Code 는 붙여넣은 글자를 ' /' 앞에서 경로별로 자르고 \x → x 로 풀어서, 이미지 확장자면 [Image #n] 으로 읽는다(2.1.283 실측)

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
