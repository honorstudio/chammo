import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { bornAfter, buildInbox, decideNote, findTarget, freshItems, gateReply, popoverOpen, replyBlocked, replyHint } from './inbox';
import type { Session } from './session';
import type { ActivityStatus } from './status';
import type { TaskEvent } from './tasks';

const s = (id: string, project: string, workspace: string | null = null): Session =>
  ({ id, name: project, cwd: `/d/${project}`, kind: 'background', state: 'idle', project, workspace, sessionId: `sid-${id}` }) as Session;
const act = (session: Session, status: ActivityStatus, text = '', ts = '2026-09-27T01:00:00Z') => ({ session, status, activity: { reply: { ts, text } } });
const ev = (type: TaskEvent['type'], task: string, ts: string, extra: Partial<TaskEvent> = {}): TaskEvent => ({ ts, type, task, ...extra });

describe('buildInbox — 나한테 온 것만 한 칸에', () => {
  it('참모 세션이 질문으로 끝났거나 확인창에 멈췄으면', () => {
    const items = buildInbox([act(s('a', 'todo-api'), 'asks', 'PR 올렸어. 머지할까?'), act(s('b', 'crm', 'crm'), 'blocked'), act(s('c', 'acme-shop'), 'done', '끝났어')], [], new Set(), [], () => true);
    expect(items.map((i) => [i.kind, i.project, i.where, i.text])).toEqual([
      ['ask', 'todo-api', '', 'PR 올렸어. 머지할까?'],
      ['blocked', 'crm', 'crm', '확인창·선택지에서 멈춰 있어 — 열어서 골라줘'],
    ]);
  });

  it('하위 세션이 물은 건 참모한테 한 말이라 안 띄운다 — 참모 세션 것만(사용자 2026-09-27)', () => {
    const orch = { ...s('o', 'honor-orchestrator'), name: '참모' };
    const acts = [act(orch, 'asks', '이거 머지할까?'), act(s('a', 'todo-api'), 'asks', '참모, 머지할까?'), act(s('b', 'crm'), 'blocked')];
    const items = buildInbox(acts, [], new Set(), [], (x) => x.id === 'o');
    expect(items.map((i) => [i.kind, i.project])).toEqual([['ask', 'honor-orchestrator']]);
  });

  it('참모가 여럿이면 제목은 폴더 이름(hq) 말고 그 참모 이름 — 누가 묻는지(2026-10-04 QA)', () => {
    const a = { ...s('o1', 'hq'), name: '참모-2 · 뽀삐' };
    const b = { ...s('o2', 'hq'), name: '참모-3' };
    const items = buildInbox([act(a, 'asks', '어느 안으로 할까?'), act(b, 'blocked')], [], new Set(), [], () => true, (x) => (x.id === 'o1' ? '뽀삐' : '참모 C'));
    expect(items.map((i) => [i.kind, i.project, i.where])).toEqual([['ask', '뽀삐', ''], ['blocked', '참모 C', '']]);
  });

  it('scripts/task ask 로 올린 결정 — answer·done 이 오기 전까지', () => {
    const evs = [ev('send', 't1', '2026-09-27T00:00:00Z', { target: 'todo-api', title: '결제 붙이기' }), ev('ask', 't1', '2026-09-27T00:10:00Z', { note: '실결제 테스트 해도 돼?' })];
    expect(buildInbox([], evs, new Set()).map((i) => [i.kind, i.where, i.text, i.target])).toEqual([['decide', '결제 붙이기', '실결제 테스트 해도 돼?', 'todo-api']]);
    expect(buildInbox([], [...evs, ev('answer', 't1', '2026-09-27T00:20:00Z', { note: 'ㅇㅇ' })], new Set())).toEqual([]);
    expect(buildInbox([], [...evs, ev('done', 't1', '2026-09-27T00:20:00Z')], new Set())).toEqual([]);
  });

  it('결정 뒤에 넘기기(own)가 와도 카드는 남는다 — 답은 아직 없다(2026-10-21 리뷰: 결제 확인 카드가 handoff 로 사라졌다)', () => {
    const evs = [ev('send', 't1', '2026-09-27T00:00:00Z', { title: '결제 붙이기', target: 'todo-api' }), ev('ask', 't1', '2026-09-27T00:10:00Z', { note: '보내도 돼?' }),
      ev('own', 't1', '2026-09-27T00:11:00Z', { from: 'o2' })];
    expect(buildInbox([], evs, new Set()).map((i) => [i.kind, i.text])).toEqual([['decide', '보내도 돼?']]);
    expect(buildInbox([], [...evs, ev('answer', 't1', '2026-09-27T00:20:00Z', { note: 'ㅇㅇ' })], new Set())).toEqual([]);
  });

  it('ask 에 to(물어본 참모 세션)가 있으면 답장은 그쪽으로 — 위험 지시 확인', () => {
    const evs = [ev('send', 't3', '2026-09-27T00:00:00Z', { target: 'todo-api', title: '프로덕션 배포' }), ev('ask', 't3', '2026-09-27T00:00:01Z', { note: '위험 지시 확인 — todo-api: 프로덕션 배포 — 보내도 돼?', to: 'sid-orch' })];
    expect(buildInbox([], evs, new Set())[0]?.target).toBe('sid-orch');
  });

  it('답장 대상은 세션 id·이름·sessionId 어느 걸로 적혀 있어도 찾는다', () => {
    const item = { key: 'k', kind: 'decide' as const, project: 'p', where: 'x', text: '?', ts: '', target: 'sid-o' };
    expect(replyBlocked(item, [{ ...s('o', '참모'), state: 'idle' }])).toBeNull();
  });

  it('하위 세션 회신·메모에 "사용자 확인 대기"가 적혀도 결정으로 안 올린다 — 올릴지는 참모가 task ask 로 정한다', () => {
    const evs = [ev('send', 't2', '2026-09-27T00:00:00Z', { target: 'cookbook', title: '반반 오답' }), ev('note', 't2', '2026-09-27T00:05:00Z', { note: 'PR #32 CI 초록, 머지 대기(사용자 확인 필요)' })];
    expect(buildInbox([], evs, new Set())).toEqual([]);
  });

  it('처리함으로 치운 건 빠진다 (같은 질문일 때만 — 새 질문이 오면 다시 뜬다)', () => {
    const a = act(s('a', 'todo-api'), 'asks', '머지할까?', '2026-09-27T01:00:00Z');
    const all = () => true;
    const [item] = buildInbox([a], [], new Set(), [], all);
    expect(buildInbox([a], [], new Set([item!.key]), [], all)).toEqual([]);
    expect(buildInbox([act(s('a', 'todo-api'), 'asks', '배포할까?', '2026-09-27T02:00:00Z')], [], new Set([item!.key]), [], all)).toHaveLength(1);
  });

  it('최근 것이 위로', () => {
    const items = buildInbox([act(s('a', 'todo-api'), 'asks', '1?', '2026-09-27T01:00:00Z'), act(s('b', 'crm'), 'asks', '2?', '2026-09-27T03:00:00Z')], [], new Set(), [], () => true);
    expect(items.map((i) => i.project)).toEqual(['crm', 'todo-api']);
  });
});

