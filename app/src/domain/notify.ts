// macOS 알림 정책 — 사용자 2026-09-27 "너무 쓸데없이 많이 쌓이고 부정확하다, 필요한 것만".
// Claude Code 전역 훅 알림은 껐고, 알림은 앱만 보낸다. 보내는 것:
//   결정 대기(task ask·로그인 오류) · 참모가 묻거나 확인창에서 멈춤 · 권한 창 자동 허용 실패 · 참모 컨텍스트 80% · 계정 다 소진·자동 전환 실패 ·
//   재시작으로 꺼진 세션을 참모에게 세 번 못 알림(useLostTriage — 안 보내면 아무도 모른다)
// 안 보내는 것: 하위 세션 '끝났어'(한 턴만 끝나도 떠서 부정확 — 결과는 참모가 정리해 전한다), 다마고치 업적(앱 안에만)
import { tr } from '../i18n';

export type NoteKind = 'decide' | 'login' | 'allowFail' | 'asks' | 'blocked' | 'ctx' | 'accounts' | 'human' | 'lost';
/** session = 알림을 묶는 단위(세션 id 등). orch = 참모 세션에서 난 일인가. go = 누르면 갈 곳을 따로 정할 때(noteTarget 글자) */
export type Note = { kind: NoteKind; session: string; orch: boolean; title: string; body: string; go?: string };

export const NOTIFY_GAP_MS = 2 * 60_000;

/** 물어봄·확인창·컨텍스트는 참모 세션만 — 하위 세션은 참모가 관리한다 */
export const wants = (kind: NoteKind, orch: boolean) =>
  kind === 'decide' || kind === 'login' || kind === 'allowFail' || kind === 'accounts' || kind === 'human' || kind === 'lost' || orch;

/** 참모 창을 보고 있을 때도 맥 알림을 보낼까 — 물어봄·확인창·결정·로그인 오류는 앱 안(알림 띠·결정 대기 드롭다운)에 뜨니
 *  보고 있으면 맥 알림은 겹친다(2026-10-03 사용자 "참모를 보고 있으면 네이티브에선 안 와도"). 나머지는 앱 안에 따로 안 떠서 보낸다 */
// ctx = 대화가 찼다 — 보고 있으면 보관함 아래 활동 줄 끝에 조용히 뜬다(알림 N1 '소식은 제자리', 2026-10-11)
export const nativeWhenFocused = (kind: NoteKind) => !(kind === 'asks' || kind === 'blocked' || kind === 'decide' || kind === 'login' || kind === 'human' || kind === 'ctx'); // human = 세션 브라우저가 사람을 부름 — 앱 안에 크게 보기 모달이 뜬다

export const noteKey = (n: Note) => `${n.session}|${n.kind}`;

/** 정책이 원하고, 본문이 있고, 같은 세션·같은 종류를 2분 안에 보내지 않았으면 */
export function shouldNotify(n: Note, last: ReadonlyMap<string, number>, now: number): boolean {
  if (!wants(n.kind, n.orch) || !n.body.trim()) return false;
  const at = last.get(noteKey(n));
  return at === undefined || now - at >= NOTIFY_GAP_MS;
}

/** waitingFor(Claude Code 가 주는 값 — 그대로 열쇠) → 보여 줄 이름 */
const waitingLabel = (w?: string): string => {
  switch (w) {
    case 'permission prompt': return tr('권한 창', 'a permission prompt');
    case 'input needed': return tr('선택지 질문', 'a choice question');
    case 'startup prompt': return tr('시작 확인 창', 'a startup prompt');
    default: return tr('확인창', 'a prompt');
  }
};

/** 확인창 알림 본문 — 대화 기록의 옛 답 대신 무엇에 멈췄는지 */
export const blockedBody = (waitingFor?: string) => tr(`${waitingLabel(waitingFor)}에서 멈췄어`, `Stopped at ${waitingLabel(waitingFor)}`);

// ── 자리 비움(2026-10-24 사용자가 밖에서 놓침) ──
// 맥 창을 앞에 둔 채 자리를 비우면 '보고 있음'으로 쳐서 사람 필요 알림이 맥 알림도 폰 푸시도 안 나갔다.
// 보고 있어 건너뛴 사람 필요 알림은 잠깐 붙들고, 맥 입력(키보드·마우스)이 그 뒤로 없거나 화면이 잠기면 보낸다

