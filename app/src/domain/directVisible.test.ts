// 2026-10-05 아이맥 사고 재현 — 하위 세션이 저장소의 워크트리(<저장소>/.claude/worktrees/…)로 들어가면 agents --json cwd 가 그 경로가 되는데,
// 따로 추가한 프로젝트 폴더가 저장소 안 하위 폴더(<저장소>/blog)라 앱 세션 목록(withinRoots)에서 빠졌다 → 카드가 '꺼짐'으로 숨고 알림도 없었다.
// 이름·번호·경로는 가짜, 모양은 그날 기록 그대로
import { describe, expect, it } from 'vitest';
import { interleave } from './chatExtras';
import { cardShow, directCards, GONE_GRACE_MS, needsLook, placeDirect, stepSeen, type Seen } from './directAsk';
import { parseAgents, withinRoots } from './session';
import type { TaskEvent } from './tasks';

const DEV = '/Users/me/Desktop/dev';
const HQ = '/Users/me/.chammo/hq';
const EXTRAS = ['/Users/me/work/blog'];
const ORCH = { pid: 1, id: 'aa11bb22', cwd: HQ, kind: 'background', startedAt: 1, sessionId: 'aa11bb22-0000', name: '참모', status: 'idle', state: 'working' };
const ORCH2 = { ...ORCH, pid: 2, id: 'ee55ff66', sessionId: 'ee55ff66-0000', name: '참모-2' };
// 일하던 세션은 워크트리에 들어가 있다(EnterWorktree) — agents --json 은 그 워크트리 뿌리를 cwd 로 낸다
const BLOG = { pid: 3, id: 'cc33dd44', cwd: '/Users/me/work/.claude/worktrees/fix-x', kind: 'background', startedAt: 2, sessionId: 'cc33dd44-0000', name: 'blog', status: 'idle', state: 'working' };
const raw = (...xs: object[]) => JSON.stringify(xs);
const ASK_TS = '2026-01-01T09:00:00+00:00';
const T_ASK = Date.parse(ASK_TS);
// 카드를 연 셸은 워크트리 안 하위 폴더에 있었다
const LOG = JSON.stringify({ ts: ASK_TS, type: 'ask', id: 'c0ffee01', from: 'cc33dd44', cwd: '/Users/me/work/.claude/worktrees/fix-x/blog/content', q: '블로그 글을 지금 발행할까?', kind: 'send', yes: '보내기 승인', no: '거절', options: [] });
// 참모는 이름으로 일을 보냈다(task send blog)
const SEND: TaskEvent = { ts: '2026-10-05T05:10:00+00:00', type: 'send', task: 't1', target: 'blog', from: 'aa11bb22', fromName: '참모' };
const noAct = { prompt: () => undefined, reply: () => undefined };

const place = (agents: object[], o: { events?: TaskEvent[]; seen?: Seen; now?: number; front?: 'first' | 'none' } = {}) => {
  const everyone = parseAgents(raw(...agents), DEV, EXTRAS);
  const orchs = everyone.filter((s) => s.cwd === HQ);
  const now = o.now ?? T_ASK + 5_000;
  const seen = stepSeen(o.seen ?? {}, everyone.map((s) => s.id), now);
  return placeDirect(LOG, { everyone, seen, now, ...noAct, events: o.events ?? [SEND], orchs, front: o.front === 'none' ? undefined : orchs[0] });
};

describe('그날 재현 — 워크트리에 들어간 세션의 카드', () => {
  it('원인: 폴더로 거른 세션 목록에선 그 세션이 빠진다(그래서 옛 코드는 꺼짐으로 봤다)', () => {
    const everyone = parseAgents(raw(ORCH, BLOG), DEV, EXTRAS);
    const live = withinRoots(everyone, [DEV, HQ, ...EXTRAS]);
    expect(live.map((s) => s.id)).toEqual(['aa11bb22']);
    const old = directCards(LOG, { alive: (sid) => live.some((s) => s.id === sid), ...noAct });
    expect(old[0]!.state).toBe('gone'); // 14:10 카드가 안 보이고 알림도 안 갔던 이유
  });
  it('고침: 전체 목록(폴더 안 거름)으로 살아 있나 본다 → 기다림, 이름으로 보낸 참모 채팅으로', () => {
    const [p] = place([ORCH, BLOG]);
    expect(p!.card.state).toBe('wait');
    expect(p!.owner?.id).toBe('aa11bb22');
  });
  it('참모가 둘이어도 일을 보낸 참모에게 — 폴더로 거른 목록이면 이름을 못 찾아 맨 앞 참모로 갔다', () => {
    const sendBy2 = { ...SEND, from: 'ee55ff66', fromName: '참모-2' };
    const [p] = place([ORCH, ORCH2, BLOG], { events: [sendBy2] });
    expect(p!.owner?.id).toBe('ee55ff66');
  });
});

