import { describe, expect, it } from 'vitest';
import { isHqOrch, lastDoing, lostAsSession, lostVerdict, forgetLost, planNotices, restartNotice, triageLost } from './lostTriage';
import { stepSnapshot } from './revive';
import type { Session } from './session';
import type { Activity } from './activity';
import type { SnapSession } from './revive';
import type { TaskEvent } from './tasks';

const lost = (name: string, sid: string, over: Partial<SnapSession> = {}): SnapSession => ({ sessionId: sid, name, cwd: `/dev/${name}`, id: sid.slice(0, 8), ...over });
const send = (task: string, target: string, from: string, ts: string, title = '일'): TaskEvent => ({ ts, type: 'send', task, target, from, title });
const done = (task: string, ts: string): TaskEvent => ({ ts, type: 'done', task });
const report = (ts: string, over: Partial<NonNullable<Activity['reply']>> = {}): Activity => ({ reply: { ts, text: '다 했어. 결과는 docs/report.md', turnEnd: true, asks: false, ...over } });

// 재현: 둘 다 이어 켤 필요 없는데 사람에게 물었다
const rep = lost('shop-report', 'f00d0001-0000-4000-8000-00000000000a');
const viewer = lost('web-viewer', 'f00d0002-0000-4000-8000-00000000000b', { cwd: '/dev/honor-orchestrator' });
const realEvents: TaskEvent[] = [
  send('t-in', 'web-viewer', 'cafe0001', '2026-01-03T10:00:00Z'),
  send('t-k1', 'shop-report', 'cafe0002', '2026-01-02T09:00:00Z'),
  done('t-k1', '2026-01-02T09:05:00Z'),
  send('t-k2', 'shop-report', 'cafe0002', '2026-01-02T09:10:00Z'), // 주인 오케스트레이터가 닫지 않고 꺼졌다
  send('t-k3', 'shop-report', 'cafe0002', '2026-01-02T09:15:00Z'),
];

describe('재현 — 재시작 카드에 끝난 세션이 떴다(2026-10-04)', () => {
  it('보고까지 하고 끝난 rep 와 claude rm 된 web-viewer 는 둘 다 조용히 빠진다', () => {
    const r = triageLost([rep, viewer], {
      events: realEvents,
      activity: { [rep.sessionId]: report('2026-01-02T10:30:00Z') },
      listed: (s) => s === rep, // web-viewer 는 agents --all 에 없다(rm)
      isOrch: () => false,
      autoRevive: false,
    });
    expect(r.drop.map((s) => s.name)).toEqual(['shop-report', 'web-viewer']);
    expect(r.open).toEqual([]);
  });
});

const T0 = '2026-10-04T01:00:00Z';
const T1 = '2026-10-04T02:00:00Z';
const T2 = '2026-10-04T03:00:00Z';
const a = lost('todo-api', 'aaaa1111-0000-4000-8000-000000000001');

