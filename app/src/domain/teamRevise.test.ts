// 팀 보관함 파일 수정본(10-28 사용자 1안) — 사람이 고친 팀 파일은 누를 때만 '<이름> (수정).<확장자>' 로 같은 폴더에.
// 같은 사람이 다시 올리면 자기 수정본을 새 판으로(옛 판은 휴지통), 다른 사람이면 '(수정 - <이름>)' 로 따로
import { describe, expect, it } from 'vitest';
import { revisePlan, reviseBase } from './teamRevise';
import type { LockerItem } from './teamLocker';

const item = (o: Partial<LockerItem>): LockerItem => ({
  id: 'x', name: 'a.ai', size: 1, cipher: 1, at: 1, state: 'live', kind: 'file', room: '', folder: '로고',
  by: '', byMember: 'm-me', mine: true, why: '', deletedAt: null, ...o,
});
const orig = item({ id: 'o1', name: '팀 로고.ai', byMember: 'm-boss', mine: false });

describe('수정본 이름', () => {
  it('처음 고친 사람 = \'<이름> (수정).<확장자>\', 같은 폴더, 바꿀 것 없음', () => {
    expect(revisePlan(orig, [orig], '사용자')).toEqual({ name: '팀 로고 (수정).ai', folder: '로고', replace: null });
  });
  it('같은 사람이 다시 올리면 자기 \'(수정)\' 을 새 판으로 — 옛 판 id 를 휴지통으로', () => {
    const mine = item({ id: 'r1', name: '팀 로고 (수정).ai', mine: true });
    expect(revisePlan(orig, [orig, mine], '사용자')).toEqual({ name: '팀 로고 (수정).ai', folder: '로고', replace: 'r1' });
  });
  it('남이 이미 \'(수정)\' 을 올렸으면 \'(수정 - <내 이름>)\' 으로 따로', () => {
    const theirs = item({ id: 'r1', name: '팀 로고 (수정).ai', byMember: 'm-j', mine: false });
    expect(revisePlan(orig, [orig, theirs], '사용자')).toEqual({ name: '팀 로고 (수정 - 사용자).ai', folder: '로고', replace: null });
  });
  it('내 \'(수정 - 이름)\' 이 있으면 그걸 새 판으로', () => {
    const theirs = item({ id: 'r1', name: '팀 로고 (수정).ai', byMember: 'm-j', mine: false });
    const mine = item({ id: 'r2', name: '팀 로고 (수정 - 사용자).ai', mine: true });
    expect(revisePlan(orig, [orig, theirs, mine], '사용자')).toEqual({ name: '팀 로고 (수정 - 사용자).ai', folder: '로고', replace: 'r2' });
  });
  it('(수정 2)·(수정 3) 으로 늘리지 않는다', () => {
    const mine = item({ id: 'r1', name: '팀 로고 (수정).ai', mine: true });
    expect(revisePlan(orig, [orig, mine], '사용자').name).not.toMatch(/수정 \d/);
  });
  it('수정본을 열어 또 고치면 원본 이름에서 — \'(수정) (수정)\' 이 안 된다', () => {
    const mine = item({ id: 'r1', name: '팀 로고 (수정).ai', mine: true });
    expect(revisePlan(mine, [orig, mine], '사용자')).toEqual({ name: '팀 로고 (수정).ai', folder: '로고', replace: 'r1' });
    const theirs = item({ id: 'r3', name: '팀 로고 (수정 - 지수).ai', byMember: 'm-j', mine: false });
    expect(reviseBase(theirs.name)).toBe('팀 로고.ai');
  });
  it('다른 폴더·휴지통·대화 파일의 같은 이름은 안 본다', () => {
    const other = item({ id: 'r1', name: '팀 로고 (수정).ai', folder: '옛것', mine: true });
    const trashed = item({ id: 'r2', name: '팀 로고 (수정).ai', state: 'trash', mine: true });
    const room = item({ id: 'r3', name: '팀 로고 (수정).ai', room: 'room1', mine: true });
    expect(revisePlan(orig, [orig, other, trashed, room], '사용자')).toEqual({ name: '팀 로고 (수정).ai', folder: '로고', replace: null });
  });
  it('확장자 없는 파일·점으로 시작하는 파일', () => {
    expect(revisePlan(item({ name: 'README', folder: '' }), [], '사용자').name).toBe('README (수정)');
    expect(revisePlan(item({ name: '.env.example', folder: '' }), [], '사용자').name).toBe('.env (수정).example');
  });
  it('대화 파일 원본은 팀 보관함 맨 위로(대화 방엔 안 올린다)', () => {
    expect(revisePlan(item({ name: 'a.pdf', folder: '', room: 'room1', mine: false }), [], '사용자')).toEqual({ name: 'a (수정).pdf', folder: '', replace: null });
  });
  it('내 이름이 비면 \'(수정 - 나)\' 대신 기기 몫으로 — 이름 칸이 빈 글로 끝나지 않게', () => {
    const theirs = item({ id: 'r1', name: '팀 로고 (수정).ai', byMember: 'm-j', mine: false });
    expect(revisePlan(orig, [orig, theirs], '  ').name).toBe('팀 로고 (수정 - 나).ai');
  });
});
