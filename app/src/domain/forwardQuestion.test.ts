import { describe, expect, it } from 'vitest';
import { ASK_GRACE_MS, askForwardText, askKeyOf, askTextKeyOf, forwardText, GRACE_MS, nextAskForward, nextForward, nextQuietForward, openTaskOf, QUIET_GRACE_MS, quietForwardText, quietKeyOf, retryAfterFail, toldOrch, type AskCand } from './forwardQuestion';
import type { TaskCard } from './tasks';
import type { Activity } from './activity';
import type { Session } from './session';

const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, name: id, cwd: `/dev/${id}`, kind: 'background', state: 'working', project: id, workspace: null, startedAt: 0, ...over,
});
const asking = (id: string, over: Partial<Session> = {}) => s(id, { state: 'blocked', waitingFor: 'input needed', ...over });
const orch = s('local', { name: '참모', state: 'idle' });
const never = () => false;

describe('nextForward — 하위 세션 선택지 창을 참모에게 넘길 때', () => {
  it('처음 본 순간엔 안 넘기고 30초 뒤에 넘긴다', () => {
    const a = nextForward([asking('video-app')], orch, new Map(), 1000, never);
    expect(a.sub).toBeUndefined();
    const b = nextForward([asking('video-app')], orch, a.track, 1000 + GRACE_MS, never);
    expect(b.sub?.id).toBe('video-app');
  });

  it('한 번 멈춘 동안엔 한 번만 넘긴다', () => {
    const a = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, never);
    expect(a.sub?.id).toBe('video-app');
    expect(nextForward([asking('video-app')], orch, a.track, GRACE_MS * 5, never).sub).toBeUndefined();
  });

  it('창이 닫혔다가 다시 뜨면 다시 센다', () => {
    const a = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, never);
    const b = nextForward([s('video-app')], orch, a.track, GRACE_MS + 1, never);
    expect(b.track.has('video-app')).toBe(false);
    const c = nextForward([asking('video-app')], orch, b.track, GRACE_MS + 2, never);
    expect(c.sub).toBeUndefined();
    expect(nextForward([asking('video-app')], orch, c.track, GRACE_MS * 2 + 2, never).sub?.id).toBe('video-app');
  });

  it('권한 창(permission prompt)은 앱이 자동 허용하니 안 넘긴다', () => {
    const p = asking('project-b', { waitingFor: 'permission prompt' });
    expect(nextForward([p], orch, new Map([['project-b', 0]]), GRACE_MS, never).sub).toBeUndefined();
  });

  // 참모 입력칸에 글자 + Enter 를 넣으면 참모 자기 확인창의 선택지를 골라 버린다
  it('참모가 확인창에 걸려 있으면 기다린다 (기록은 지우지 않는다)', () => {
    const r = nextForward([asking('video-app')], { ...orch, state: 'blocked' }, new Map([['video-app', 0]]), GRACE_MS, never);
    expect(r.sub).toBeUndefined();
    expect(nextForward([asking('video-app')], orch, r.track, GRACE_MS + 1, never).sub?.id).toBe('video-app');
  });

  it('참모가 없으면 넘기지 않는다', () => {
    expect(nextForward([asking('video-app')], undefined, new Map([['video-app', 0]]), GRACE_MS, never).sub).toBeUndefined();
  });

  it('사용자가 그 세션 화면을 보고 있으면 넘기지 않는다', () => {
    const r = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, (x) => x.id === 'video-app');
    expect(r.sub).toBeUndefined();
  });

  it('대화형(터미널) 세션은 사용자가 직접 보고 있으니 안 넘긴다', () => {
    const r = nextForward([asking('term', { kind: 'interactive' })], orch, new Map([['term', 0]]), GRACE_MS, never);
    expect(r.sub).toBeUndefined();
  });
});

describe('forwardText — 참모 입력칸에 들어갈 한 줄', () => {
  it('어디·세션 id·읽고 답하는 명령', () => {
    const t = forwardText(asking('c0ffee01', { project: 'video-app', name: 'project-x-video' }));
    expect(t).toContain('video-app');
    expect(t).toContain('project-x-video');
    expect(t).toContain('scripts/choice show c0ffee01');
    expect(t).not.toContain('\n');
  });
});

