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
 *  쫓겨난 창까지 다시 붙으면 두 창이 서로 쫓아내며 끝없이 돈다. 이스케이프·공백을 빼고 맞댄다(조각 경계·색 코드).
 *  그 문장이 새로 완성된 조각에서만 true — 본 뒤엔 꼬리를 비워 같은 문장으로 다시 켜지지 않는다. 쫓겨남인지는 끝날 때 kickedBeforeEnd 로 */
export function kickWatcher(): (chunk: string) => boolean {
  let tail = '';
  return (chunk) => {
    tail = (tail + chunk).slice(-KEEP);
    if (!tail.replace(ESC, '').replace(/\s+/g, '').includes('Sessionopenedinanotherwindow')) return false;
    tail = '';
    return true;
  };
}

/** 쫓겨난 attach 는 그 문장을 찍고 곧 끝난다 — 끝나기 이만큼 안에 본 것만 쫓겨남 */
export const KICK_WINDOW = 5_000;

/** attach 가 끝났을 때 쫓겨남이었나 — 대화 화면에 그 문장이 그려진 적이 있을 뿐이면(그 문자열을 고치거나 출력한 세션) 아니다.
 *  칸 수명 내내 한 번만 봐도 영구로 쫓겨남으로 쳐서, 나중에 남의 respawn 으로 끝나면 다시 안 붙었다(0.3.6 리뷰) */
