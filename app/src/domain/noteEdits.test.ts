import { describe, expect, it } from 'vitest';
import { applyNotes, composeNoteSend, emptyEdits, type NoteBase, moveId } from './noteEdits';

const base: NoteBase = {
  tasks: [{ id: '1', text: '디스크 정리', done: true }, { id: '2', text: '죽은 세션 점검', done: false }, { id: '3', text: 'project-k 결제 로그 정리', done: false }],
  decisions: ['채팅 뷰 = 두 공간', '사람이 서는 자리 = 되돌리기 어려운 순간'],
};

describe('노트 고치기 — 참모 대시보드 할 일·결정(v11 X·M, 2026-09-30 사용자)', () => {
  it('고친 게 없으면 보낼 말도 없다', () => {
    expect(composeNoteSend(base, emptyEdits(), '')).toBe('');
  });
  it('더함·뺌·고침·끝남 표시·결정 고침을 M 모양으로', () => {
    const e = emptyEdits();
    e.tasks['3'] = { removed: true };
    e.tasks['2'] = { done: true };
    e.addedTasks.push({ id: 'n1', text: 'project-b OTA 15분 뒤 Sentry 확인' });
    e.decisions['1'] = { text: '사람이 서는 자리 = 되돌리기 어려운 순간 + OTA 는 preview 까지' };
    e.addedDecisions.push('작업 패널은 세션당 한 가지');
    expect(composeNoteSend(base, e, '이대로 반영하고 starter 도 고쳐')).toBe([
      '[할 일·결정] 사용자가 고친 것',
      '■ 할 일',
      '+ project-b OTA 15분 뒤 Sentry 확인',
      '- project-k 결제 로그 정리 (빼)',
      '✓ 죽은 세션 점검 (끝난 걸로)',
      '■ 최근 결정',
      '+ 작업 패널은 세션당 한 가지',
      '~ 사람이 서는 자리 = 되돌리기 어려운 순간',
      '  → 사람이 서는 자리 = 되돌리기 어려운 순간 + OTA 는 preview 까지',
      '메모: 이대로 반영하고 starter 도 고쳐',
    ].join('\n'));
  });
  it('순서를 바꾸면 새 순서 한 줄', () => {
    const e = emptyEdits();
    e.order = ['3', '1', '2'];
    expect(composeNoteSend(base, e, '')).toContain('순서: project-k 결제 로그 정리 → 디스크 정리 → 죽은 세션 점검');
  });
  it('화면에 그릴 줄 — 고친 글·새 줄·뺀 줄 표시, 순서 반영', () => {
    const e = emptyEdits();
    e.tasks['1'] = { text: '디스크 정리(끝)' };
    e.tasks['3'] = { removed: true };
    e.addedTasks.push({ id: 'n1', text: '새 일' });
    e.order = ['2', '1', '3', 'n1'];
    const v = applyNotes(base, e);
    expect(v.tasks.map((t) => [t.id, t.text, t.state])).toEqual([
      ['2', '죽은 세션 점검', 'same'], ['1', '디스크 정리(끝)', 'changed'], ['3', 'project-k 결제 로그 정리', 'removed'], ['n1', '새 일', 'added'],
    ]);
  });
});

describe('moveId — 할 일 순서 바꾸기(끌어서 다른 줄 위·아래에 놓기)', () => {
  it('아래로 끌어 마지막 줄 아래에 놓으면 맨 끝으로', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
  });
  it('위로 끌어 첫 줄 위에 놓으면 맨 앞으로', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
  });
  it('가운데 줄 위에 놓기', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('자기 자리에 놓거나 없는 줄이면 그대로', () => {
    expect(moveId(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'x', 'a', true)).toEqual(['a', 'b']);
  });
});