describe('nextAskForward — 질문으로 턴을 끝내고 기다리는 하위 세션을 참모에게(2026-09-30 조사: 놓친 멈춤 1위)', () => {
  const T0 = Date.parse('2026-09-30T01:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const act = (over: Partial<Activity> = {}): Activity => ({
    prompt: { ts: iso(T0 - 60_000), text: '해줘' },
    reply: { ts: iso(T0), text: '어느 쪽으로 할까?', asks: true, turnEnd: true },
    ...over,
  });
  const cand = (id: string, a: Activity = act(), over: Partial<Session> = {}): AskCand => ({ session: s(id, { state: 'idle', startedAt: T0 - 3600_000, ...over }), activity: a });
  const later = T0 + ASK_GRACE_MS;

  it('질문으로 끝나고 2분 지나면 넘긴다', () => {
    expect(nextAskForward([cand('project-x')], orch, new Set(), T0 + 1000, never)).toBeUndefined();
    expect(nextAskForward([cand('project-x')], orch, new Set(), later, never)?.session.id).toBe('project-x');
  });

  it('물음표가 없어도 Claude 가 사람 답 기다림(awaiting)이라 하면 넘긴다', () => {
    const a = act({ reply: { ts: iso(T0), text: '사용자 답이 오면 참모가 전해 주기로 했어.', asks: false, turnEnd: true } });
    expect(nextAskForward([cand('scene', a)], orch, new Set(), later, never)).toBeUndefined();
    expect(nextAskForward([cand('scene', a, { awaiting: true })], orch, new Set(), later, never)?.session.id).toBe('scene');
  });

  it('두 번째 일부터 — 참모 SendMessage 로 받은 일(peer)에서 질문으로 멈추면 넘긴다. 앞 일 보고(messaged)로 막지 않는다(2026-10-11 bug-hunt)', () => {
    const a = act({ prompt: { ts: iso(T0 - 3 * 3600_000), text: '처음 지시' }, messaged: iso(T0 - 2 * 3600_000), peer: { ts: iso(T0 - 60_000), text: '다음 일' } });
    expect(nextAskForward([cand('project-x', a)], orch, new Set(), later, never)?.session.id).toBe('project-x');
    expect(nextAskForward([cand('project-x', { ...a, messaged: iso(T0 - 1000) })], orch, new Set(), later, never)).toBeUndefined(); // 이번 턴에 이미 물었다
    expect(nextAskForward([cand('project-x', { ...a, peer: { ts: iso(T0 + 1000), text: '답' } })], orch, new Set(), later, never)).toBeUndefined(); // 답이 왔다
  });

  it('이어서 켜기 전의 옛 답은 안 넘긴다(가져온 세션은 쉬어도 blocked 로 나온다)', () => {
    expect(nextAskForward([cand('old', act(), { awaiting: true, startedAt: T0 + 1 })], orch, new Set(), later, never)).toBeUndefined();
  });

  it('작업 중·선택지 창·턴 중간 멘트·새 지시가 온 뒤는 안 넘긴다', () => {
    expect(nextAskForward([cand('a', act(), { state: 'working' })], orch, new Set(), later, never)).toBeUndefined();
    expect(nextAskForward([cand('b', act(), { state: 'blocked' })], orch, new Set(), later, never)).toBeUndefined();
    expect(nextAskForward([cand('c', act({ reply: { ts: iso(T0), text: '먼저 볼게?', asks: true, midTurn: true } }))], orch, new Set(), later, never)).toBeUndefined();
    expect(nextAskForward([cand('d', act({ prompt: { ts: iso(T0 + 1), text: '응 그걸로' } }))], orch, new Set(), later, never)).toBeUndefined();
  });

  it('한 번 넘긴 답은 다시 안 넘기고, 하루 지난 건 안 넘긴다', () => {
    const c = cand('project-x');
    const key = askKeyOf(c);
    expect(nextAskForward([c], orch, new Set([key]), later, never)).toBeUndefined();
    expect(nextAskForward([c], orch, new Set(), T0 + 25 * 3600_000, never)).toBeUndefined();
  });

  it('같은 마지막 말로 끝난 새 턴은 다시 안 넘긴다(2026-10-10 한 세션: 진행 보고 턴마다 같은 끝말로 5번 넘어왔다)', () => {
    const first = cand('tone');
    const again = cand('tone', act({ prompt: { ts: iso(T0 + 1000), text: '계속' }, reply: { ts: iso(T0 + 2000), text: '어느 쪽으로 할까?', asks: true, turnEnd: true } }));
    expect(askKeyOf(again)).not.toBe(askKeyOf(first));
    expect(nextAskForward([again], orch, new Set([askKeyOf(first), askTextKeyOf(first)]), later + 2000, never)).toBeUndefined();
    const other = cand('tone', act({ prompt: { ts: iso(T0 + 1000), text: '계속' }, reply: { ts: iso(T0 + 2000), text: '이번엔 A 로 갈까?', asks: true, turnEnd: true } }));
    expect(nextAskForward([other], orch, new Set([askKeyOf(first), askTextKeyOf(first)]), later + 2000, never)?.session.id).toBe('tone');
  });

  it('사용자가 그 세션을 보고 있거나 참모가 확인창에 걸려 있으면 기다린다', () => {
    expect(nextAskForward([cand('project-x')], orch, new Set(), later, () => true)).toBeUndefined();
    expect(nextAskForward([cand('project-x')], s('local', { state: 'blocked' }), new Set(), later, never)).toBeUndefined();
  });

  it('그 턴에 SendMessage 로 이미 보고했으면 안 넘긴다(참모 기록이 커서 거기선 못 찾았다 — 프로젝트 P 2026-09-30)', () => {
    const a = act({ messaged: iso(T0 - 1000) });
    expect(nextAskForward([cand('proj-p', a)], orch, new Set(), later, never)).toBeUndefined();
    const before = act({ messaged: iso(T0 - 120_000) }); // 지시보다 앞선 보고는 이번 턴 것이 아니다
    expect(nextAskForward([cand('proj-p', before)], orch, new Set(), later, never)?.session.id).toBe('proj-p');
  });

  it('넘길 줄엔 답의 끝부분을 인용한다(앞부분 설명 말고)', () => {
    const a = act({ reply: { ts: iso(T0), text: 'PR #34 만든 것 설명…', tail: '…사용자가 직접 인증 풀어야 해', asks: true, turnEnd: true } });
    expect(askForwardText(cand('proj-p', a).session, a, later)).toContain('사용자가 직접 인증 풀어야 해');
  });

  it('보낼 줄에 세션·질문이 들어간다', () => {
    const t = askForwardText(cand('project-x').session, act(), later);
    expect(t).toContain('project-x');
    expect(t).toContain('어느 쪽으로 할까?');
    expect(t).toContain('2분');
    expect(t).not.toContain('\n');
  });
});

