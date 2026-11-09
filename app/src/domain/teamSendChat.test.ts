import { describe, expect, it } from 'vitest';
import { chatSendPlan, chatTargets, sendNote } from './teamSendChat';
import type { Convo } from './teamChat';

// 11-09 사용자 "팀 보관함에서 팀챗으로 파일이 안 옮겨져. 회의하는데 난감했어" — 끌기 대신 줄·카드 단추로 방·DM 을 골라 보낸다
const f = (id: string, x: { room?: string; why?: string; state?: string; deletedAt?: number | null } = {}) => ({ id, name: `${id}.pdf`, size: 10, room: x.room ?? '', why: x.why ?? '', state: x.state ?? 'live', deletedAt: x.deletedAt ?? null });
const c = (key: string, x: Partial<Convo> = {}): Convo => ({ key, room: '', peer: '', name: key, last: null, unread: 0, color: '', ...x });

describe('팀챗에 보내기 — 보낼 것과 못 보낼 것', () => {
  it('팀 전체 파일은 어느 방·DM 이든 그 파일을 가리키는 첨부로(다시 안 올림) — 팀 id 를 붙인다', () => {
    const p = chatSendPlan([f('a'), f('b')], 'r1', 'tA');
    expect(p.refs).toEqual([{ id: 'a', name: 'a.pdf', size: 10, team: 'tA', room: '' }, { id: 'b', name: 'b.pdf', size: 10, team: 'tA', room: '' }]);
    expect(p.skip).toEqual([]);
  });
  it('아직 안 연 DM(방 없음)에도 팀 전체 파일은 보낸다 — 처음 말에 Rust 가 방을 연다', () => {
    expect(chatSendPlan([f('a')], '', 'tA').refs.map((r) => r.id)).toEqual(['a']);
  });
  it('같은 방 대화 파일은 보내고, 다른 방 대화 파일은 그 방 사람만 열 수 있어 뺀다(이유: room)', () => {
    const p = chatSendPlan([f('a', { room: 'r1' }), f('b', { room: 'r2' })], 'r1', 'tA');
    expect(p.refs.map((r) => r.id)).toEqual(['a']);
    expect(p.skip).toEqual([{ id: 'b', why: 'room' }]);
    expect(chatSendPlan([f('b', { room: 'r2' })], '', 'tA').skip).toEqual([{ id: 'b', why: 'room' }]);
  });
  it('잠긴 파일(이 기기 열쇠 기다림)·휴지통 파일은 안 보낸다', () => {
    const p = chatSendPlan([f('a', { why: '열쇠 기다림' }), f('b', { state: 'trash' }), f('c', { deletedAt: 5 })], 'r1', 'tA');
    expect(p.refs).toEqual([]);
    expect(p.skip).toEqual([{ id: 'a', why: 'locked' }, { id: 'b', why: 'gone' }, { id: 'c', why: 'gone' }]);
  });
  it('폴더 줄(dir:…)은 보낼 수 없다', () => {
    expect(chatSendPlan([{ ...f('dir:견적') }], 'r1', 'tA')).toEqual({ refs: [], skip: [{ id: 'dir:견적', why: 'folder' }] });
  });
  it('같은 파일이 두 번 와도 한 번만', () => {
    expect(chatSendPlan([f('a'), f('a')], 'r1', 'tA').refs.length).toBe(1);
  });
  it('뺀 것 한 줄 — 없으면 빈 글', () => {
    expect(sendNote([])).toBe('');
    expect(sendNote([{ id: 'a', why: 'locked' }])).toMatch(/1개/);
    expect(sendNote([{ id: 'a', why: 'room' }, { id: 'b', why: 'room' }])).toMatch(/2개/);
  });
});

describe('보낼 곳 목록 — 이 팀 팀챗 먼저, 그다음 DM', () => {
  it('팀챗(단톡방) 먼저, DM 은 뒤 — 받은 순서는 그대로', () => {
    const l = chatTargets([c('dm:b', { peer: 'b', name: '비' }), c('room:r1', { room: 'r1', kind: 'group', name: '전체' }), c('dm:a', { peer: 'a', room: 'r9', name: '에이' })]);
    expect(l.map((x) => x.key)).toEqual(['room:r1', 'dm:b', 'dm:a']);
  });
  it('같은 대화가 두 번 와도 한 번, 받을 곳이 없는 줄(방도 상대도 없음)은 뺀다', () => {
    const l = chatTargets([c('room:r1', { room: 'r1', kind: 'group' }), c('room:r1', { room: 'r1', kind: 'group' }), c('x')]);
    expect(l.map((x) => x.key)).toEqual(['room:r1']);
  });
});
