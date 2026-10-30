// 결정 대기함 — 참모가 나한테 물은 것만 모은다: 참모 세션의 질문·확인창, 참모가 scripts/task ask 로 올린 결정.
// 로그인 오류로 멈춘 세션은 세션마다 칸을 안 띄운다 — 맨 위 로그인 카드 하나(domain/login, ui/LoginCard)
// 하위 세션이 물은 건 참모한테 한 말이라 뺀다 — 나한테 올릴지는 참모가 정한다(사용자 2026-09-27)
import { tr } from '../i18n';
import type { Activity } from './activity';
import { cardTarget, type Note } from './notify';
import { seenName, type Session } from './session';
import type { ActivityStatus } from './status';
import type { TaskEvent } from './tasks';

export type InboxKind = 'ask' | 'blocked' | 'decide';
export type InboxItem = {
  /** 처리함으로 치울 때 쓰는 열쇠 — 같은 질문이면 같은 열쇠(새 질문이 오면 다시 뜨게) */
  key: string;
  kind: InboxKind;
  /** 어느 프로젝트 이야기인가 — 칸 맨 앞에 크게 */
  project: string;
  /** 그 안에서 어디: worktree 이름, 일 제목 (없으면 '') */
  where: string;
  text: string;
  /** 물음 앞의 결론 한 문장(흐리게) */
  lead?: string;
  ts: string;
  /** 답장·열기 대상 세션(attach id 또는 이름) */
  target?: string;
  taskId?: string;
  /** 답장이 물어본 참모에게 가나(참모 물음·참모가 올린 결정) — 아니면 일을 받은 세션 입력칸 */
  toOrch?: boolean;
  /** 보내기 관문(scripts/task send 종료 3 — '… 보내도 돼?') — 보낼까 단추 둘 */
  gate?: boolean;
};

/** 보내기 관문 카드 — task send 가 결제·위험 지시를 멈추고 올린 '… — 보내도 돼?' */
const GATE = /— (보내도 돼\?|OK to send\?)\s*$/;

/** 답장칸 자리표시 — 실제로 가는 곳과 같게(QA 12: '그 세션 입력칸에 들어가'인데 물은 참모에게 갔다) */
export const replyHint = (i: InboxItem): string =>
  i.toOrch ? tr('답장 — 물어본 참모에게 가요', 'Reply — goes to the assistant who asked') : tr('답장 — 그 세션 입력칸에 들어가요', "Reply — goes into that session's input");

/** 보내기 관문 단추가 참모에게 보내는 답 — 참모는 '결정 대기함에서 사용자 답을 기다려'라고 안내받았다 */
export const gateReply = (ok: boolean): string =>
  ok ? tr('보내도 돼 — 그 일 보내', 'OK to send — go ahead and send it') : tr('보내지 마 — 그 일은 보내지 말고 멈춰', 'Do not send — hold that job');


type Act = { session: Session; status: ActivityStatus; activity: Activity };

/** 기록에 적힌 대상(세션 id·이름·전체 sessionId, 또는 `task send` 가 남기는 "이름 [id 앞자리]")으로 세션 찾기.
 *  세션이 다시 켜져 id 가 바뀌면 이름으로 — 안 그러면 잡은 표시·결정 대기함 프로젝트가 사라졌다(2026-09-30) */
export const findTarget = (sessions: Session[], target?: string): Session | undefined => {
  if (!target) return undefined;
  const exact = sessions.find((x) => x.id === target || x.name === target || x.sessionId === target);
  if (exact) return exact;
  const m = target.match(/^(.+?) \[([0-9a-f]{4,})\]$/);
  if (!m) return undefined;
  const [, name, pre] = m;
  return sessions.find((x) => x.id.startsWith(pre!) || x.sessionId?.startsWith(pre!)) ?? sessions.find((x) => x.name === name);
};

