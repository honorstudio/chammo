// 터미널 보기(claude attach)가 끊겼을 때 — 세션은 살아 있는데 보기만 죽는 일이 있다.
// 2026-10-21 사용자: 다른 참모가 `claude respawn` 하자 붙어 있던 attach 는 "Session … has exited." 를 찍고 끝났고, 세션은 새 일꾼으로
// 계속 돌았다. 앱은 그 죽은 보기에 채팅 글을 쳐서 '보내는 중'으로 남았다. 끊김을 알아보고, 살아 있으면 다시 붙는다(ui/TerminalPane).
// 꺼진 세션에 attach 하면 그 세션을 다시 켜 버린다(실측) — 목록에서 살아 있는 걸 본 뒤에만 붙는다

/** 터미널 보기 명령의 세션 번호 — `exec '<claude>' attach <id>`·`"<claude>" attach <id>`(domain/termCommand attachCommand) */
export function attachedId(command: string): string | null {
  const m = command.match(/ attach ([0-9A-Za-z_-]+)\s*$/);
  return m ? m[1]! : null;
}

/** CSI·OSC·문자 집합(ESC ( B)·그 밖의 두 글자(ESC 7·ESC 8 커서 저장·복원 — 실제 끝 줄 바로 앞에 붙는다), 그리고 줄바꿈 말고 제어 문자(\x0f 등) */
// eslint-disable-next-line no-control-regex
const ESC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[ -/]+[0-~]|\x1b[0-~]|[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g;
const KEEP = 600;

/** attach 출력을 이어 받아 그 세션이 끝났다는 줄이 나오면 한 번 true. 문장이 줄 머리에 있을 때만 — 대화 화면에 같은 말이 그려진 건 아니다 */
export function exitWatcher(id: string): (chunk: string) => boolean {
  const short = id.slice(0, 8).replace(/[^0-9A-Za-z_-]/g, '');
  const done = new RegExp(`(?:^|[\\r\\n])Session ${short} has exited\\.`);
  let tail = '';
  let fired = false;
  return (chunk) => {
    if (fired) return false;
    tail = (tail + chunk).slice(-KEEP);
    if (!done.test(tail.replace(ESC, ''))) return false;
    fired = true;
    return true;
  };
}

/** 윈도우: 같은 세션에 다른 창이 붙어 쫓겨났나(attach 가 'Session opened in another window' 를 찍고 끝남, pty.rs KICKED) —
 *  쫓겨난 창까지 다시 붙으면 두 창이 서로 쫓아내며 끝없이 돈다. 이스케이프·공백을 빼고 맞댄다(조각 경계·색 코드) */
export function kickWatcher(): (chunk: string) => boolean {
  let tail = '';
  return (chunk) => {
    tail = (tail + chunk).slice(-KEEP);
    return tail.replace(ESC, '').replace(/\s+/g, '').includes('Sessionopenedinanotherwindow');
  };
}

/** `claude agents --json` 에 그 세션이 살아 있나 — 산 줄은 pid·status 가 있다. 못 읽으면 null(모름) */
export function listedAlive(agentsJson: string, id: string): boolean | null {
  let v: unknown;
  try { v = JSON.parse(agentsJson); } catch { return null; }
  const rows = Array.isArray(v) ? v : (v as { agents?: unknown })?.agents;
  if (!Array.isArray(rows)) return null;
  const r = rows.find((x: { id?: string; sessionId?: string }) => x?.id === id || (!!x?.sessionId && x.sessionId.startsWith(id)));
  return !!r && (r.pid != null || r.status != null);
}

/** 이만큼 지나도 안 돌아오면 끊김(gone) — 채팅의 보낸 말이 바로 '전달 안 됨'으로. 참모 다시 켜기(orchRevive)는 10초 기다렸다 respawn 하니 그보다 넉넉히 */
export const REATTACH_GIVE_UP = 90_000;
/** 끊긴 보기가 목록을 다시 보는 간격 */
export const REATTACH_POLL = 2500;

export type LinkState = 'live' | 'reattaching' | 'gone';

/** 끊긴 뒤 한 번 볼 때마다 — 살아 있으면 다시 붙고, 아니면 기다리다 오래되면 끊김으로(그래도 계속 본다) */
export function linkStep(o: { alive: boolean | null; since: number; now: number }): 'attach' | 'wait' | 'gone' {
  if (o.alive) return 'attach';
  return o.now - o.since > REATTACH_GIVE_UP ? 'gone' : 'wait';
}
