// macOS 알림 정책 — 사용자 2026-09-27 "너무 쓸데없이 많이 쌓이고 부정확하다, 필요한 것만".
// Claude Code 전역 훅 알림은 껐고, 알림은 앱만 보낸다. 보내는 것:
//   결정 대기(task ask·로그인 오류) · 참모가 묻거나 확인창에서 멈춤 · 권한 창 자동 허용 실패 · 참모 컨텍스트 80% · 계정 다 소진·자동 전환 실패
// 안 보내는 것: 하위 세션 '끝났어'(한 턴만 끝나도 떠서 부정확 — 결과는 참모가 정리해 전한다), 다마고치 업적(앱 안에만)
import { tr } from '../i18n';

export type NoteKind = 'decide' | 'login' | 'allowFail' | 'asks' | 'blocked' | 'ctx' | 'accounts' | 'human';
/** session = 알림을 묶는 단위(세션 id 등). orch = 참모 세션에서 난 일인가 */
export type Note = { kind: NoteKind; session: string; orch: boolean; title: string; body: string };

export const NOTIFY_GAP_MS = 2 * 60_000;

/** 물어봄·확인창·컨텍스트는 참모 세션만 — 하위 세션은 참모가 관리한다 */
export const wants = (kind: NoteKind, orch: boolean) =>
  kind === 'decide' || kind === 'login' || kind === 'allowFail' || kind === 'accounts' || kind === 'human' || orch;

/** 참모 창을 보고 있을 때도 맥 알림을 보낼까 — 물어봄·확인창·결정·로그인 오류는 앱 안(알림 띠·결정 대기 드롭다운)에 뜨니
 *  보고 있으면 맥 알림은 겹친다(2026-10-03 사용자 "참모를 보고 있으면 네이티브에선 안 와도"). 나머지는 앱 안에 따로 안 떠서 보낸다 */
export const nativeWhenFocused = (kind: NoteKind) => !(kind === 'asks' || kind === 'blocked' || kind === 'decide' || kind === 'login' || kind === 'human'); // human = 세션 브라우저가 사람을 부름 — 앱 안에 크게 보기 모달이 뜬다

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

/** 알림을 누르면 갈 곳 — macOS 알림(userInfo)에 글자로 실어 보냈다가 눌리면 돌려받는다 */
export type NoteTarget = { to: 'inbox' } | { to: 'session'; id: string };

export const noteTarget = (n: Note) => (n.kind === 'decide' || n.kind === 'login' ? 'inbox' : `session:${n.session}`);

export function readNoteTarget(s: string): NoteTarget | null {
  if (s === 'inbox') return { to: 'inbox' };
  const id = s.startsWith('session:') ? s.slice('session:'.length) : '';
  return id ? { to: 'session', id } : null;
}