describe('toldOrch — 하위 세션이 그 턴에 참모에게 메시지를 보냈나(참모 대화 기록)', () => {
  const msg = (ts: string, from: string) => JSON.stringify({ type: 'queue-operation', timestamp: ts, content: `<cross-session-message from="uds:/tmp/x.sock" from-name="${from}" from-mode="bypass">답</cross-session-message>` });
  it('그 턴 시작 뒤에 그 세션이 보낸 메시지가 있으면 true', () => {
    const tail = [msg('2026-09-30T00:59:00Z', 'project-x'), msg('2026-09-30T00:59:30Z', 'other')].join('\n');
    expect(toldOrch(tail, 'project-x', '2026-09-30T00:58:00Z')).toBe(true);
    expect(toldOrch(tail, 'project-x', '2026-09-30T00:59:10Z')).toBe(false);
    expect(toldOrch(tail, 'notes-app', '2026-09-30T00:00:00Z')).toBe(false);
  });
});

describe('넘기기 실패는 세 번까지만 다시 — 윈도우에서 답장이 매번 실패해 40초마다 끝없이 다시 보냈다', () => {
  it('세 번째 실패부터 그만', () => {
    const fails = new Map<string, number>();
    expect(retryAfterFail(fails, 'a')).toBe(true);
    expect(retryAfterFail(fails, 'a')).toBe(true);
    expect(retryAfterFail(fails, 'a')).toBe(false);
    expect(retryAfterFail(fails, 'b')).toBe(true); // 다른 세션은 따로 센다
  });
});

