// 보내기 상태 흐름을 한 표로 — 채팅 보내기 유령('안 갔어요')은 고친 뒤 4번 다시 나왔다(2026-09-30 ~ 10-10, 불편 순위 6번).
// 고칠 때마다 조각(대기열·기록 맞대기·다시 보내기 막기)만 따로 시험해서, 조각 사이 이음매가 다시 어긋나도 CI 가 몰랐다.
// 이 표는 ChatView 가 매 초 하는 것(waitingOf → pendingState → pendAct, 다시 보내기 = againPlan → resent, 걸린 Enter = autoEnterTarget)을
// 시간 순서대로 그대로 돌린다. 새 증상이 나오면 고치기 전에 여기 한 줄(장면)을 먼저 더한다.
import { describe, expect, it } from 'vitest';
import { appendChat, enterDelay, escUnsends, type ChatItem } from './chat';
import { againPlan, applyQueueOps, autoEnterTarget, DUP_CONFIRM, emptyQueue, LOST_AFTER, newPending, pendAct, pendingState, PENDING_MS, resent, waitingOf, type QueueState } from './chatQueue';

const T0 = Date.parse('2026-10-10T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const L = (o: object) => JSON.stringify(o);
let n = 0;
/** 기록 줄 — at = T0 부터 몇 ms(기록 시각은 보낸 때로 찍힌다, 훅이 늦으면 붙는 것만 늦다) */
const user = (text: string, at: number, parent?: string) => L({ type: 'user', uuid: `u${n++}`, timestamp: iso(T0 + at), message: { role: 'user', content: text }, ...(parent ? { parentUuid: parent } : {}) });
const think = (at: number) => L({ type: 'assistant', uuid: `a${n++}`, timestamp: iso(T0 + at), message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } });
const queued = (text: string, at: number) => L({ type: 'attachment', uuid: `q${n++}`, timestamp: iso(T0 + at), attachment: { type: 'queued_command', prompt: text, origin: { kind: 'human' } } });
const op = (operation: string, at: number, content?: string) => L({ type: 'queue-operation', operation, timestamp: iso(T0 + at), sessionId: 's', ...(content === undefined ? {} : { content }) });
const peer = (text: string, at: number) => user(`<cross-session-message from="uds:/tmp/x.sock" from-name="demo">${text}</cross-session-message>`, at);

type Step =
  | { send: string } // 채팅 보내기(앱이 친 [앱] 줄도 chat-pending 으로 같은 길)
  | { wait: number }
  | { log: string[] } // 세션 기록에 붙은 줄(기록 읽기 = appendChat + applyQueueOps)
  | { term: string } // 터미널 입력칸에 보이는 글
  | { see: string[] } // 말풍선들 '글=상태/단추'
  | { again: 'send' | 'warn' } // 다시 보내기(맨 앞 말풍선 또는 입력칸 글 A) 눌렀을 때 막나
  | { enter: string | null } // 입력칸에 걸린 말에 Enter 를 다시 넣나
  | { esc: boolean } // 채팅 Esc 가 방금 보낸 말을 거둬들이게 되나(그럼 안 넘긴다 — domain/chat escUnsends)
  | { bubbles: string[] }; // 기록에서 그린 내 말풍선들

type Sim = { now: number; pending: { text: string; at: number; since?: number }[]; items: ChatItem[]; queue: QueueState; term: string; warned: { text: string; at: number } | null; lastSent: string };

