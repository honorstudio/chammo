// 직접 답하기 카드(2026-10-03) — 하위 세션이 scripts/direct ask 로 남긴 카드(<데이터>/direct.jsonl)를 상태와 함께 읽는다.
// 사람이 카드에서 누르면 앱(Rust direct.rs)이 그 세션 입력칸에 사람 말로 친다. 여기는 보여 줄 상태만 가린다
import { tr } from '../i18n';
import { forwardTo } from './forwardQuestion';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

export type DirectKind = 'pay' | 'send' | 'delete' | 'ops' | 'login' | 'other';
/** wait 기다림 · sent 보냄 · got 세션이 받았음 · done 처리됨 · failed 치다 실패(다시 누를 수 있음) · gone 세션 꺼짐(다시 띄우기/닫기) · closed 세션이 거둠 · old 지난 질문 */
export type DirectState = 'wait' | 'sent' | 'got' | 'done' | 'failed' | 'gone' | 'closed' | 'old';
export type DirectCard = {
  id: string; ts: string; from: string; cwd: string; q: string; kind: DirectKind;
  amount?: string; detail?: string; what?: string; yes: string; no: string; options: string[];
  state: DirectState;
  answer?: { ts: string; pick: string; label?: string; by?: string };
  note?: string;
  /** 이 카드의 마지막 소식(물음·답·처리됨·거둠·새 질문) 시각 — 한 줄로 남는 시간을 여기서 잰다 */
  lastTs: string;
};
type Env = {
  alive: (sid: string) => boolean;
  /** 그 세션 마지막 사람 말(대화 기록) */
  prompt: (sid: string) => { ts: string; text: string } | undefined;
  /** 그 세션 마지막 답(턴 끝이면 turnEnd) */
  reply: (sid: string) => { ts: string; turnEnd?: boolean } | undefined;
};

