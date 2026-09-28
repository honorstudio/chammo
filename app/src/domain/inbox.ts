// 결정 대기함 — 참모가 나한테 물은 것만 모은다: 참모 세션의 질문·확인창, 참모가 scripts/task ask 로 올린 결정, 로그인 오류로 멈춘 세션.
// 하위 세션이 물은 건 참모한테 한 말이라 뺀다 — 나한테 올릴지는 참모가 정한다(사용자 2026-09-27)
import { tr } from '../i18n';
import type { Activity } from './activity';
import type { Session } from './session';
import type { ActivityStatus } from './status';
import type { TaskEvent } from './tasks';

export type InboxKind = 'ask' | 'blocked' | 'decide' | 'login';
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
};

/** 로그인 토큰 갱신이 세션끼리 겹치거나 만료돼 대화가 멈춘 흔적 — 실측 2026-09-27(project-b-g) */
export const LOGIN_STALL = /could not refresh your login|sign in again with \/login|please run \/login|oauth token has expired|authentication_error|invalid api key/i;
/** 로그인 오류로 멈춘 세션에 '이어서' 누르면 보내는 말 — 사용자가 친 말처럼 꾸미지 않는다 */
export const RESUME_MSG = tr('로그인 오류로 멈췄었어(다시 로그인함). 하던 거 이어서 해줘.', 'You stopped on a login error (signed in again). Please continue where you left off.');

type Act = { session: Session; status: ActivityStatus; activity: Activity };

/** 기록에 적힌 대상(세션 id·이름·전체 sessionId)으로 세션 찾기 */
export const findTarget = (sessions: Session[], target?: string) =>
  target ? sessions.find((x) => x.id === target || x.name === target || x.sessionId === target) : undefined;

/** sessions: 기록의 대상 세션 → 프로젝트 이름을 찾는 데 쓴다. isOrch: 참모 세션인가(질문·확인창은 참모 것만) */
export function buildInbox(
  activities: Act[],
  events: TaskEvent[],
  dismissed: ReadonlySet<string>,
  sessions: Session[] = [],
  isOrch: (s: Session) => boolean = () => false,
): InboxItem[] {
  const out: InboxItem[] = [];
  for (const { session: s, status, activity: a } of activities) {
    const ts = a.reply?.ts ?? '';
    const at = { project: s.project, where: s.workspace ?? '' };
    if (status !== 'working' && status !== 'blocked' && LOGIN_STALL.test(a.reply?.text ?? '')) {
      out.push({ key: `login:${s.id}:${ts}`, kind: 'login', ...at, text: tr('로그인 오류로 멈춰 있어 — 이어서 누르면 다시 돌아', 'Stopped on a login error — press Resume to restart it'), ts, target: s.id });
      continue;
    }
    if (!isOrch(s)) continue;
    // 물음은 결론 첫 문장(lead) + 마지막 질문(text) — 앞에서 자른 답은 질문이 잘렸다(domain/activity askView)
    if (status === 'asks') out.push({ key: `ask:${s.id}:${ts}`, kind: 'ask', ...at, text: a.reply?.ask?.q || a.reply?.text || '', ...(a.reply?.ask?.lead ? { lead: a.reply.ask.lead } : {}), ts, target: s.id });
    if (status === 'blocked') out.push({ key: `blocked:${s.id}:${ts}`, kind: 'blocked', ...at, text: tr('확인창·선택지에서 멈춰 있어 — 열어서 골라줘', 'Waiting on a prompt or choice — open it and pick one'), ts, target: s.id });
  }

  // 일마다 마지막 이벤트가 ask(참모가 scripts/task ask 로 올림)면 결정 대기
  const tasks = new Map<string, { title: string; target: string; last?: TaskEvent }>();
  for (const e of events) {
    if (e.type === 'send') tasks.set(e.task, { title: e.title ?? '', target: e.target ?? '' });
    const t = tasks.get(e.task);
    if (t && e.type !== 'send') t.last = e;
  }
  for (const [id, t] of tasks) {
    const e = t.last;
    if (!e || !e.note) continue;
    if (e.type === 'ask') {
      // 프로젝트는 일을 받은 세션 쪽 — 답장 받을 참모(to)가 아니라
      const project = findTarget(sessions, t.target)?.project ?? t.target;
      out.push({ key: `task:${id}:${e.ts}`, kind: 'decide', project, where: t.title, text: e.note, ts: e.ts, target: e.to || t.target, taskId: id });
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

/** 지난번 목록(열쇠들) 대비 새로 생긴 항목. 지난번이 없으면(앱을 막 켰을 때) 빈 목록 — 켜자마자 알림 폭탄 방지 */
export function freshItems(prev: ReadonlySet<string> | null, items: InboxItem[]): InboxItem[] {
  return prev ? items.filter((i) => !prev.has(i.key)) : [];
}

/** 종 아래 결정 드롭다운을 펼칠지. 결정이 들어오면 펼치고, 사용자가 닫으면("나중에") 다음 새 결정이 올 때까지 접어 둔다 */
export function popoverOpen(wasOpen: boolean, prev: ReadonlySet<string> | null, items: InboxItem[]): boolean {
  if (items.length === 0) return false;
  if (prev === null) return true;
  return freshItems(prev, items).length > 0 || wasOpen;
}