describe('lostVerdict — 꺼진 세션이 끝났나(애매하면 안 끝남)', () => {
  const base = { events: [] as TaskEvent[], listed: true as boolean | undefined };
  it('claude rm 돼서 agents --all 에 없으면 끝', () => {
    expect(lostVerdict(a, { ...base, listed: false })).toBe('finished');
  });
  it('목록을 못 읽었으면(모름) rm 으로 치지 않는다', () => {
    expect(lostVerdict(a, { ...base, listed: undefined })).toBe('open');
  });
  it('마지막 답이 끝맺음 보고면 끝 — 맡긴 일을 done 으로 안 닫았어도', () => {
    expect(lostVerdict(a, { events: [send('t1', 'todo-api', 'o1', T0)], activity: report(T1), listed: true })).toBe('finished');
  });
  it('맡긴 일이 다 done 이고 턴이 끝나 있으면 끝 — 마지막 답이 질문이어도', () => {
    const ev = [send('t1', 'todo-api', 'o1', T0), done('t1', T1)];
    expect(lostVerdict(a, { events: ev, activity: report(T1, { asks: true }), listed: true })).toBe('finished');
  });
  it('마지막 답이 사람에게 묻는 말이고 일이 안 닫혔으면 안 끝남', () => {
    expect(lostVerdict(a, { events: [send('t1', 'todo-api', 'o1', T0)], activity: report(T1, { asks: true }), listed: true })).toBe('open');
  });
  it('일하는 도중 꺼졌으면(꺼질 때 busy) 안 끝남 — 일이 다 done 이어도', () => {
    const ev = [send('t1', 'todo-api', 'o1', T0), done('t1', T1)];
    expect(lostVerdict({ ...a, busy: true }, { events: ev, activity: report(T1), listed: true })).toBe('open');
  });
  it('턴 중간에 끊긴 기록(도구 부르기 전 멘트가 마지막)이면 안 끝남', () => {
    expect(lostVerdict(a, { events: [], activity: report(T1, { turnEnd: undefined, midTurn: true }), listed: true })).toBe('open');
  });
  it('답 뒤에 새 지시가 들어와 있으면 안 끝남', () => {
    expect(lostVerdict(a, { events: [], activity: { ...report(T1), prompt: { ts: T2, text: '이것도 해 줘' } }, listed: true })).toBe('open');
  });
  it('사용 한도로 멈춘 채 꺼졌으면 안 끝남', () => {
    expect(lostVerdict(a, { events: [], activity: { ...report(T1), limit: { ts: T1, text: 'hit your limit' } }, listed: true })).toBe('open');
  });
  it('기록을 못 읽었으면: 꺼질 때 쉬고 있었고(busy:false) 일이 다 done 일 때만 끝', () => {
    const ev = [send('t1', 'todo-api', 'o1', T0), done('t1', T1)];
    expect(lostVerdict({ ...a, busy: false }, { events: ev, listed: true })).toBe('finished');
    expect(lostVerdict(a, { events: ev, listed: true })).toBe('open'); // 옛 live.json — busy 를 모른다
    expect(lostVerdict({ ...a, busy: false }, { events: [], listed: true })).toBe('open'); // 맡긴 일이 없다 = 다 done 이 아니다
  });
  it('보고처럼 끝났어도 무언가를 기다리는 말(CI 기다리는 중·끝나면 알려줄게)이면 안 끝남 — 백그라운드 감시는 재시작으로 죽었다(리뷰 2)', () => {
    const ev = [send('t1', 'todo-api', 'o1', T0)];
    for (const text of ['PR #12의 CI(lint·test)를 기다리는 중이야. 끝나면 결과를 붙여 보고할게', '빌드 돌려 뒀어 — 끝나는 대로 알려줄게', 'Waiting for the deploy to finish.'])
      expect(lostVerdict(a, { events: ev, activity: report(T1, { text, tail: text }), listed: true }), text).toBe('open');
  });
  it('답 뒤에 도구만 부른 새 턴(참모 메시지·작업 알림으로 깨어남)이 있으면 안 끝남 — 마지막 줄이 답보다 뒤(리뷰 3)', () => {
    expect(lostVerdict(a, { events: [], activity: { ...report(T1), lastAt: T2 }, listed: true })).toBe('open');
    expect(lostVerdict(a, { events: [], activity: { ...report(T1), lastAt: T1 }, listed: true })).toBe('finished');
  });
  it('같은 이름의 옛 세션 기록은 섞지 않는다 — 이름으로 보낸 일은 이 세션이 뜬 뒤(10분 여유) 것만(리뷰 5)', () => {
    const ev = [send('t-old', 'todo-api', 'o1', T0), done('t-old', T0)]; // 한 시간 전 같은 이름 다른 세션
    const me = { ...a, startedAt: Date.parse(T1) };
    expect(lostVerdict(me, { events: ev, activity: report(T2, { asks: true }), listed: true })).toBe('open');
    expect(lostVerdict({ ...me, busy: false }, { events: ev, listed: true })).toBe('open');
    // 짧은 번호로 보낸 건 시각과 상관없이 이 세션 것
    const byId = [send('t-id', 'aaaa1111', 'o1', T0), done('t-id', T0)];
    expect(lostVerdict({ ...me, busy: false }, { events: byId, listed: true })).toBe('finished');
  });
  it('일이 하나라도 안 닫혔고 답도 묻는 말이면 안 끝남 — 이름·[번호] 꼴 대상도 같은 세션으로 본다', () => {
    const ev = [send('t1', 'todo-api', 'o1', T0), done('t1', T1), send('t2', 'todo-api [aaaa1111]', 'o1', T1)];
    expect(lostVerdict(a, { events: ev, activity: report(T2, { asks: true }), listed: true })).toBe('open');
  });
});