function run(steps: Step[]): void {
  const s: Sim = { now: T0, pending: [], items: [], queue: emptyQueue, term: '', warned: null, lastSent: '' };
  const view = () => {
    s.pending = waitingOf(s.pending, s.items, s.now); // ChatView: waiting 이 줄면 setPending(waiting)
    const enterWait = Math.max(0, ...s.pending.map((p) => enterDelay(p.text.length, false)));
    return { enterWait, rows: s.pending.map((p) => ({ p, st: pendingState(p, { queue: s.queue, termText: s.term, now: s.now, enterWait }) })) };
  };
  steps.forEach((step, i) => {
    const where = `${i + 1}번째 ${JSON.stringify(step)}`;
    if ('send' in step) { s.pending.push(newPending(step.send, s.items, s.now)); s.lastSent = step.send; }
    else if ('wait' in step) s.now += step.wait;
    else if ('log' in step) { const c = step.log.join('\n'); s.items = appendChat(s.items, c); s.queue = applyQueueOps(s.queue, c); }
    else if ('term' in step) s.term = step.term;
    else if ('see' in step) {
      const got = view().rows.map(({ p, st }) => `${p.text}=${st}${pendAct(st) ? `/${pendAct(st)}` : ''}`);
      expect(got, where).toEqual(step.see);
    } else if ('again' in step) {
      const p = view().rows[0]?.p;
      const text = p?.text ?? s.lastSent;
      const plan = againPlan(text, s.items, s.now, s.warned);
      expect(plan, where).toBe(step.again);
      if (plan === 'warn') s.warned = { text, at: s.now };
      else { s.warned = null; if (p) s.pending = [...s.pending.filter((x) => x.at !== p.at), resent(p, s.now)]; }
    } else if ('esc' in step) {
      const { rows } = view();
      expect(escUnsends(s.items, rows.some((r) => r.st === 'sending')), where).toBe(step.esc);
    } else if ('bubbles' in step) {
      expect(s.items.filter((x) => x.kind === 'user').map((x) => (x as { text: string }).text), where).toEqual(step.bubbles);
    } else {
      const { enterWait } = view();
      expect(autoEnterTarget(s.pending, { queue: s.queue, termText: s.term, now: s.now, enterWait, tries: {} }), where).toBe(step.enter);
    }
  });
}

const A = '도메인 연결 어떻게 됐어?';
const B = '그리고 시험도 돌려 줘';
const APP = '[앱] demo / feature-x 세션(ab12cd34)이 2분째 답을 기다려 — 마지막 말: "시험 다 돌렸어"';