describe('어느 프로젝트 이야기인지 — 모든 칸에 project', () => {
  it('세션 칸은 세션의 프로젝트, 기록 칸은 일을 받은 세션의 프로젝트(물어본 참모가 아니라)', () => {
    const sessions = [s('t', 'acme-shop-platform', 'trade-flow'), { ...s('o', 'honor-orchestrator'), name: '참모' }];
    const evs = [ev('send', 't9', '2026-09-27T00:00:00Z', { target: 't', title: '시뮬레이터 computer-use 권한' }), ev('ask', 't9', '2026-09-27T00:01:00Z', { note: '허용할까?', to: 'sid-o' })];
    const [decide] = buildInbox([], evs, new Set(), sessions);
    expect(decide).toMatchObject({ project: 'acme-shop-platform', where: '시뮬레이터 computer-use 권한', target: 'sid-o' });
    const [ask] = buildInbox([act(sessions[0]!, 'asks', '머지할까?')], [], new Set(), sessions, () => true);
    expect(ask).toMatchObject({ project: 'acme-shop-platform', where: 'trade-flow' });
  });

  it('세션이 없어졌으면 기록에 적힌 대상 이름으로', () => {
    const evs = [ev('send', 't8', '2026-09-27T00:00:00Z', { target: 'cookbook', title: '반반' }), ev('ask', 't8', '2026-09-27T00:01:00Z', { note: '?' })];
    expect(buildInbox([], evs, new Set(), [])[0]).toMatchObject({ project: 'cookbook', where: '반반' });
  });
});

describe('로그인 오류로 멈춘 세션 — 세션마다 칸을 안 띄운다(카드 하나, domain/login)', () => {
  const err = 'Login expired · Please run /login';
  it('로그인 필요(status login)는 결정 대기 칸이 아니다 — 맨 위 로그인 카드가 묶어서 보여 준다', () => {
    expect(buildInbox([act(s('g', 'acme-shop-platform', 'pr-g'), 'login', err)], [], new Set())).toEqual([]);
    expect(buildInbox([act(s('b', 'hq'), 'login', err)], [], new Set(), [], () => true)).toEqual([]); // 참모여도
  });
});