describe('triageLost — 참모 세션·자동으로 다시 켜기', () => {
  const o = lost('참모-3', 'oooo3333-0000-4000-8000-000000000003', { cwd: '/hq' });
  const opt = { events: [] as TaskEvent[], activity: {}, listed: () => true as boolean | undefined, isOrch: (s: SnapSession) => s === o };
  it('꺼진 참모는 이 길에서 뺀다 — 참모는 사람이 홈에서 고른다(2026-10-03)', () => {
    const r = triageLost([o, a], { ...opt, autoRevive: false });
    expect(r.drop).toEqual([o]);
    expect(r.open).toEqual([a]);
  });
  it('자동으로 다시 켜기를 켠 무인 맥이면 참모는 남겨 둔다(자동 되살리기 몫), 끝난 세션은 그래도 뺀다', () => {
    const r = triageLost([o, a, rep], { ...opt, activity: { [rep.sessionId]: report(T1) }, autoRevive: true });
    expect(r.drop).toEqual([rep]);
    expect(r.open).toEqual([a]);
  });
});

const orch = (id: string, name: string, over: Partial<Session> = {}): Session => ({ id, name, cwd: '/hq', kind: 'background', state: 'idle', project: 'hq', workspace: null, startedAt: 0, sessionId: `${id}-sid`, ...over });

describe('planNotices — 안 끝난 꺼진 세션을 받을 참모', () => {
  const o1 = orch('o1', '참모-1');
  const o2 = orch('o2', '참모-2 · 개발');
  const plan = (events: TaskEvent[], orchs: Session[], heir?: (s: Session) => Session | undefined, list: SnapSession[] = [a]) =>
    planNotices(list, { events, orchs, sessions: [], front: orchs[0], heir, devRoot: '/dev' });

  it('그 세션에 마지막으로 일을 보낸 참모에게', () => {
    const r = plan([send('t1', 'todo-api', 'o2', T0)], [o1, o2]);
    expect(r.notices).toEqual([{ to: o2, sessions: [a] }]);
    expect(r.hold).toEqual([]);
  });
  it('주인이 둘이면 마지막에 보낸 쪽', () => {
    const r = plan([send('t1', 'todo-api', 'o2', T0), send('t2', 'todo-api', 'o1', T1)], [o1, o2]);
    expect(r.notices[0]!.to).toBe(o1);
  });
  it('주인이 꺼졌으면 맡은 일이 같은 참모(heir) — 꺼진 세션도 heir 가 같은 세션으로 알아본다', () => {
    let seen: Session | undefined;
    const r = plan([send('t1', 'todo-api', 'o7', T0)], [o1, o2], (s) => { seen = s; return o2; });
    expect(r.notices[0]!.to).toBe(o2);
    expect(seen).toMatchObject({ id: 'aaaa1111', name: 'todo-api', project: 'todo-api', sessionId: a.sessionId });
  });
  it('heir 도 없으면 맨 앞 참모', () => {
    const r = plan([send('t1', 'todo-api', 'o7', T0)], [o1, o2], () => undefined);
    expect(r.notices[0]!.to).toBe(o1);
  });
  it('같은 참모에게 갈 것은 한 번에 묶는다', () => {
    const b = lost('shop', 'bbbb2222-0000-4000-8000-000000000002');
    const r = plan([], [o1], undefined, [a, b]);
    expect(r.notices).toEqual([{ to: o1, sessions: [a, b] }]);
  });
  it('참모가 하나도 안 떠 있으면 붙잡아 둔다(사람에게 짧게 보일 것)', () => {
    const r = plan([send('t1', 'todo-api', 'o1', T0)], []);
    expect(r.notices).toEqual([]);
    expect(r.hold).toEqual([a]);
  });
  it('받을 참모가 확인창에 걸려 있으면 이번엔 안 보낸다(입력칸에 치면 선택지를 골라 버린다) — 붙잡지도 않는다', () => {
    const r = plan([send('t1', 'todo-api', 'o1', T0)], [orch('o1', '참모-1', { state: 'blocked' })]);
    expect(r.notices).toEqual([]);
    expect(r.hold).toEqual([]);
  });
});