/** 이만큼 맥 입력이 없으면 자리 비움(초) */
export const AWAY_SECS = 150;
/** 붙든 알림을 이보다 오래 들고 있지 않는다(초) — 오래된 부름을 뒤늦게 울리지 않게 */
export const HOLD_MAX_SECS = 30 * 60;
/** 자리 비움이면 폰으로도 보낼 사람 필요 알림 — 사람 부르기·직접 카드(human)·결정·물어봄·로그인. 컨텍스트·확인창 같은 건 앱 안만 */
export const awayPush = (kind: NoteKind) => kind === 'human' || kind === 'decide' || kind === 'asks' || kind === 'login';
/** 맥 입력 상태 — idle = 마지막 입력 뒤 초(모르면 null: 윈도우·읽기 실패), locked = 화면 잠김 */
export type Idle = { idle: number | null; locked: boolean };

/**
 * 붙든 알림 하나(age = 붙든 지 초) — send 보낸다 · drop 버린다 · wait 더 본다.
 * 잠김이면 보냄. 알림이 온 뒤 입력이 있었으면(idle < age) 사람이 맥 앞에서 앱 안 카드를 본 것 — 버림. 입력을 모르면 지금처럼 앱 안만
 */
export function awayStep(age: number, s: Idle): 'send' | 'drop' | 'wait' {
  if (age > HOLD_MAX_SECS) return 'drop';
  if (s.locked) return 'send';
  if (s.idle === null || s.idle < age) return 'drop';
  return s.idle >= AWAY_SECS ? 'send' : 'wait';
}

export type Held = { n: Note; at: number };
export function heldStep(held: Held[], now: number, s: Idle): { send: Note[]; keep: Held[] } {
  const send: Note[] = [];
  const keep: Held[] = [];
  for (const h of held) {
    const d = awayStep(Math.max(0, (now - h.at) / 1000), s);
    if (d === 'send') send.push(h.n);
    else if (d === 'wait') keep.push(h);
  }
  return { send, keep };
}

/** 알림을 누르면 갈 곳 — macOS 알림(userInfo)·폰 푸시(target)에 글자로 실어 보냈다가 눌리면 돌려받는다.
 *  card = 그 참모 채팅의 그 카드(카드 열쇠는 폰 dashList 와 같은 w:<일 id>·d:<카드 id>), team = 팀 대화(team_alert),
 *  latest = 갈 곳을 모르는 알림(중계 입구 푸시는 본문이 없다) — 컴퓨터에 마지막 알림 갈 곳을 묻는다 */
export type NoteTarget = { to: 'inbox' } | { to: 'session'; id: string } | { to: 'card'; orch: string; card: string } | { to: 'team'; room: string } | { to: 'latest' };

export const cardTarget = (orch: string, card: string) => `card:${orch}:${card}`;

export const noteTarget = (n: Note) => n.go ?? (n.kind === 'decide' || n.kind === 'login' ? 'inbox' : `session:${n.session}`);

export function readNoteTarget(s: string): NoteTarget | null {
  if (s === 'inbox' || s === 'latest') return { to: s };
  const [head, ...rest] = s.split(':');
  const tail = rest.join(':');
  if (head === 'session') return tail ? { to: 'session', id: tail } : null;
  if (head === 'team') return tail ? { to: 'team', room: tail } : null;
  if (head !== 'card') return null;
  const [orch, ...card] = rest;
  const key = card.join(':');
  return orch && key && card[1] ? { to: 'card', orch, card: key } : null;
}

/** 참모 창을 보고 있나 — 맥은 웹 값(문서 포커스·안 숨김) 그대로. 윈도우 WebView2 는 최소화·다른 창 앞이어도 hasFocus()=true·hidden=false 라
 *  Rust 창 상태(main_watched: 보임·최소화 아님·앞)만 본다. 못 물었으면(null) 안 보는 것으로 — 알림을 놓치느니 한 번 더 */
export function watching(win: boolean, doc: { focus: boolean; hidden: boolean }, main?: boolean | null): boolean {
  if (!win) return doc.focus && !doc.hidden;
  return main === true;
}
