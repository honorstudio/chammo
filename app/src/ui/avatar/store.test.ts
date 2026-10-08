import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/tauri', () => ({ readAvatars: vi.fn(), getAppEnv: vi.fn(), saveAvatarFile: vi.fn(), deleteAvatarFile: vi.fn() }));

const BLUE = [{ key: '참모-2', avatar: { kind: 'preset', shape: 'mochi', eyes: 'pill', color: '#2f74e0' }, v: 1 }];
const colorOf = (s: { saved: Map<string, { avatar: { kind: string; color?: string | null } }> }) => {
  const a = s.saved.get('참모-2')?.avatar;
  return a?.kind === 'preset' ? a.color : undefined;
};

/** 저장소는 모듈 하나에 상태를 든다 — 시험마다 새로 불러온다 */
async function fresh(read: () => Promise<unknown>) {
  vi.resetModules();
  const m = await import('./store');
  m.setAvatarSource({ read, dataDir: () => Promise.resolve('phone') });
  return m;
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('프로필 저장소 — 한 번 읽다 실패해도 굳지 않는다(폰 참모-2 가 주황으로 굳은 것, 2026-10-05)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('첫 읽기가 실패하면 잠시 뒤 다시 읽어 저장한 색을 찾는다', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('HTTP 502')).mockResolvedValue(BLUE);
    const m = await fresh(read);
    m.loadAvatars();
    await settle();
    expect(colorOf(m.avatarSnapshot())).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(colorOf(m.avatarSnapshot())).toBe('#2f74e0');
  });

  it('refreshAvatars 는 다시 읽는다(폰이 돌아오거나 다시 붙을 때) — 데스크톱에서 바꾼 색도 따라온다', async () => {
    const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValue(BLUE);
    const m = await fresh(read);
    m.loadAvatars();
    await settle();
    expect(colorOf(m.avatarSnapshot())).toBeUndefined();
    await m.refreshAvatars();
    expect(colorOf(m.avatarSnapshot())).toBe('#2f74e0');
  });

  it('다시 읽기가 실패해도 이미 아는 값은 지우지 않는다(빈 값으로 덮으면 순서 색으로 떨어진다)', async () => {
    const read = vi.fn().mockResolvedValueOnce(BLUE).mockRejectedValue(new Error('offline'));
    const m = await fresh(read);
    m.loadAvatars();
    await settle();
    expect(colorOf(m.avatarSnapshot())).toBe('#2f74e0');
    await m.refreshAvatars();
    expect(colorOf(m.avatarSnapshot())).toBe('#2f74e0');
  });
});