describe('재시작 — 같은 번호로 되살아나는 사이 잠깐 빠져도 기다림', () => {
  it('유예 안이면 기다림, 넘으면 꺼짐(다시 띄우기/닫기로 보인다), 다시 나타나면 기다림', () => {
    const seen = stepSeen({}, ['aa11bb22', 'cc33dd44'], T_ASK);
    expect(place([ORCH], { seen, now: T_ASK + 30_000 })[0]!.card.state).toBe('wait');
    const gone = place([ORCH], { seen, now: T_ASK + GONE_GRACE_MS + 1 })[0]!;
    expect(gone.card.state).toBe('gone');
    expect(needsLook(gone.card)).toBe(true);
    expect(cardShow(gone.card, T_ASK + 3 * 3600_000, {})).toBe('full'); // 몇 시간 지나도 숨지 않는다(전엔 5분 뒤 숨김)
    expect(cardShow(gone.card, T_ASK + 3 * 3600_000, { c0ffee01: gone.card.lastTs })).toBe('hide'); // 닫기는 사람 몫
    expect(place([ORCH, BLOG], { seen, now: T_ASK + GONE_GRACE_MS + 5_000 })[0]!.card.state).toBe('wait');
  });
  it('세션 목록을 아직 못 읽었으면(빈 목록) 꺼짐으로 단정하지 않는다 — 앱을 켤 때 카드가 꺼짐으로 번쩍였다', () => {
    const everyone: never[] = [];
    const [p] = placeDirect(LOG, { everyone, seen: {}, now: T_ASK, ...noAct, events: [SEND], orchs: [], unknown: true });
    expect(p!.card.state).toBe('wait');
  });
  it('앱을 막 켰는데 세션이 목록에 없으면 바로 꺼짐(옛 기록에 기대지 않는다)', () => {
    expect(place([ORCH], { seen: {} })[0]!.card.state).toBe('gone');
  });
  it('오래 안 보인 번호는 기록에서 지운다(끝없이 쌓이지 않게)', () => {
    const s = stepSeen({ old: T_ASK - 24 * 3600_000 }, ['x'], T_ASK);
    expect(Object.keys(s)).toEqual(['x']);
  });
});

describe('기다리는 카드는 어떤 경우에도 숨지 않는다', () => {
  const cases: { name: string; agents: object[]; events: TaskEvent[]; front: 'first' | 'none' }[] = [
    { name: '워크트리 세션 + 이름 send', agents: [ORCH, BLOG], events: [SEND], front: 'first' },
    { name: 'send 없음', agents: [ORCH, BLOG], events: [], front: 'first' },
    { name: '보낸 참모가 꺼짐', agents: [ORCH2, BLOG], events: [SEND], front: 'first' },
    { name: '참모가 하나도 없음', agents: [BLOG], events: [SEND], front: 'none' },
    { name: '세션이 목록에서 빠짐(꺼짐)', agents: [ORCH], events: [SEND], front: 'first' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const [p] = place(c.agents, { events: c.events, front: c.front, now: T_ASK + 6 * 3600_000 });
      // 결정 대기함(상단 종)은 늘 받는다 — 어느 화면·참모를 보든
      expect(cardShow(p!.card, T_ASK + 6 * 3600_000, {})).toBe('full');
      // 참모가 하나라도 살아 있으면 그 참모 채팅에도
      if (c.front === 'first') expect(p!.owner).toBeDefined();
    });
  }
});

describe('채팅에 끼우기 — 기다리는 카드는 물은 시각 자리 말고 맨 아래', () => {
  const msgs = [{ ts: '2026-10-05T05:10:28Z', id: 'm1' }, { ts: '2026-10-05T07:00:00Z', id: 'm2' }, { ts: '2026-10-05T10:00:00Z', id: 'm3' }];
  it('고정 카드는 뒤 말보다 아래, 끝난 한 줄은 시각 자리', () => {
    const out = interleave(msgs, [
      { ts: ASK_TS, key: 'wait', pin: true },
      { ts: '2026-10-05T06:00:00Z', key: 'line' },
    ]).map((x) => ('item' in x ? x.item.id : x.extra.key));
    expect(out).toEqual(['m1', 'line', 'm2', 'm3', 'wait']);
  });
  it('보이는 말보다 앞선 끝난 한 줄은 맨 위(전과 같음)', () => {
    const out = interleave(msgs.slice(1), [{ ts: '2026-10-05T01:00:00Z', key: 'early' }]).map((x) => ('item' in x ? x.item.id : x.extra.key));
    expect(out).toEqual(['early', 'm2', 'm3']);
  });
});
