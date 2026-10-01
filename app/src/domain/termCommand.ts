// 세션 화면을 여는 터미널 명령 — 맥은 로그인 셸(zsh -lc)에 넘겨 exec 로 claude 가 되게, 윈도우는 cmd /C 가 읽는 모양(윈도우판 3단계)
import { IS_WIN } from './reader';

export function attachCommand(bin: string, id: string, win = IS_WIN): string {
  if (win) return `"${bin}" attach ${id}`;
  return `exec '${bin.replace(/'/g, `'\\''`)}' attach ${id}`;
}