import { forwardTo, inputWaitText } from './forwardQuestion';
import type { TaskEvent } from './tasks';

describe('forwardTo — 멈춘 하위 세션을 맡긴 참모에게(2026-10-03: 개발 담당 세션 알림이 맨 앞 참모에게 4번 갔다)', () => {
  const front = s('o-front', { name: '참모-2 · 참모 업데이트', state: 'idle' });
  const dev = s('o-dev', { name: '참모-5 · 개발 담당', state: 'idle' });
  const orchs = [front, dev];
  const sub = asking('a1b2c3d4', { name: 'project-b-fix', project: 'project-b' });
  const other = s('e5f6a7b8', { name: 'project-b-ui', project: 'project-b' });
  const send = (task: string, target: string, from: string, ts = '2026-10-03T01:00:00Z'): TaskEvent => ({ ts, type: 'send', task, target, from });
  const all = [front, dev, sub, other];

  it('그 세션에 마지막으로 일을 보낸 참모', () => {
    const ev = [send('t1', 'project-b-fix', 'o-front', '2026-10-03T00:00:00Z'), send('t2', 'project-b-fix [a1b2c3d4]', 'o-dev', '2026-10-03T01:00:00Z')];
    expect(forwardTo(sub, ev, orchs, all, front)?.id).toBe('o-dev');
  });
  it('넘겨받은 일(own)이면 새 주인', () => {
    const ev = [send('t1', 'project-b-fix', 'o-front'), { ts: '2026-10-03T02:00:00Z', type: 'own', task: 't1', from: 'o-dev' } as TaskEvent];
    expect(forwardTo(sub, ev, orchs, all, front)?.id).toBe('o-dev');
  });
  it('맡긴 기록이 없으면 그 프로젝트를 최근에 맡긴 참모', () => {
    expect(forwardTo(sub, [send('t3', 'project-b-ui', 'o-dev')], orchs, all, front)?.id).toBe('o-dev');
  });
  it('맡긴 참모가 꺼졌으면 프로젝트 → 그것도 없으면 맨 앞 참모', () => {
    expect(forwardTo(sub, [send('t1', 'project-b-fix', 'o-gone')], orchs, all, front)?.id).toBe('o-front');
    expect(forwardTo(sub, [], orchs, all, front)?.id).toBe('o-front');
  });
  it('앞 단계로 못 정하면 맡은 일로 고른 참모(heir), 그것도 없으면 맨 앞 — heir 는 앞 단계를 이기지 않는다', () => {
    const heir = () => dev;
    expect(forwardTo(sub, [send('t1', 'project-b-fix', 'o-gone')], orchs, all, front, heir)?.id).toBe('o-dev');
    expect(forwardTo(sub, [send('t1', 'project-b-fix', 'o-gone')], orchs, all, front, () => undefined)?.id).toBe('o-front');
    expect(forwardTo(sub, [send('t1', 'project-b-fix', 'o-front')], orchs, all, front, heir)?.id).toBe('o-front');
  });
  it('맡긴 참모가 --resume 으로 번호가 바뀌었으면 기록의 이름(fromName)으로 찾는다', () => {
    const named = (task: string, target: string, from: string, fromName: string): TaskEvent => ({ ...send(task, target, from), fromName });
    expect(forwardTo(sub, [named('t1', 'project-b-fix', 'o-old', '참모-5')], orchs, all, front)?.id).toBe('o-dev');
    expect(forwardTo(sub, [named('t3', 'project-b-ui', 'o-old', '참모-5 · 개발 담당')], orchs, all, front)?.id).toBe('o-dev'); // 프로젝트 단계도
    // 번호가 살아 있으면 번호가 먼저 — 이름은 못 찾을 때만
    expect(forwardTo(sub, [named('t1', 'project-b-fix', 'o-front', '참모-5')], orchs, all, front)?.id).toBe('o-front');
    // 같은 기본 이름이 없으면 예전처럼 맨 앞
    expect(forwardTo(sub, [named('t1', 'project-b-fix', 'o-old', '참모-9')], orchs, all, front)?.id).toBe('o-front');
  });
});

