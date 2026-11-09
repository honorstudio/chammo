// 터미널을 보여 주지 않고 명령을 돌린다 — 첫 설치의 설치·로그인. 앱 터미널과 같은 PTY(대화형을 바라는 claude auth login 도 돈다), 글은 끝에 이유를 가르려고 받아 둔다
import { closePty, openPty, writePty } from './tauri';

export type Hidden = {
  /** 끝날 때까지. 글(ANSI 그대로) */
  done: Promise<string>;
  stop: () => void;
};

const KEEP = 20_000; // 설치 글이 길어도 뒤쪽만
const ASK = '\x1b[6n';
const ANSWER = '\x1b[1;1R';

/** 윈도우 가짜 콘솔(ConPTY)은 첫 "커서 어디?"(ESC[6n)에 답을 받아야 자식을 띄운다 — 터미널 화면에선 xterm 이 답하지만 여긴 없다(0.4.9 윈도우 실측: 로그인 브라우저가 안 열림). 조각 경계에 걸쳐도 센다 */
export function cursorAsks(tail: string, chunk: string): { asks: number; tail: string } {
  const s = tail + chunk;
  const last = s.lastIndexOf(ASK);
  return { asks: s.split(ASK).length - 1, tail: (last < 0 ? s : s.slice(last + ASK.length)).slice(-(ASK.length - 1)) };
}

export function hiddenRun(command: string): Hidden {
  const dec = new TextDecoder();
  let text = '';
  let id: number | null = null;
  let over = false;
  let askTail = '';
  let unanswered = 0; // 번호를 받기 전에 온 물음
  let finish: (t: string) => void = () => {};
  const done = new Promise<string>((r) => { finish = r; });
  const answer = (n: number) => { for (let i = 0; i < n && id !== null; i++) void writePty(id, ANSWER).catch(() => {}); };
  const end = () => {
    if (over) return;
    over = true;
    if (id !== null) void closePty(id).catch(() => {});
    finish(text);
  };
  openPty(command, undefined, 120, 30, (bytes) => {
    if (!bytes.length) { end(); return; } // 빈 조각 = 끝남(Rust spawn_pty)
    const chunk = dec.decode(bytes, { stream: true });
    text = (text + chunk).slice(-KEEP);
    const c = cursorAsks(askTail, chunk);
    askTail = c.tail;
    if (id === null) unanswered += c.asks;
    else answer(c.asks);
  }).then((n) => {
    id = n;
    if (over) { void closePty(n).catch(() => {}); return; }
    answer(unanswered);
    unanswered = 0;
  }, (e: unknown) => { text = String(e); end(); });
  return { done, stop: end };
}