describe('replyBlocked — 확인창·선택지에 멈춘 세션엔 답장을 꽂지 않는다 (키 입력이 메뉴를 엉뚱하게 고른다)', () => {
  const item = { key: 'k', kind: 'decide' as const, project: 'p', where: 'acme-shop', text: '?', ts: '', target: 'acme-shop' };
  it('대상 세션이 blocked 면 막고 이유를 준다', () => {
    expect(replyBlocked(item, [{ ...s('t', 'acme-shop'), name: 'acme-shop', state: 'blocked' }])).toBe('선택지·확인창에 멈춰 있어서 답장을 넣으면 메뉴가 잘못 골라질 수 있어 — 열어서 직접 골라줘');
  });
  it('입력 대기면 통과(null), 세션이 없으면 이유', () => {
    expect(replyBlocked(item, [{ ...s('t', 'acme-shop'), name: 'acme-shop', state: 'idle' }])).toBeNull();
    expect(replyBlocked(item, [])).toBe('세션이 없어 — 꺼진 세션이면 이어서 띄워줘');
  });
});

describe('freshItems — 새로 생긴 결정만 알림(토스트·macOS 알림)', () => {
  const it1 = { key: 'a', kind: 'ask' as const, project: 'todo-api', where: '', text: '?', ts: '1' };
  const it2 = { ...it1, key: 'b' };
  it('앱을 막 켰을 때(이전 기록 없음)는 알리지 않는다', () => {
    expect(freshItems(null, [it1])).toEqual([]);
  });
  it('이전에 없던 열쇠만', () => {
    expect(freshItems(new Set(['a']), [it1, it2])).toEqual([it2]);
  });
  it('처리해서 빠졌다가 같은 게 다시 오면(같은 열쇠) 또 알리지 않는다 — 이전 목록에 없으면 알린다', () => {
    expect(freshItems(new Set(['a', 'b']), [it2])).toEqual([]);
  });
});

describe('bornAfter — 앱을 켜기 전에 생긴 결정은 알림으로 다시 안 띄운다(윈도우 설치판: 켤 때마다 옛 결정이 토스트로 줄줄이)', () => {
  const at = (ts: string) => ({ key: ts, kind: 'decide' as const, project: 'p', where: '', text: '?', ts });
  const start = Date.parse('2026-10-01T01:40:00+09:00');
  it('켠 뒤 것만', () => {
    expect(bornAfter(at('2026-10-01T01:39:00+09:00'), start)).toBe(false);
    expect(bornAfter(at('2026-10-01T01:41:00+09:00'), start)).toBe(true);
  });
  it('시각을 못 읽으면 알린다(예전처럼)', () => expect(bornAfter(at('?'), start)).toBe(true));
});

describe('popoverOpen — 결정이 들어오면 펼치고, 내가 닫으면(나중에) 다음 새 결정까지 접어 둔다', () => {
  const it1 = { key: 'a', kind: 'ask' as const, project: 'todo-api', where: '', text: '?', ts: '1' };
  const it2 = { ...it1, key: 'b' };
  it('앱을 켰을 때 쌓여 있으면 펼친다', () => expect(popoverOpen(false, null, [it1])).toBe(true));
  it('앱을 켰을 때 없으면 접는다', () => expect(popoverOpen(false, null, [])).toBe(false));
  it('새 결정이 오면 닫아 놨어도 펼친다', () => expect(popoverOpen(false, new Set(['a']), [it1, it2])).toBe(true));
  it('새 게 없으면 닫아 둔 걸 그대로 둔다(나중에)', () => expect(popoverOpen(false, new Set(['a', 'b']), [it1, it2])).toBe(false));
  it('새 게 없으면 펼쳐 둔 것도 그대로', () => expect(popoverOpen(true, new Set(['a']), [it1])).toBe(true));
  it('다 처리해서 비면 접는다', () => expect(popoverOpen(true, new Set(['a']), [])).toBe(false));
  // 2026-10-22 첫 사용자 QA 21: 새 물음마다 저절로 펼쳐져 오른쪽 위를(설정 창 위로도) 덮었다
  const dec = { ...it1, key: 'd', kind: 'decide' as const };
  it('재현: 설정 창이 떠 있으면 새 결정이 와도 펼치지 않는다(펼쳐 둔 건 그대로)', () => {
    expect(popoverOpen(false, new Set(['a']), [it1, dec], { hold: true })).toBe(false);
    expect(popoverOpen(true, new Set(['a']), [it1, dec], { hold: true })).toBe(true);
  });
  it('재현: 채팅에 이미 보이는 참모 물음(ask)은 펼치지 않는다 — 결정(decide)은 펼친다', () => {
    expect(popoverOpen(false, new Set(['a']), [it1, it2], { askInView: true })).toBe(false);
    expect(popoverOpen(false, new Set(['a']), [it1, dec], { askInView: true })).toBe(true);
    expect(popoverOpen(false, null, [it1], { askInView: true })).toBe(false);
  });
});