const KINDS: DirectKind[] = ['pay', 'send', 'delete', 'ops', 'login', 'other'];
type Row = Record<string, unknown> & { type?: string; id?: string; ts?: string; from?: string };
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function directCards(log: string, env: Env): DirectCard[] {
  const rows: Row[] = [];
  for (const line of log.split('\n')) {
    try {
      const r = JSON.parse(line) as Row;
      if (r && typeof r === 'object') rows.push(r);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  const out: DirectCard[] = [];
  rows.forEach((r, i) => {
    if (r.type !== 'ask' || !r.id || !r.from) return;
    const kind = KINDS.includes(r.kind as DirectKind) ? (r.kind as DirectKind) : 'other';
    const c: DirectCard = {
      id: r.id, ts: r.ts ?? '', from: r.from, cwd: str(r.cwd) ?? '', q: str(r.q) ?? '', kind,
      amount: str(r.amount), detail: str(r.detail), what: str(r.what),
      yes: str(r.yes) ?? tr('승인', 'Approve'), no: str(r.no) ?? tr('거절', 'Decline'),
      options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : [],
      state: 'wait', lastTs: r.ts ?? '',
    };
    let failed = false;
    let ended: DirectState | null = null;
    for (const x of rows.slice(i + 1)) {
      const before: DirectState | null = ended;
      if (x.id === c.id && x.type === 'answer') { c.answer = { ts: x.ts ?? '', pick: str(x.pick) ?? '', label: str(x.label), by: str(x.by) }; failed = false; }
      else if (x.id === c.id && x.type === 'answer-failed') { c.answer = undefined; failed = true; }
      else if (x.id === c.id && x.type === 'done') { ended = 'done'; c.note = str(x.note); }
      else if (x.id === c.id && x.type === 'cancel') ended = 'closed';
      else if (x.type === 'ask' && x.from === c.from && !c.answer && !ended) ended = 'old';
      else continue;
      if ((x.id === c.id || ended !== before) && x.ts && x.ts > c.lastTs) c.lastTs = x.ts;
    }
    c.state = ended ?? (c.answer ? answeredState(c, env) : failed ? 'failed' : env.alive(c.from) ? 'wait' : 'gone');
    out.push(c);
  });
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** 답한 뒤 — 세션 입력에 카드 번호가 든 사람 말이 들어왔으면 받았음, 그 뒤 턴을 끝냈으면 처리됨 */
function answeredState(c: DirectCard, env: Env): DirectState {
  const p = env.prompt(c.from);
  const at = Date.parse(c.answer!.ts || c.ts);
  if (!p || !p.text.includes(c.id) || Date.parse(p.ts) < at - 5_000) return 'sent';
  const r = env.reply(c.from);
  if (!(r?.turnEnd && Date.parse(r.ts) > Date.parse(p.ts))) return 'got';
  if (r.ts > c.lastTs) c.lastTs = r.ts; // 턴 끝 = 처리된 때 — 한 줄은 거기서부터 5분
  return 'done';
}

/** 위험 말과 색 — 결제·삭제 빨강, 발송·운영 노랑 */
export function kindView(kind: DirectKind): { word: string; tone: 'danger' | 'warn' | 'plain' } {
  switch (kind) {
    case 'pay': return { word: tr('결제', 'Payment'), tone: 'danger' };
    case 'delete': return { word: tr('삭제', 'Delete'), tone: 'danger' };
    case 'send': return { word: tr('발송', 'Send'), tone: 'warn' };
    case 'ops': return { word: tr('운영', 'Production'), tone: 'warn' };
    case 'login': return { word: tr('로그인', 'Sign-in'), tone: 'plain' };
    default: return { word: tr('확인', 'Confirm'), tone: 'plain' };
  }
}

/** 아직 사람 답이 필요한 카드인가 */
export const needsAnswer = (c: DirectCard) => c.state === 'wait' || c.state === 'failed';
/** 사람이 봐야 하는 카드 — 답 기다림·치다 실패, 그리고 답 전에 주인 세션이 꺼진 것(다시 띄우기/닫기). 이건 숨기지 않는다 */
export const needsLook = (c: DirectCard) => needsAnswer(c) || c.state === 'gone';

// ── 살아 있나·어디에 띄우나(2026-10-05 아이맥 사고) ──
// 세션이 저장소 워크트리로 들어가면 agents --json cwd 가 프로젝트 폴더 밖이 돼 앱 세션 목록(폴더로 거른 것)에서 빠졌다 → 카드가 꺼짐으로 숨었다.
// 살아 있나는 폴더로 거르기 전 전체 목록으로, 같은 번호로 되살리는 동안 잠깐 빠지는 것은 유예로 본다

/** 목록에서 빠져도 이만큼은 살아 있는 걸로 — 같은 번호 되살리기(respawn)·agents 한 번 실패 사이 */
export const GONE_GRACE_MS = 90_000;
/** 세션 번호 → 전체 목록에서 마지막으로 본 때 */
export type Seen = Record<string, number>;
const SEEN_KEEP = 3600_000;

export function stepSeen(prev: Seen, ids: string[], now: number): Seen {
  const next: Seen = {};
  for (const [id, at] of Object.entries(prev)) if (now - at < SEEN_KEEP) next[id] = at;
  for (const id of ids) next[id] = now;
  return next;
}

export const aliveIn = (seen: Seen, now: number) => (sid: string) => sid in seen && now - seen[sid]! < GONE_GRACE_MS;

const DAY = 24 * 3600_000;
export type Placed = { card: DirectCard; /** 그 카드를 채팅에 받을 참모(없으면 결정 대기함에만) */ owner?: Session };

/**
 * 데스크톱 카드와 받을 참모 — everyone 은 폴더로 거르기 전 전체 목록. 받을 참모는 하위 세션 질문과 같은 규칙(forwardTo):
 * 그 세션에 일을 보낸 참모 → 같은 프로젝트를 맡긴 참모 → 맡은 일 → 맨 앞 참모. 끝난 영수증은 하루만
 */
export function placeDirect(log: string, o: {
  everyone: Session[]; seen: Seen; now: number;
  /** 세션 목록을 아직 못 읽음 — 꺼짐으로 단정하지 않는다(앱을 켤 때) */ unknown?: boolean;
  prompt: Env['prompt']; reply: Env['reply'];
  events: TaskEvent[]; orchs: Session[]; front?: Session; heir?: (s: Session) => Session | undefined;
}): Placed[] {
  const cards = directCards(log, { alive: o.unknown ? () => true : aliveIn(o.seen, o.now), prompt: o.prompt, reply: o.reply })
    .filter((c) => needsAnswer(c) || o.now - Date.parse(c.ts) < DAY);
  return cards.map((card) => {
    const s = o.everyone.find((x) => x.id === card.from) ?? ({ id: card.from, name: '', project: card.cwd.split('/').pop() ?? '' } as Session);
    return { card, owner: forwardTo(s, o.events, o.orchs, o.everyone, o.front, o.heir) };
  });
}

/** 답·처리가 끝난 카드가 한 줄로 남는 시간(2026-10-05 사용자 — 처리된 카드 두 장이 폰 채팅을 크게 가렸다) */
export const LINE_TTL = 5 * 60_000;
/** 닫기·밀기로 치운 카드 — 카드 번호 → 치울 때의 마지막 소식 시각. 그 뒤 새 소식이 오면 다시 한 줄로 */
export type Dismissed = Record<string, string>;

/** 크게(사람 답이 필요) · 한 줄(끝남, 5분) · 숨김 — 데스크톱 채팅과 폰이 같이 쓴다 */
export function cardShow(c: DirectCard, now: number, dismissed: Dismissed): 'full' | 'line' | 'hide' {
  if (needsAnswer(c)) return 'full';
  if (dismissed[c.id] === c.lastTs) return 'hide';
  if (c.state === 'gone') return 'full'; // 답 전에 세션이 꺼짐 — 사람이 닫거나 다시 띄울 때까지 크게(전엔 5분 뒤 조용히 숨었다)
  return now - Date.parse(c.lastTs) < LINE_TTL ? 'line' : 'hide';
}

export function dismiss(m: Dismissed, c: Pick<DirectCard, 'id' | 'lastTs'>): Dismissed {
  const next = { ...m };
  delete next[c.id]; // 넣은 순서 = 치운 순서 — 다시 치우면 맨 뒤로
  next[c.id] = c.lastTs;
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - 50))) delete next[id];
  return next;
}

/** 접힌 한 줄 — 무엇(위험 말·금액) · 결과 · 시각 */
export function cardLine(c: DirectCard): { what: string; result: string; at: string } {
  const k = kindView(c.kind);
  const label = c.answer?.label ?? tr('직접 답', 'Answered');
  const result = c.state === 'done' ? c.note || tr('처리됨', 'Done')
    : c.answer ? `${label} · ${c.state === 'got' ? tr('받음', 'Received') : tr('보냄', 'Sent')}`
    : c.state === 'gone' ? tr('세션이 꺼졌어요', 'Session ended')
    : c.state === 'closed' ? tr('세션이 거둬들였어요', 'Withdrawn')
    : tr('지난 질문', 'Replaced');
  return { what: c.amount ? `${k.word} ${c.amount}` : k.word, result, at: c.lastTs };
}
