// '팀 보관함에 수정본 올리기'(10-28 사용자 1안) — 누를 때만: 원본 찾기 → 이름 정하기(domain/teamRevise) → 올리기(내 옛 판은 휴지통)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoked: { cmd: string; args: Record<string, unknown> }[] = [];
const answers: Record<string, unknown> = {};
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    const a = answers[cmd];
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  },
}));
const it0 = { size: 1, cipher: 1, at: 1, state: 'live', kind: 'file', room: '', by: '', why: '', deletedAt: null };

beforeEach(() => {
  invoked.length = 0;
  answers.team_peek_state = { edited: true, team: 't1', id: 'o1' };
  answers.team_locker_list = { items: [{ ...it0, id: 'o1', name: '로고.ai', folder: '로고', byMember: 'm-b', mine: false }, { ...it0, id: 'r1', name: '로고 (수정).ai', folder: '로고', byMember: 'm-me', mine: true }] };
  answers.team_peek_revise = null;
});

describe('수정본 올리기', () => {
  it('원본 폴더에 내 수정본 새 판으로 — 옛 판 id 를 같이', async () => {
    const { reviseUp } = await import('./teamRevise');
    expect(await reviseUp('/peek/t1/로고/로고.ai', 't1', '사용자')).toBe('로고 (수정).ai');
    expect(invoked.at(-1)).toEqual({ cmd: 'team_peek_revise', args: { team: 't1', path: '/peek/t1/로고/로고.ai', name: '로고 (수정).ai', folder: '로고', replace: 'r1' } });
  });
  it('원본을 못 찾으면(기억 없음·지워짐) 올리지 않고 까닭', async () => {
    answers.team_peek_state = { edited: true, team: 't1', id: null };
    const { reviseUp } = await import('./teamRevise');
    await expect(reviseUp('/peek/t1/a.ai', 't1', '사용자')).rejects.toThrow(/원본/);
    answers.team_peek_state = { edited: true, team: 't1', id: 'gone' };
    await expect(reviseUp('/peek/t1/a.ai', 't1', '사용자')).rejects.toThrow(/원본/);
    expect(invoked.some((c) => c.cmd === 'team_peek_revise')).toBe(false);
  });
  it('고친 게 없으면 올리지 않는다', async () => {
    answers.team_peek_state = { edited: false, team: 't1', id: 'o1' };
    const { reviseUp } = await import('./teamRevise');
    await expect(reviseUp('/peek/t1/로고/로고.ai', 't1', '사용자')).rejects.toThrow();
    expect(invoked.some((c) => c.cmd === 'team_peek_revise')).toBe(false);
  });
});
