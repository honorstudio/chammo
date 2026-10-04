// 직접 답하기 카드(2026-10-03) — 하위 세션이 scripts/direct ask 로 남긴 카드(<데이터>/direct.jsonl)를 상태와 함께 읽는다.
// 사람이 카드에서 누르면 앱(Rust direct.rs)이 그 세션 입력칸에 사람 말로 친다. 여기는 보여 줄 상태만 가린다
import { tr } from '../i18n';

export type DirectKind = 'pay' | 'send' | 'delete' | 'ops' | 'login' | 'other';
/** wait 기다림 · sent 보냄 · got 세션이 받았음 · done 처리됨 · failed 치다 실패(다시 누를 수 있음) · gone 세션 꺼짐 · closed 세션이 거둠 · old 지난 질문 */
export type DirectState = 'wait' | 'sent' | 'got' | 'done' | 'failed' | 'gone' | 'closed' | 'old';
export type DirectCard = {
  id: string; ts: string; from: string; cwd: string; q: string; kind: DirectKind;
  amount?: string; detail?: string; what?: string; yes: string; no: string; options: string[];
  state: DirectState;
  answer?: { ts: string; pick: string; label?: string; by?: string };
  note?: string;
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
      state: 'wait',
    };
    let failed = false;
    let ended: DirectState | null = null;
    for (const x of rows.slice(i + 1)) {
      if (x.id === c.id && x.type === 'answer') { c.answer = { ts: x.ts ?? '', pick: str(x.pick) ?? '', label: str(x.label), by: str(x.by) }; failed = false; }
      else if (x.id === c.id && x.type === 'answer-failed') { c.answer = undefined; failed = true; }
      else if (x.id === c.id && x.type === 'done') { ended = 'done'; c.note = str(x.note); }
      else if (x.id === c.id && x.type === 'cancel') ended = 'closed';
      else if (x.type === 'ask' && x.from === c.from && !c.answer && !ended) ended = 'old';
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
  return r?.turnEnd && Date.parse(r.ts) > Date.parse(p.ts) ? 'done' : 'got';
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