const FLOW: [string, Step[]][] = [
  ['쉬는 세션 — 보냄 → 기록에 보이면 말풍선이 사라진다',
    [{ send: A }, { see: [`${A}=sending`] }, { wait: 3000 }, { log: [user(A, 300)] }, { see: [] }]],
  ['맥이 바빠 훅이 20초 걸림 — 그 사이엔 보내는 중(안 갔어요 아님), 늦게 붙은 기록(보낸 때 시각)으로 사라진다',
    [{ send: A }, { wait: 21_000 }, { see: [`${A}=sending`] }, { log: [user(A, 300)] }, { see: [] }]],
  ['정말 안 감 — 넉넉히 지나면 안 갔어요 + 다시 보내기, 누르면 다시 보내는 중, 그다음 기록으로 사라진다',
    [{ send: A }, { wait: LOST_AFTER + 1000 }, { see: [`${A}=lost/again`] }, { again: 'send' }, { see: [`${A}=sending`] },
      { wait: 2000 }, { log: [user(A, LOST_AFTER + 1500)] }, { see: [] }]],
  ['안 갔어요로 보인 뒤 첫 기록이 옛 시각으로 늦게 붙어도 — 다시 보낸 말풍선이 그 기록으로 사라진다',
    [{ send: A }, { wait: LOST_AFTER + 1000 }, { see: [`${A}=lost/again`] }, { again: 'send' }, { wait: 1000 }, { log: [user(A, 200)] }, { see: [] }]],
  ['두 번 누름 — 이미 간 말을 입력칸 다시 보내기로 또 누르면 처음엔 막고, 곧 한 번 더면 보내고, 오래 지나 누르면 또 막는다',
    [{ send: A }, { wait: 3000 }, { log: [user(A, 300)] }, { see: [] }, { again: 'warn' }, { wait: 2000 }, { again: 'send' },
      { wait: DUP_CONFIRM + 1000 }, { again: 'warn' }]],
  ['일하는 중 — 줄 서면 대기 중 + 지금 보내기, 차례가 와 queued_command 로 들어가면 사라진다',
    [{ send: A }, { wait: 1500 }, { log: [op('enqueue', 600, A)] }, { see: [`${A}=queued/now`] }, { wait: 120_000 },
      { see: [`${A}=queued/now`] }, { log: [op('dequeue', 121_000), queued(A, 121_000)] }, { see: [] }]],
  ['Enter 가 줄바꿈으로 먹혀 입력칸에 걸림 — 입력칸에 걸려 있어요 + 2초 뒤 Enter 를 다시, 들어가면 사라진다',
    [{ send: A }, { term: A }, { wait: 1500 }, { see: [`${A}=input/now`] }, { enter: null }, { wait: 1000 }, { enter: A },
      { term: '' }, { log: [user(A, 2600)] }, { see: [] }]],
  ['↑로 줄 선 말이 입력칸에 되돌아옴(popAll) — 입력칸에 걸림이지만 사람이 고치는 중일 수 있어 Enter 는 안 넣는다',
    [{ send: A }, { log: [op('enqueue', 500, A)] }, { wait: 2000 }, { see: [`${A}=queued/now`] }, { log: [op('popAll', 2500, A)] },
      { term: A }, { wait: 3000 }, { see: [`${A}=input/now`] }, { enter: null }]],
  ['[앱] 줄 — 앱이 참모 입력칸에 친 줄은 기록에 앱이 넘긴 줄(relay)로 잡혀도 간 것으로',
    [{ send: APP }, { wait: 2000 }, { log: [user(APP, 1000)] }, { see: [] }]],
  ['[앱] 줄이 일하는 중 줄 섰다 들어감', [{ send: APP }, { wait: 2000 }, { log: [queued(APP, 30_000)] }, { see: [] }]],
  ['다른 세션이 같은 글을 보낸 건 내 말이 아니다 — 내 말은 그대로 남는다',
    [{ send: A }, { wait: 2000 }, { log: [peer(A, 1000)] }, { wait: LOST_AFTER }, { see: [`${A}=lost/again`] }]],
  ['예전에 같은 글을 보냈어도 방금 보낸 말이 바로 사라지지 않는다',
    [{ log: [user('응', -60_000)] }, { send: '응' }, { see: ['응=sending'] }, { wait: LOST_AFTER + 1000 }, { see: ['응=lost/again'] }]],
  ['방금 간 같은 글을 몇 초 뒤 또 보냈는데 이번엔 안 감 — 앞 말 기록에 짝지어 조용히 사라지지 않고 안 갔어요(2026-10-11 bug-hunt 하네스)',
    [{ send: A }, { wait: 1000 }, { log: [user(A, 300)] }, { see: [] }, { wait: 3000 }, { send: A }, { see: [`${A}=sending`] },
      { wait: LOST_AFTER + 1000 }, { see: [`${A}=lost/again`] }, { again: 'warn' }]],
  ['방금 간 같은 글을 또 보내고 그것도 들어감 — 사라진다',
    [{ send: A }, { wait: 1000 }, { log: [user(A, 300)] }, { wait: 3000 }, { send: A }, { wait: 2000 }, { log: [user(A, 4300)] }, { see: [] }]],
  ['둘을 잇따라 보냈는데 하나만 들어감 — 안 들어간 것만 안 갔어요',
    [{ send: A }, { wait: 100 }, { send: B }, { wait: 2000 }, { log: [user(A, 400)] }, { wait: LOST_AFTER }, { see: [`${B}=lost/again`] }]],
  ['쉬는 참모에 보낸 말에 답(생각·도구·글)이 나오기 전 Esc 는 안 넘긴다 — 넘기면 Claude Code 가 그 말을 거둬들여 참모에게 안 간다(2026-10-16 사용자)',
    [{ send: A }, { wait: 300 }, { esc: true }, { wait: 700 }, { log: [user(A, 0, 'p0')] }, { see: [] }, { esc: true }, { wait: 3000 }, { log: [think(4000)] }, { esc: false }]],
  ['다른 길(터미널 Esc)로 거둬들여진 말 — 같은 부모의 다음 말이 붙으면 앞 말은 보통 말풍선으로 안 남는다',
    [{ log: [user(A, 0, 'p0')] }, { bubbles: [A] }, { wait: 3000 }, { send: B }, { wait: 1000 }, { log: [user(B, 3000, 'p0')] }, { see: [] }, { bubbles: [B] }]],
  ['/ 명령은 기록에 안 남을 때가 있어 4초 뒤 보낸 걸로', [{ send: '/model' }, { see: ['/model=sending'] }, { wait: 4100 }, { see: [] }]],
  ['한 시간 넘게 안 간 말풍선은 지운다', [{ send: A }, { wait: PENDING_MS + 1 }, { see: [] }]],
];

describe('보내기 상태 흐름 — 보냄 → 기록에 보임 / 안 갔어요 → 다시 보내기(ChatView 가 매 초 하는 것을 시간 순서대로)', () => {
  it.each(FLOW)('%s', (_name, steps) => run(steps));
});