describe('결정 카드 — 단추·자리표시가 실제 동작과 같게(QA 12)', () => {
  const send = ev('send', 't1', '2026-09-27T00:00:00Z', { target: 'calc-page', title: '계산 페이지' });
  it('재현: 보내기 관문 카드(… 보내도 돼?)는 보낼까 단추가 있고 답은 물어본 참모에게 간다', () => {
    const [item] = buildInbox([], [send, ev('ask', 't1', '2026-09-27T00:00:01Z', { note: '결제 확인 — calc-page: 계산 페이지 — 보내도 돼?', to: 'sid-orch' })], new Set());
    expect(item?.gate).toBe(true);
    expect(item?.toOrch).toBe(true);
    expect(replyHint(item!)).toContain('물어본 참모');
    expect(gateReply(true)).toContain('보내도 돼');
    expect(gateReply(false)).toContain('보내지 마');
  });
  it('보통 결정은 단추 없이 답장만, 참모가 없으면 그 세션으로', () => {
    const [item] = buildInbox([], [send, ev('ask', 't1', '2026-09-27T00:00:01Z', { note: '어느 안으로 할까?' })], new Set());
    expect(item?.gate).toBeFalsy();
    expect(item?.toOrch).toBe(false);
    expect(replyHint(item!)).toContain('그 세션');
  });
  it('참모 물음(ask) 답장도 참모에게', () => {
    const [item] = buildInbox([act(s('o', 'hq'), 'asks', '머지할까?')], [], new Set(), [], () => true);
    expect(replyHint(item!)).toContain('물어본 참모');
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('대기함 문구·답장 막힘 이유를 영어로', () => {
    setLang('en');
    const x = s('b1', 'acme-shop');
    const items = buildInbox([act(x, 'blocked')], [], new Set(), [x], () => true);
    expect(items[0]?.text).toBe('Waiting on a prompt or choice — open it and pick one');
    expect(replyBlocked({ key: 'k', kind: 'ask', project: 'p', where: '', text: '', ts: '', target: 'nope' }, [x])).toBe('Session not found — if it stopped, resume it first');
  });
});

describe('findTarget — 기록의 대상으로 지금 세션 찾기', () => {
  const live = [{ ...s('aa11bb22', 'project-a'), name: 'crm', sessionId: 'aa11bb22-aaaa' }, { ...s('cc33dd44', 'pet-diary'), name: 'notes' }];
  it('id·이름·전체 sessionId', () => {
    expect(findTarget(live, 'aa11bb22')?.id).toBe('aa11bb22');
    expect(findTarget(live, 'crm')?.id).toBe('aa11bb22');
    expect(findTarget(live, 'aa11bb22-aaaa')?.id).toBe('aa11bb22');
  });
  it('"이름 [id 앞자리]" — id 가 살아 있으면 그 세션, 다시 켜져 id 가 바뀌었으면 이름으로(잡은 표시가 사라졌다, 2026-09-30)', () => {
    expect(findTarget(live, 'crm [aa11bb]')?.id).toBe('aa11bb22');
    expect(findTarget(live, 'crm [ee5566]')?.id).toBe('aa11bb22');
    expect(findTarget(live, 'gone [ee5566]')).toBeUndefined();
  });
});

describe('decideNote — 결정 알림은 물은 참모 별명과 그 카드로(2026-10-23 폰 알림)', () => {
  const orch = { ...s('5e55a0d1', 'honor-orchestrator'), sessionId: '5e55a0d1-7c2b-4f3e-9a10-2b8d4c6e0f13', name: '참모' };
  const sub = s('p1', 'acme-platform');
  const events = [ev('send', '1001-0900-ab12', '2026-10-23T10:00:00Z', { target: 'acme-platform' }), ev('ask', '1001-0900-ab12', '2026-10-23T11:07:43Z', { note: '운영에 올릴까?', to: orch.sessionId })];
  it('참모가 올린 결정 — 제목 앞에 그 참모 별명, 누르면 그 참모 채팅의 그 카드(w:<일 id>)', () => {
    const [item] = buildInbox([], events, new Set(), [orch, sub], () => false);
    const n = decideNote(item!, [orch, sub], () => '기획');
    expect(n.title).toBe('기획 결정 대기 — acme-platform');
    expect(n.go).toBe(`card:${orch.id}:w:1001-0900-ab12`);
    expect(n.kind).toBe('decide');
  });
  it('물은 참모를 못 찾으면(꺼짐·to 없음) 예전처럼 — 별명 없는 제목, 결정 대기함', () => {
    const [item] = buildInbox([], [events[0]!, { ...events[1]!, to: undefined }], new Set(), [sub], () => false);
    const n = decideNote(item!, [sub], () => '기획');
    expect(n.title).toBe('결정 대기 — acme-platform');
    expect(n.go).toBeUndefined();
  });
});
