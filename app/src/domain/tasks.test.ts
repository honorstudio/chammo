import { describe, expect, it } from 'vitest';
import { foldTasks, parseTaskLog, splitCards, taskTags, type TaskCard, type TaskEvent } from './tasks';
import type { Session } from './session';

const ev = (e: Partial<TaskEvent> & Pick<TaskEvent, 'type' | 'task'>): TaskEvent => ({ ts: '2026-09-26T12:00:00Z', ...e }) as TaskEvent;
const sess = (id: string, state: Session['state']): Session => ({
  id, name: id, cwd: '/d/' + id, kind: 'background', state, project: id, workspace: null, startedAt: 0,
});

describe('parseTaskLog — tasks.jsonl 한 줄에 한 이벤트', () => {
  it('깨진 줄은 건너뛴다 (쓰는 도중 읽힐 수 있다)', () => {
    const log = '{"ts":"t1","type":"send","task":"k1","target":"todo-api","title":"환불 버그"}\n{"ts":"t2","type":"do\n\n';
    expect(parseTaskLog(log)).toHaveLength(1);
  });
});

describe('foldTasks — 이벤트를 카드로', () => {
  it('보낸 일은 대상 세션이 일하는 중이면 "진행 중"', () => {
    const cards = foldTasks([ev({ type: 'send', task: 'k1', target: 'todo-api', title: '환불 버그' })], [sess('todo-api', 'working')]);
    expect(cards[0]).toMatchObject({ id: 'k1', target: 'todo-api', title: '환불 버그', status: 'working' });
  });

  it('대상이 쉬고 있고 답이 없으면 "보냄"', () => {
    const cards = foldTasks([ev({ type: 'send', task: 'k1', target: 'todo-api', title: 't' })], [sess('todo-api', 'idle')]);
    expect(cards[0]?.status).toBe('sent');
  });

  it('답이 오면 "답 옴" + 요약', () => {
    const cards = foldTasks(
      [ev({ type: 'send', task: 'k1', target: 'todo-api', title: 't' }), ev({ type: 'reply', task: 'k1', note: '테스트 4개 통과' })],
      [sess('todo-api', 'idle')],
    );
    expect(cards[0]).toMatchObject({ status: 'replied', note: '테스트 4개 통과' });
  });

  it('done 이면 대상 상태와 상관없이 "끝남"', () => {
    const cards = foldTasks(
      [ev({ type: 'send', task: 'k1', target: 'todo-api', title: 't' }), ev({ type: 'done', task: 'k1', note: 'PR #12 머지' })],
      [sess('todo-api', 'working')],
    );
    expect(cards[0]).toMatchObject({ status: 'done', note: 'PR #12 머지' });
  });

  it('대상이 입력을 기다리면(blocked) "입력 필요"', () => {
    const cards = foldTasks([ev({ type: 'send', task: 'k1', target: 'todo-api', title: 't' })], [sess('todo-api', 'blocked')]);
    expect(cards[0]?.status).toBe('needsInput');
  });

  it('대상 세션이 사라졌고 끝나지 않았으면 "세션 없음"', () => {
    const cards = foldTasks([ev({ type: 'send', task: 'k1', target: 'todo-api', title: 't' })], []);
    expect(cards[0]?.status).toBe('gone');
  });

  it('최신이 위로 (보낸 시각 기준)', () => {
    const cards = foldTasks(
      [
        ev({ ts: '2026-09-26T10:00:00Z', type: 'send', task: 'old', target: 'a', title: '옛' }),
        ev({ ts: '2026-09-26T11:00:00Z', type: 'send', task: 'new', target: 'b', title: '새' }),
      ],
      [sess('a', 'idle'), sess('b', 'idle')],
    );
    expect(cards.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('같은 task에 note 이벤트가 여러 개면 마지막 것이 요약, 갱신 시각도 따라간다', () => {
    const cards = foldTasks(
      [
        ev({ ts: 't1', type: 'send', task: 'k1', target: 'todo-api', title: 't' }),
        ev({ ts: 't2', type: 'reply', task: 'k1', note: '1차' }),
        ev({ ts: 't3', type: 'reply', task: 'k1', note: '2차' }),
      ],
      [sess('todo-api', 'idle')],
    );
    expect(cards[0]).toMatchObject({ note: '2차', updatedAt: 't3', sentAt: 't1' });
  });

  it('send 없이 온 이벤트는 버린다', () => {
    expect(foldTasks([ev({ type: 'reply', task: 'ghost', note: 'x' })], [])).toEqual([]);
  });

  it('대상은 세션 id나 이름 어느 쪽으로 적어도 찾는다', () => {
    const s = { ...sess('3ae12f81', 'working'), name: 'ops-hub' };
    const cards = foldTasks([ev({ type: 'send', task: 'k1', target: 'ops-hub', title: 't' })], [s]);
    expect(cards[0]?.status).toBe('working');
  });
});

describe('splitCards — 작업 패널: 진행 중 / 오늘 끝난 일 / 오래된 건 빼기', () => {
  const base = { target: 'todo-api', title: 't', sentAt: '2026-09-27T00:00:00Z' };
  const c = (id: string, status: TaskCard['status'], updatedAt: string): TaskCard => ({ ...base, id, status, updatedAt });
  // 2026-09-27 12:00 KST 기준 — 오늘은 새벽 5시(KST)부터
  const now = new Date(2026, 8, 27, 12).getTime();

  it('안 끝난 건 진행 중, 끝난 건 오늘 것만 끝난 일, 어제 이전은 뺀다', () => {
    const cards = [
      c('a', 'working', '2026-09-26T00:00:00Z'),
      c('b', 'done', new Date(2026, 8, 27, 6).toISOString()),
      c('d', 'done', new Date(2026, 8, 27, 4).toISOString()),
      c('e', 'replied', '2026-09-20T00:00:00Z'),
    ];
    const r = splitCards(cards, now);
    expect(r.active.map((x) => x.id)).toEqual(['a', 'e']);
    expect(r.doneToday.map((x) => x.id)).toEqual(['b']);
    expect(r.hidden).toBe(1);
  });

  // 2026-09-27: 관리 프로그램 재시작으로 세션이 죽자 안 끝난 일 3건이 '끝난 일'에 섞여 묻혔다
  it('세션 없이 안 끝난 일은 끝난 일이 아니라 주인 잃은 일로 따로 — 7일 넘은 건 숨김', () => {
    const cards = [
      { ...c('g1', 'gone', new Date(2026, 8, 27, 11).toISOString()), sentAt: new Date(2026, 8, 27, 9).toISOString() },
      { ...c('g2', 'gone', new Date(2026, 8, 25).toISOString()), sentAt: new Date(2026, 8, 24).toISOString() },
      { ...c('g3', 'gone', new Date(2026, 8, 10).toISOString()), sentAt: new Date(2026, 8, 10).toISOString() },
    ];
    const r = splitCards(cards, now);
    expect(r.orphaned.map((x) => x.id)).toEqual(['g1', 'g2']);
    expect(r.active).toEqual([]);
    expect(r.doneToday).toEqual([]);
    expect(r.hidden).toBe(1);
  });
});

describe('foldTasks — 대상 바꾸기', () => {
  it('send 뒤 이벤트에 target 이 있으면 그 세션으로 옮긴다(주인 잃은 일을 이어서 켠 새 id)', () => {
    const cards = foldTasks(
      [
        ev({ type: 'send', task: 'k1', target: 'dead1234', title: 't' }),
        ev({ type: 'note', task: 'k1', target: 'new56789', note: '이어서 켬' }),
      ],
      [sess('new56789', 'working')],
    );
    expect(cards[0]?.target).toBe('new56789');
    expect(cards[0]?.status).toBe('working');
  });
});

describe('검증 강도·되돌림 — 예외가 숨은 일은 꼼꼼히, 세 번 되돌리면 계획을 다시', () => {
  it('send 의 effort 와 retry 횟수가 카드로 온다', () => {
    const cards = foldTasks(
      [
        ev({ type: 'send', task: 'k1', target: 'a', title: '로그인 버그', effort: 'high' }),
        ev({ type: 'note', task: 'k1', note: '되돌림 1 — 타입', retry: 1 }),
        ev({ type: 'note', task: 'k1', note: '되돌림 2 — 테스트', retry: 2 }),
      ],
      [sess('a', 'working')],
    );
    expect(cards[0]).toMatchObject({ effort: 'high', retries: 2 });
  });

  it('옛 기록(effort·retry 없음)은 태그 없음', () => {
    const [c] = foldTasks([ev({ type: 'send', task: 'k1', target: 'a', title: 't' })], [sess('a', 'working')]);
    expect(c!.retries).toBe(0);
    expect(taskTags(c!)).toEqual([]);
  });

  it('보통(medium)은 태그를 안 단다 — 꼼꼼히·빠르게만, 되돌림은 두 번부터, 세 번이면 급함', () => {
    const base = { id: 'k', target: 'a', title: 't', status: 'working' as const, sentAt: '', updatedAt: '', retries: 0 };
    expect(taskTags({ ...base, effort: 'medium' })).toEqual([]);
    expect(taskTags({ ...base, effort: 'high' })).toEqual([{ text: '꼼꼼히', hot: false }]);
    expect(taskTags({ ...base, effort: 'low', retries: 1 })).toEqual([{ text: '빠르게', hot: false }]);
    expect(taskTags({ ...base, retries: 2 })).toEqual([{ text: '되돌림 2', hot: false }]);
    expect(taskTags({ ...base, retries: 3 })).toEqual([{ text: '되돌림 3 · 계획 다시', hot: true }]);
  });
});