export function kickedBeforeEnd(kickedAt: number | null, endedAt: number): boolean {
  return kickedAt != null && endedAt - kickedAt <= KICK_WINDOW;
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
/** 목록을 못 읽는(alive null) 동안 끊김으로 안 굳히는 최대 */
export const UNLISTED_MAX = 5 * 60_000;

/** live 세션 화면이 옴 · attaching 붙었는데 아직 Claude Code 안내 줄뿐(attachPhaseWatcher) · reattaching 끊겨서 목록을 보며 다시 붙을 때 기다림 · gone 끊김이 굳음 */
export type LinkState = 'live' | 'attaching' | 'reattaching' | 'gone';

/** 채팅이 칸에 칠 때 — 끊김이 굳었으면 실패, 다만 다른 창에 쫓겨난 끊김(윈도우 세션당 한 창)은 세션이 살아 있으니 되찾아(retake) 보낸다.
 *  예전엔 쫓겨나면 영영 'gone' 이라 터미널 뷰를 열어 칸이 새로 붙을 때까지 말이 하나도 안 갔다(2026-10-30 윈도우 '다시 보내도 안 감', 시험 PC 재현 0/3) */
export const sendOnLink = (link: LinkState | undefined, kicked: boolean): 'go' | 'retake' | 'fail' =>
  link !== 'gone' ? 'go' : kicked ? 'retake' : 'fail';

/** 끊긴 뒤 한 번 볼 때마다 — 앱이 끈 세션이면 그만(stopped), 살아 있으면 다시 붙고, 아니면 기다리다 오래되면 끊김으로(그래도 계속 본다).
 *  stoppedByApp = 앱이 끈·지운 세션인가(Rust app_stopped_recently), null = 못 읽음(모름) — 꺼진 세션에 attach 하면 다시 켜지니 붙지 않고,
 *  영구 포기도 않고 다음 차례에 다시 묻는다(못 읽은 걸 '앱이 껐다'로 쳐서 영영 안 붙었다, 0.3.6 리뷰) */
export function linkStep(o: { alive: boolean | null; stoppedByApp: boolean | null; since: number; now: number }): 'attach' | 'wait' | 'gone' | 'stopped' {
  if (o.stoppedByApp) return 'stopped';
  // 목록을 못 읽음(맥이 바빠 claude agents 가 10초를 넘김) — 꺼진 게 아니다. 끊김으로 굳히면 보낸 말이 바로 '전달 안 됨'이 됐다(2026-10-26 부팅 직후).
  // 다만 영영 못 읽으면(옛 claude·로그인 풀림) 말이 끝없이 줄에 묶이니 UNLISTED_MAX 까지만
  if (o.alive === null && o.now - o.since < UNLISTED_MAX) return 'wait';
  if (o.alive && o.stoppedByApp === false) return 'attach';
  return o.now - o.since > REATTACH_GIVE_UP ? 'gone' : 'wait';
}

// 세션 화면 전에 attach 가 찍는 안내 줄(2.1.310 데몬 attach — 2026-10-27 일꾼을 SIGSTOP 하고 실측, .shots/boot-storm/attach-stall.bin).
// 화면이 안 그려지면 데몬이 5~12초 뒤 '응답 없음'으로 그 세션을 죽였다 다시 켠다(attach stall respawn, 두 번까지 — 세 번째는 끈다).
// 첫 글자를 '붙음'으로 쳤더니 이 줄만 떠 있는 동안 채팅 말을 쳐서, 다시 켜질 때 그 말이 날아갔다

/** 붙는 단계 — queued 앱이 차례를 기다림(domain/busyGate) · attaching 붙는 중 · starting 세션이 켜지는 중 · restarting 응답 없어 데몬이 다시 켬 · stalled 계속 멈춰 데몬이 끔 · ready 세션 화면이 옴 */
export type AttachPhase = 'queued' | 'attaching' | 'starting' | 'restarting' | 'stalled' | 'ready';

const NOTES: [string, AttachPhase][] = [
  ['Session keeps stalling at startup', 'stalled'],
  ['Session not responding \u2014 restarting it\u2026', 'restarting'],
  ['Session is starting \u2014 it will appear once ready', 'starting'],
  ['Waiting for session to redraw\u2026', 'attaching'],
  ['Attaching\u2026', 'attaching'],
];
// eslint-disable-next-line no-control-regex
const APC = /\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** 안내 줄 뒤에 이만큼 글자가 보이면 세션 화면 — 안내 줄은 한 줄, 진짜 화면은 배너·입력칸만 해도 수백 자 */
export const READY_CHARS = 40;
/** 안내 줄을 다 빼고도 이만큼 글자가 왔으면 화면 — 안내 줄이 화면 뒤에 다시 그려져도(윈도우 ConPTY) 갇히지 않게 */
export const BULK_CHARS = 400;
const visibleLen = (t: string) => [...t.replace(/Ctrl\+Z to detach|\^\[\[[IO]/g, '').replace(/\s+/g, '')].length;

/** 보이는 글 끝이 안내 줄의 앞토막이면 그 길이(조각 경계에 걸친 'Attach') */
const notePrefixAt = (t: string) => {
  let n = 0;
  for (const [note] of NOTES) for (let k = Math.min(note.length - 1, t.length); k >= 3; k--) if (t.endsWith(note.slice(0, k))) { n = Math.max(n, k); break; }
  return n;
};

/** attach 출력을 이어 받아 단계가 바뀌면 그 단계, 아니면 null. ready 를 한 번 내면 그 뒤로는 안 본다(대화 화면에 같은 문장이 그려져도) */
export function attachPhaseWatcher(): (chunk: string) => AttachPhase | null {
  let raw = '';
  let phase: AttachPhase | null = null;
  return (chunk) => {
    if (phase === 'ready') return null;
    raw = (raw + chunk).slice(-8000);
    const vis = raw.replace(APC, '').replace(ESC, '');
    let at = -1;
    let found: AttachPhase | null = null;
    for (const [note, ph] of NOTES) {
      const i = vis.lastIndexOf(note);
      if (i >= 0 && i + note.length > at) { at = i + note.length; found = ph; }
    }
    let rest = at >= 0 ? vis.slice(at) : vis;
    rest = rest.slice(0, rest.length - notePrefixAt(rest));
    const bulk = visibleLen(NOTES.reduce((t, [note]) => t.split(note).join(''), vis));
    const next = visibleLen(rest) >= READY_CHARS || bulk >= BULK_CHARS ? 'ready' : found ?? (at < 0 && vis.trim() ? 'attaching' : phase);
    if (next === phase) return null;
    phase = next;
    return next;
  };
}
