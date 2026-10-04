import { describe, expect, it } from 'vitest';
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
