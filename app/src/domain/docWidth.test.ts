import { describe, expect, it, vi } from 'vitest';
import { DOC_WIDE_KEY, docWideStore, parseDocWide } from './docWidth';

const fakeStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('parseDocWide — md 문서 폭(2026-10-24 사용자: 기본은 넓게)', () => {
  it('저장값이 없으면 넓게', () => {
    expect(parseDocWide(null)).toBe(true);
  });
  it('0 이면 좁게, 1 이면 넓게', () => {
    expect(parseDocWide('0')).toBe(false);
    expect(parseDocWide('1')).toBe(true);
  });
  it('알 수 없는 값은 기본(넓게)', () => {
    expect(parseDocWide('narrow?')).toBe(true);
  });
});

describe('docWideStore — 고른 폭을 기억하고 모든 문서 칸에 알린다', () => {
  it('처음엔 넓게', () => {
    expect(docWideStore(fakeStorage()).get()).toBe(true);
  });
  it('좁게로 바꾸면 저장되고, 새 저장소(앱 다시 켬)도 좁게로 읽는다', () => {
    const st = fakeStorage();
    docWideStore(st).set(false);
    expect(st.m.get(DOC_WIDE_KEY)).toBe('0');
    expect(docWideStore(st).get()).toBe(false);
  });
  it('toggle 은 지금 값을 뒤집는다', () => {
    const s = docWideStore(fakeStorage());
    s.toggle();
    expect(s.get()).toBe(false);
    s.toggle();
    expect(s.get()).toBe(true);
  });
  it('바꾸면 구독자(스페이스·리더)에게 알린다, 끊으면 안 알린다', () => {
    const s = docWideStore(fakeStorage());
    const f = vi.fn();
    const off = s.subscribe(f);
    s.set(false);
    expect(f).toHaveBeenCalledTimes(1);
    s.set(false); // 같은 값은 조용히
    expect(f).toHaveBeenCalledTimes(1);
    off();
    s.set(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('저장소가 막혀 있어도(던짐) 이번 실행은 메모리로 돈다', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const s = docWideStore(broken);
    expect(s.get()).toBe(true);
    s.set(false);
    expect(s.get()).toBe(false);
  });
});