/** sessions: 기록의 대상 세션 → 프로젝트 이름을 찾는 데 쓴다. isOrch: 참모 세션인가(질문·확인창은 참모 것만) */
export function buildInbox(
  activities: Act[],
  events: TaskEvent[],
  dismissed: ReadonlySet<string>,
  sessions: Session[] = [],
  isOrch: (s: Session) => boolean = () => false,
  /** 참모 화면 이름 — 참모 물음·확인창 카드 제목(없으면 폴더 이름, 참모가 여럿이면 누가 묻는지 몰랐다) */
  orchName?: (s: Session) => string,
): InboxItem[] {
  const out: InboxItem[] = [];
  for (const { session: s, status, activity: a } of activities) {
    const ts = a.reply?.ts ?? '';
    const at: { project: string; where: string } = { project: s.project, where: s.workspace ?? '' };
    if (!isOrch(s)) continue;
    const who = orchName?.(s);
    if (who) Object.assign(at, { project: who, where: '' });
    // 물음은 결론 첫 문장(lead) + 마지막 질문(text) — 앞에서 자른 답은 질문이 잘렸다(domain/activity askView)
    if (status === 'asks') out.push({ key: `ask:${s.id}:${ts}`, kind: 'ask', ...at, text: a.reply?.ask?.q || a.reply?.text || '', ...(a.reply?.ask?.lead ? { lead: a.reply.ask.lead } : {}), ts, target: s.id, toOrch: true });
    if (status === 'blocked') out.push({ key: `blocked:${s.id}:${ts}`, kind: 'blocked', ...at, text: tr('확인창에서 멈춰 있어. 열어서 골라줘', 'Waiting on a prompt or choice — open it and pick one'), ts, target: s.id });
  }

  // 일마다 마지막 이벤트가 ask(참모가 scripts/task ask 로 올림)면 결정 대기
  const tasks = new Map<string, { title: string; target: string; last?: TaskEvent }>();
  for (const e of events) {
    if (e.type === 'send') tasks.set(e.task, { title: e.title ?? '', target: e.target ?? '' });
    const t = tasks.get(e.task);
    // 넘기기(own)는 결정의 답이 아니다 — 결제 확인 카드가 handoff 한 번에 답 없이 사라졌다(2026-10-21 리뷰)
    if (t && e.type !== 'send' && e.type !== 'own') t.last = e;
  }
  for (const [id, t] of tasks) {
    const e = t.last;
    if (!e || !e.note) continue;
    if (e.type === 'ask') {
      // 프로젝트는 일을 받은 세션 쪽 — 답장 받을 참모(to)가 아니라
      const project = findTarget(sessions, t.target)?.project ?? seenName(t.target);
      out.push({ key: `task:${id}:${e.ts}`, kind: 'decide', project, where: t.title, text: e.note, ts: e.ts, target: e.to || t.target, taskId: id, toOrch: !!e.to, ...(GATE.test(e.note) ? { gate: true } : {}) });
    }
  }
  return out.filter((i) => !dismissed.has(i.key)).sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/** 답장을 넣어도 되나. 안 되면 이유(null = 괜찮음). 선택지·권한 창에 키 입력이 들어가면 엉뚱한 항목이 골라진다(참모-2 지적 2026-09-27) */
export function replyBlocked(item: InboxItem, sessions: Session[]): string | null {
  const s = findTarget(sessions, item.target);
  if (!s) return tr('세션이 없어 — 꺼진 세션이면 이어서 띄워줘', 'Session not found — if it stopped, resume it first');
  if (s.state === 'blocked') return tr('선택지·확인창에 멈춰 있어서 답장을 넣으면 메뉴가 잘못 골라질 수 있어 — 열어서 직접 골라줘', 'It is waiting on a prompt, so a reply could pick the wrong option — open it and choose yourself');
  return null;
}

/** 결정 알림 — 제목 앞에 물은 참모 별명(폰에선 끝에 홈 화면 앱 이름 'from 참모'가 붙어 누가 물었는지 몰랐다),
 *  누르면 그 참모 채팅의 그 카드(폰 dashList 열쇠 w:<일 id>). 물은 참모를 못 찾으면 예전처럼 결정 대기함 */
export function decideNote(i: InboxItem, sessions: Session[], nameOf: (s: Session) => string): Note {
  const orch = i.toOrch ? findTarget(sessions, i.target) : undefined;
  const who = orch ? nameOf(orch) : '';
  return {
    kind: 'decide', session: i.key, orch: false, body: i.text,
    title: who ? tr(`${who} 결정 대기 — ${i.project}`, `${who}: decision needed — ${i.project}`) : tr(`결정 대기 — ${i.project}`, `Decision needed — ${i.project}`),
    ...(orch && i.taskId ? { go: cardTarget(orch.id, `w:${i.taskId}`) } : {}),
  };
}

/** 지난번 목록(열쇠들) 대비 새로 생긴 항목. 지난번이 없으면(앱을 막 켰을 때) 빈 목록 — 켜자마자 알림 폭탄 방지 */
export function freshItems(prev: ReadonlySet<string> | null, items: InboxItem[]): InboxItem[] {
  return prev ? items.filter((i) => !prev.has(i.key)) : [];
}

/** 앱을 켠 뒤에 생긴 결정인가 — 켤 때 목록이 늦게 채워져 옛 결정이 전부 '새 것'으로 알림이 갔다. 시각을 못 읽으면 참 */
export const bornAfter = (i: InboxItem, sinceMs: number): boolean => !(Date.parse(i.ts) < sinceMs);

/** 종 아래 결정 드롭다운을 펼칠지. 결정이 들어오면 펼치고, 사용자가 닫으면("나중에") 다음 새 결정이 올 때까지 접어 둔다.
 *  hold = 설정 창이 떠 있다(그 위를 덮었다), askInView = 채팅 뷰라 참모 물음(ask)은 이미 채팅에 보인다 — 둘 다 새로 펼치지는 않는다(2026-10-22 QA 21) */
export function popoverOpen(wasOpen: boolean, prev: ReadonlySet<string> | null, items: InboxItem[], opts: { hold?: boolean; askInView?: boolean } = {}): boolean {
  if (items.length === 0) return false;
  if (opts.hold) return wasOpen;
  const pulls = (xs: InboxItem[]) => xs.some((i) => !(opts.askInView && i.kind === 'ask'));
  if (prev === null) return pulls(items);
  return pulls(freshItems(prev, items)) || wasOpen;
}