describe('restartNotice — 참모 입력칸에 넣을 한 줄', () => {
  it('하나면 정한 문구 그대로', () => {
    expect(restartNotice([{ s: a, doing: '할 일 API 만들기' }])).toBe('[앱] 재시작으로 꺼진 세션: todo-api(aaaa1111) — 하던 일 할 일 API 만들기. 이어서 켜려면 claude respawn aaaa1111, 끝난 거면 그냥 둬');
  });
  it('하던 일을 모르면 그 칸을 뺀다', () => {
    expect(restartNotice([{ s: a }])).toBe('[앱] 재시작으로 꺼진 세션: todo-api(aaaa1111). 이어서 켜려면 claude respawn aaaa1111, 끝난 거면 그냥 둬');
  });
  it('여럿이면 개수와 함께 한 줄로', () => {
    const b = lost('shop', 'bbbb2222-0000-4000-8000-000000000002');
    const t = restartNotice([{ s: a, doing: 'API' }, { s: b }]);
    expect(t).toBe('[앱] 재시작으로 꺼진 세션 2개: todo-api(aaaa1111) — 하던 일 API · shop(bbbb2222). 이어서 켜려면 claude respawn <짧은 번호>, 끝난 거면 그냥 둬');
    expect(t).not.toContain('\n');
  });
  it('짧은 번호가 없는 옛 기록이면 그 폴더에서 대화 id 로 잇는 명령 — 공백 든 경로도 따옴표로', () => {
    const t = restartNotice([{ s: { ...a, id: undefined } }]);
    expect(t).toContain(`cd "/dev/todo-api" && claude --bg --dangerously-skip-permissions --resume ${a.sessionId}`);
    expect(restartNotice([{ s: { ...a, id: undefined, cwd: '/Users/me/My Projects/x' } }])).toContain('cd "/Users/me/My Projects/x" &&');
  });
});

describe('lastDoing — 하던 일 한 줄', () => {
  it('마지막으로 시킨 일 제목', () => {
    expect(lastDoing(a, [send('t1', 'todo-api', 'o1', T0, '옛 일'), send('t2', 'todo-api', 'o1', T1, '새 일')])).toBe('새 일');
  });
  it('시킨 기록이 없으면 마지막 지시(대화 기록), 길면 줄이고 줄바꿈은 편다', () => {
    const long = '가'.repeat(100);
    expect(lastDoing(a, [], { prompt: { ts: T0, text: long } })).toBe('가'.repeat(60) + '…');
    expect(lastDoing(a, [], { prompt: { ts: T0, text: '첫 줄\n둘째 줄' } })).toBe('첫 줄 둘째 줄');
    expect(lastDoing(a, [])).toBeUndefined();
  });
});

