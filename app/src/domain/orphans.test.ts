import { describe, expect, it } from 'vitest';
import { isRemoteTarget, targetLabel, unclosedOf } from './orphans';
import type { TaskCard, TaskEvent } from './tasks';

// 이 맥 세션 기록(떠 있는 것 + 꺼진 것)
const known = [
  { id: 'f00d0004', name: 'hello-notes', sessionId: 'f00d0004-0000-4000-8000-004027383812' },
  { id: 'aaaa1111', name: 'project-b-1' },
];

describe('isRemoteTarget — 이 맥에 없는 세션(다른 기계·파트너 참모)은 주인 잃은 일로 안 친다', () => {
  it('세션 사이 주소([ref])가 붙은 대상은 원격 — 다른 기계의 파트너 참모', () => {
    expect(isRemoteTarget('원격 [abc123]', known)).toBe(true);
    expect(isRemoteTarget('hello-notes [def456]', known)).toBe(true);
  });
  it('이 맥 기록에 없는 이름도 원격', () => expect(isRemoteTarget('원격', known)).toBe(true));
  it('이 맥 세션 이름·id·세션 번호면 이 맥', () => {
    expect(isRemoteTarget('hello-notes', known)).toBe(false);
    expect(isRemoteTarget('aaaa1111', known)).toBe(false);
    expect(isRemoteTarget('f00d0004-0000-4000-8000-004027383812', known)).toBe(false);
  });
  it('빈 대상은 원격으로 안 친다', () => expect(isRemoteTarget('', known)).toBe(false));
});

const card = (id: string, target: string): TaskCard => ({ id, target, title: id, status: 'gone', sentAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z' });
const send = (task: string, target: string, from?: string): TaskEvent => ({ ts: '2026-10-02T10:00:00Z', type: 'send', task, target, ...(from ? { from } : {}) });

describe('unclosedOf — 그 참모 대시보드의 "닫히지 않은 일"(맡긴 세션이 꺼졌는데 끝 표시가 없는 일)', () => {
  const events: TaskEvent[] = [
    send('t1', 'hello-notes', 'o1'),
    send('t2', '원격 [abc123]', 'o1'),
    send('t3', 'project-b-1', 'o2'),
    send('t4', 'project-b-1'),
    { ts: '2026-10-02T11:00:00Z', type: 'own', task: 't4', from: 'o1' },
  ];
  const orphaned = [card('t1', 'hello-notes'), card('t2', '원격 [abc123]'), card('t3', 'project-b-1'), card('t4', 'project-b-1')];
  it('그 참모가 맡긴 일(send 의 from, 나중에 붙인 own)만, 원격 대상은 빼고', () => {
    expect(unclosedOf(orphaned, events, 'o1', known).map((c) => c.id)).toEqual(['t1', 't4']);
    expect(unclosedOf(orphaned, events, 'o2', known).map((c) => c.id)).toEqual(['t3']);
  });
  it('주인이 없는 일은 어느 참모에도 안 뜬다(그건 "누가 시켰는지 모르는 일" 묶음 몫)', () => {
    expect(unclosedOf([card('t9', 'hello-notes')], [send('t9', 'hello-notes')], 'o1', known)).toEqual([]);
  });
});

describe('targetLabel — 닫히지 않은 일 줄에 보일 대상 이름(세션 번호·참모 번호 대신)', () => {
  const known2 = [...known, { id: 'f00d0005', name: '참모-4 · 넷째', sessionId: 'f00d0005-0000-4000-8000-004027383813' }];
  it('세션 id 로 맡긴 일은 그 세션 이름 — 참모면 별명만', () => expect(targetLabel('f00d0005', known2)).toBe('넷째'));
  it('긴 세션 번호로 맡겨도 같다', () => expect(targetLabel('f00d0005-0000-4000-8000-004027383813', known2)).toBe('넷째'));
  it('이름으로 맡긴 참모도 별명만', () => expect(targetLabel('참모-4 · 넷째', known2)).toBe('넷째'));
  it('프로젝트 세션 이름은 그대로(끝 번호도 이름의 일부)', () => expect(targetLabel('aaaa1111', known2)).toBe('project-b-1'));
  it('기록에 없으면 받은 그대로', () => expect(targetLabel('deadbeef', known2)).toBe('deadbeef'));
});