describe('nextForward — 받을 참모를 세션마다', () => {
  const dev = s('o-dev', { name: '참모-5', state: 'idle' });
  it('맡긴 참모가 확인창에 걸려 있으면 그 참모를 기다린다', () => {
    const r = nextForward([asking('x')], () => ({ ...dev, state: 'blocked' }), new Map([['x', 0]]), GRACE_MS, never);
    expect(r.sub).toBeUndefined();
    const r2 = nextForward([asking('x')], () => dev, r.track, GRACE_MS + 1, never);
    expect(r2.sub?.id).toBe('x');
    expect(r2.to?.id).toBe('o-dev');
  });
  it('넘긴 멈춤은 상태가 잠깐 흔들려도 다시 안 넘긴다 — 세션이 다시 일을 해야 새 멈춤', () => {
    const a = nextForward([asking('x')], () => dev, new Map([['x', 0]]), GRACE_MS, never);
    expect(a.sub?.id).toBe('x');
    const flick = nextForward([s('x', { state: 'blocked' })], () => dev, a.track, GRACE_MS + 1, never); // input needed 가 한 번 빠짐
    const again = nextForward([asking('x')], () => dev, flick.track, GRACE_MS * 3, never);
    expect(again.sub).toBeUndefined();
    const worked = nextForward([s('x', { state: 'working' })], () => dev, again.track, GRACE_MS * 4, never);
    const next = nextForward([asking('x')], () => dev, worked.track, GRACE_MS * 5, never);
    expect(nextForward([asking('x')], () => dev, next.track, GRACE_MS * 6, never).sub?.id).toBe('x');
  });
});

describe('inputWaitText — input needed 인데 선택지 창(AskUserQuestion)이 아닐 때', () => {
  it('"입력 기다림"으로, choice 안내 없이', () => {
    const t = inputWaitText(asking('a1b2c3d4', { name: 'project-b-fix', project: 'project-b' }));
    expect(t).toContain('입력 기다림');
    expect(t).not.toContain('choice');
    expect(t).toContain('a1b2c3d4');
  });
});