describe('forgetLost — 같은 알림은 두 번 안 보낸다', () => {
  const live = (name: string, sid: string, state: Session['state'] = 'idle'): Session => ({ id: sid.slice(0, 8), name, cwd: `/dev/${name}`, kind: 'background', state, project: name, workspace: null, startedAt: 0, sessionId: sid });
  it('알린 세션은 꺼진 목록에서 빠지고, 다음 폴링·다음 재시작에도 다시 안 들어온다', () => {
    let snap = stepSnapshot(null, 1, [live('todo-api', a.sessionId), live('참모-1', 'o1sid')], 0)!;
    snap = stepSnapshot(snap, 2, [live('참모-1', 'o1sid')], 10)!; // 재시작 — todo-api 가 꺼짐
    expect(snap.lost.map((x) => x.name)).toEqual(['todo-api']);
    snap = forgetLost(snap, [a.sessionId]);
    expect(snap.lost).toEqual([]);
    snap = stepSnapshot(snap, 2, [live('참모-1', 'o1sid')], 20)!;
    expect(snap.lost).toEqual([]);
    snap = stepSnapshot(snap, 3, [], 30)!; // 또 재시작
    expect(snap.lost.map((x) => x.name)).toEqual(['참모-1']);
  });
  it('일하던 세션은 기록에 busy 를 남긴다(꺼질 때 일하는 중이었는지)', () => {
    const snap = stepSnapshot(null, 1, [live('todo-api', a.sessionId, 'working'), live('shop', 'bbbb2222-0000-4000-8000-000000000002')], 0)!;
    expect(snap.sessions.find((x) => x.name === 'todo-api')?.busy).toBe(true);
    expect(snap.sessions.find((x) => x.name === 'shop')?.busy).toBe(false);
  });
  it('사람 답을 기다리며 멈춘 세션(awaiting — state 는 쉼으로 읽힌다)도 busy — 끝난 게 아니다(2026-10-04 개발판 실측)', () => {
    const snap = stepSnapshot(null, 1, [{ ...live('beta-blog', a.sessionId), awaiting: true }], 0)!;
    expect(snap.sessions[0]!.busy).toBe(true);
  });
});

describe('lostAsSession — 꺼진 세션의 프로젝트', () => {
  it('워크트리 안이면 프로젝트는 본체 폴더 이름', () => {
    expect(lostAsSession(lost('rep', 'k', { cwd: '/dev/shop-report/.claude/worktrees/resolve-2026', id: 'f00d0001' }), '/dev')).toMatchObject({ id: 'f00d0001', project: 'shop-report', workspace: 'resolve-2026' });
  });
  it('짧은 번호가 없으면 대화 id 로', () => {
    expect(lostAsSession({ ...a, id: undefined }, '/dev').id).toBe(a.sessionId);
  });
});

describe('isHqOrch — 꺼진 참모인가(HQ 폴더의 비서 이름 꼴)', () => {
  it('HQ 폴더 + 참모 이름 꼴만', () => {
    expect(isHqOrch(lost('참모-2 · 개발', 'x', { cwd: '/hq/' }), '/hq')).toBe(true);
    expect(isHqOrch(lost('web-viewer', 'x', { cwd: '/hq' }), '/hq')).toBe(false); // HQ 도우미는 하위 세션 길
    expect(isHqOrch(lost('참모', 'x', { cwd: '/dev/shop' }), '/hq')).toBe(false);
    expect(isHqOrch(lost('참모', 'x', { cwd: '/hq' }), '')).toBe(false);
  });
  it('윈도우 경로는 빗금·대소문자를 맞춰 본다(리뷰 6)', () => {
    expect(isHqOrch(lost('참모', 'x', { cwd: 'C:/Users/Me/Chammo/hq' }), 'c:\\Users\\me\\chammo\\hq\\')).toBe(true);
  });
});
