// 권한 칩 낙관적 반영(10-31, 사용자 승인) — 누르는 즉시 칩이 바뀌고 서버는 뒤에서
import { describe, expect, it } from 'vitest';
import { inOrder, nextPerms, shownPerms } from './permChips';
import settings from '../ui/team/TeamSettings.tsx?raw';

describe('권한 칩', () => {
  it('전체는 혼자, 나머지는 켜고 끄기(전체를 끄고)', () => {
    expect(nextPerms([], 'all')).toEqual(['all']);
    expect(nextPerms(['all'], 'all')).toEqual([]);
    expect(nextPerms(['all'], 'invite')).toEqual(['invite']);
    expect(nextPerms(['invite'], 'invite')).toEqual([]);
    expect(nextPerms(['invite'], 'kick')).toEqual(['invite', 'kick']);
  });
  it('저장 중이면 누른 값을 보여 준다', () => {
    expect(shownPerms(['invite'], undefined)).toEqual(['invite']);
    expect(shownPerms(['invite'], ['kick'])).toEqual(['kick']);
  });
  it('칩은 서버를 안 기다리고, 잠그는 건 그 줄만 — 실패면 되돌린다', () => {
    const chip = settings.slice(settings.indexOf('const toggle'), settings.indexOf('return (<Fragment'));
    expect(chip).not.toMatch(/run\(teamSetPerms/);
    expect(chip).toMatch(/setPend\(/);
    expect(chip).toMatch(/disabled=\{pend\[r\.id\] !== undefined/);
    expect(chip).toMatch(/delete n\[r\.id\]/);
    expect(chip).toMatch(/saveInOrder\(\(\) => teamSetPerms/);
  });
  // 10-31 리뷰: 두 사람 줄을 연달아 누르면 저장이 같이 돌아, 늦게 온 앞 답(뒤 저장 전 서버 상태)이 뒤 줄 칩을 옛 값으로 덮었다
  it('저장은 누른 차례대로 하나씩 — 앞 저장이 끝난 뒤 다음을 보내 답도 차례로 온다', async () => {
    const run = inOrder();
    const log: string[] = [];
    let openA: () => void = () => {};
    const a = run(() => new Promise<string>((ok) => { log.push('A 보냄'); openA = () => { log.push('A 답'); ok('A'); }; }));
    const b = run(async () => { log.push('B 보냄'); return 'B'; });
    await Promise.resolve();
    expect(log).toEqual(['A 보냄']);
    openA();
    expect(await a).toBe('A');
    expect(await b).toBe('B');
    expect(log).toEqual(['A 보냄', 'A 답', 'B 보냄']);
    const c = run(async () => { throw new Error('실패'); });
    await expect(c).rejects.toThrow('실패');
    expect(await run(async () => 'D')).toBe('D');
  });
});