// 2026-09-30 조사 2번 — 맡긴 일이 안 닫혔는데 세션이 보고 없이(SendMessage 없이) 턴을 끝내고 쉬면 참모는 끝난 줄 모른다
describe('nextQuietForward — 안 닫은 일 + 말없이 쉬는 세션', () => {
  const T0 = Date.parse('2026-10-11T01:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const task = (over: Partial<TaskCard> = {}): TaskCard => ({ id: '1011-0950-ab12', target: 'acme', title: '로그인 버튼 고치기', status: 'sent', sentAt: iso(T0 - 30 * 60_000), updatedAt: iso(T0 - 30 * 60_000), ...over });
  const act = (over: Partial<Activity> = {}): Activity => ({
    prompt: { ts: iso(T0 - 30 * 60_000), text: '로그인 버튼 고쳐' },
    reply: { ts: iso(T0), text: '고쳤어. 커밋 a1b2c3d.', asks: false, turnEnd: true },
    ...over,
  });
  const cand = (a: Activity = act(), over: Partial<Session> = {}): AskCand => ({ session: s('acme', { state: 'idle', startedAt: T0 - 3600_000, ...over }), activity: a });
  const open = (t?: TaskCard) => () => (t?.status === 'sent' ? t : undefined); // openTaskOf 처럼 답 기록 없는 일만
  const later = T0 + QUIET_GRACE_MS;

  it('보고 없이 10분 쉬면 그 일과 함께 넘긴다', () => {
    expect(nextQuietForward([cand()], open(task()), orch, new Set(), T0 + 60_000, never)).toBeUndefined();
    expect(nextQuietForward([cand()], open(task()), orch, new Set(), later, never)).toMatchObject({ cand: { session: { id: 'acme' } }, task: { id: '1011-0950-ab12' } });
  });
  it('넘기지 않는 것 — 보고함·답 기록됨·일 없음·묻는 턴·백그라운드 기다림·새 지시·일보다 옛 답·이미 넘김·보는 중', () => {
    let n = 0;
    const no = (c: AskCand, t: TaskCard | null = task(), done = new Set<string>(), watching = never) => expect(nextQuietForward([c], open(t ?? undefined), orch, done, later, watching), `경우 ${++n}`).toBeUndefined();
    no(cand(act({ messaged: iso(T0 - 1000) })));
    no(cand(), task({ status: 'replied' }));
    no(cand(), null);
    no(cand(act({ reply: { ts: iso(T0), text: '어느 쪽으로 할까?', asks: true, turnEnd: true } })));
    no(cand(act(), { awaiting: true }));
    no(cand(act({ waitingOn: 1, wake: true }))); // 깨우기 예약 — 아직 안 끝남
    no(cand(act({ prompt: { ts: iso(T0 + 1000), text: '다음 거' } })));
    no(cand(act()), task({ sentAt: iso(T0 + 1000) }));
    no(cand(), task(), new Set([quietKeyOf(cand(), task())]));
    no(cand(), task(), new Set(), () => true);
  });
  // L11(2026-10-11 bug-hunt) — 쉬는 세션에 끝 알림 없이 남은 백그라운드 일은 죽인 일(살아 있으면 agents 가 working) — 말없이 쉼을 막지 않는다
  it('쉬는 세션의 죽인 백그라운드 일(waitingOn 만, 깨우기 없음)은 넘긴다', () => {
    expect(nextQuietForward([cand(act({ waitingOn: 1 }))], open(task()), orch, new Set(), later, never)).toMatchObject({ task: { id: '1011-0950-ab12' } });
  });
  it('두 번째 일부터 — 참모가 SendMessage 로 준 일(peer)이 턴의 시작. 앞 일 보고(messaged)로 막지 않는다(2026-10-11 bug-hunt)', () => {
    // 처음 띄울 때 지시(prompt) → 일1 보고(messaged) → 일2 는 SendMessage(peer, prompt 아님) → 말없이 끝냄
    const a = act({ prompt: { ts: iso(T0 - 3 * 3600_000), text: '처음 지시' }, messaged: iso(T0 - 2 * 3600_000), peer: { ts: iso(T0 - 30 * 60_000), text: '로그인 버튼 고쳐' } });
    expect(nextQuietForward([cand(a)], open(task()), orch, new Set(), later, never)).toMatchObject({ task: { id: '1011-0950-ab12' } });
    // 일2 턴에 보고했으면 안 넘긴다
    expect(nextQuietForward([cand({ ...a, messaged: iso(T0 - 1000) })], open(task()), orch, new Set(), later, never)).toBeUndefined();
    // 답 뒤에 새 SendMessage 가 왔으면(새 턴) 안 넘긴다
    expect(nextQuietForward([cand({ ...a, peer: { ts: iso(T0 + 1000), text: '다음 거' } })], open(task()), orch, new Set(), later, never)).toBeUndefined();
  });
  it('참모에게 보낼 한 줄 — 일 제목·몇 분째·마지막 말', () => {
    const t = quietForwardText(cand().session, act(), task(), later);
    expect(t).toContain('10분째');
    expect(t).toContain('로그인 버튼 고치기');
    expect(t).toContain('고쳤어. 커밋 a1b2c3d.');
    expect(t).toContain('scripts/task');
  });
});

describe('openTaskOf — 세션에 걸린 안 닫힌 일(가장 최근 보낸 것)', () => {
  it('그 세션을 대상으로 한 sent 일 중 최근 것', () => {
    const iso = (m: number) => new Date(Date.parse('2026-10-11T00:00:00Z') + m * 60_000).toISOString();
    const card = (id: string, target: string, status: TaskCard['status'], m: number): TaskCard => ({ id, target, title: id, status, sentAt: iso(m), updatedAt: iso(m) });
    const sessions = [s('acme', { state: 'idle' }), s('beta', { state: 'idle' })];
    const of = openTaskOf([card('t1', 'acme', 'sent', 1), card('t2', 'acme', 'sent', 5), card('t3', 'acme', 'done', 9), card('t4', 'beta', 'replied', 2)], sessions);
    expect(of(sessions[0]!)?.id).toBe('t2');
    expect(of(sessions[1]!)).toBeUndefined();
  });
});
