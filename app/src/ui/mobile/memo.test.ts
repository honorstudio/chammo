import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobMemo, remembered, remember } from './memo';

describe('화면을 오가도 마지막 값(2026-10-03 사용자 "예약에서 대시보드로 넘어올 때 한 박자 뒤에 나와")', () => {
  it('받은 값을 열쇠로 기억 — 다시 그릴 때 바로 쓴다(뒤에서 새로 받는 동안)', () => {
    expect(remembered('shows')).toBeUndefined();
    remember('shows', 'a');
    expect(remembered('shows')).toBe('a');
  });
});

describe('BlobMemo — 한 번 받은 썸네일은 다시 안 받는다', () => {
  it('같은 열쇠는 그대로, 넘치면 가장 오래 안 쓴 것부터 놓는다', () => {
    const gone: string[] = [];
    const m = new BlobMemo(2, (u) => gone.push(u));
    m.put('a', 'blob:a');
    m.put('b', 'blob:b');
    expect(m.get('a')).toBe('blob:a'); // a 를 썼으니 b 가 가장 오래
    m.put('c', 'blob:c');
    expect(gone).toEqual(['blob:b']);
    expect(m.get('b')).toBeUndefined();
    expect(m.get('c')).toBe('blob:c');
  });
});

describe('다시 떠도 남는 기억(2026-11-16 사용자 "참모 목록 뜰 때 고정·프로필이 잠깐 초기화 상태")', () => {
  const fakeDisk = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { m.set(k, v); }), removeItem: (k: string) => m.delete(k), m };
  };
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('고정·순서는 페이지가 새로 떠도 지난 값으로 바로(홈 화면 앱이 다시 뜬 것)', async () => {
    const d = fakeDisk();
    vi.stubGlobal('localStorage', d);
    vi.resetModules();
    (await import('./memo')).remember('pins', '["s3"]');
    vi.resetModules();
    const again = await import('./memo');
    expect(again.remembered('pins')).toBe('["s3"]');
  });

  it('큰 것(대화·파일 목록)은 메모리에만 — 저장소에 안 쓴다', async () => {
    const d = fakeDisk();
    vi.stubGlobal('localStorage', d);
    vi.resetModules();
    const m = await import('./memo');
    m.remember('shows', 'big');
    expect(d.m.size).toBe(0);
    vi.resetModules();
    expect((await import('./memo')).remembered('shows')).toBeUndefined();
  });

  it('같은 값이 또 오면 저장소에 다시 안 쓴다 — 5초마다 받는다', async () => {
    const d = fakeDisk();
    vi.stubGlobal('localStorage', d);
    vi.resetModules();
    const m = await import('./memo');
    m.remember('order', '["a","b"]');
    m.remember('order', '["a","b"]');
    expect(d.setItem).toHaveBeenCalledTimes(1);
    m.remember('order', '["b","a"]');
    expect(d.setItem).toHaveBeenCalledTimes(2);
  });

  it('망가진 글·막힌 저장소면 기억 없음(던지지 않는다)', async () => {
    const d = fakeDisk();
    d.m.set('chammo.memo.pins', '{깨짐');
    vi.stubGlobal('localStorage', d);
    vi.resetModules();
    expect((await import('./memo')).remembered('pins')).toBeUndefined();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.resetModules();
    const m = await import('./memo');
    expect(m.remembered('pins')).toBeUndefined();
    expect(() => m.remember('pins', '[]')).not.toThrow();
    expect(m.remembered('pins')).toBe('[]');
  });
});
