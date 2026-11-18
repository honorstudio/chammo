import { describe, expect, it } from 'vitest';
import { de2000, GREEN_MAT, kidLook, matFor, NAVY_MAT, pickReply } from './kidsLook';

describe('키즈 화면 생김새 — 시안 v3 매트 색 규칙·프사', () => {
  it('ΔE00 — 같은 색 0, 초록 참모만 초록 매트와 20 밑(시안 kids3_kid 와 같은 값)', () => {
    expect(de2000('#2f74e0', '#2f74e0')).toBe(0);
    expect(de2000('#1f9a62', GREEN_MAT)).toBeCloseTo(6.2, 0);
    expect(matFor('#1f9a62')).toBe(NAVY_MAT);
    for (const c of ['#2f74e0', '#d9622b', '#9b51e0', '#c98a00', '#d23f6b']) expect(matFor(c)).toBe(GREEN_MAT);
  });
  it('프사 기본형이면 그 도형·눈·색, 그림 프사·없음이면 그 참모 기본형', () => {
    expect(kidLook('참모-2', { kind: 'preset', shape: 'cloud', eyes: 'pupil', color: '#1f9a62' })).toEqual({ shape: 'cloud', eyes: 'pupil', color: '#1f9a62', mat: NAVY_MAT });
    const d = kidLook('참모-2', null);
    expect(d.shape).toBeTruthy();
    expect(d.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(kidLook('참모-2', { kind: 'image', file: 'x.png' })).toEqual(d);
  });
  it('새 답 고르기 — 보낸 뒤에 온 마지막 답만', () => {
    const rows = [{ ts: 1, who: 'assistant', text: '옛 답' }, { ts: 5, who: 'kid', text: '공룡' }, { ts: 7, who: 'assistant', text: '좋아!' }];
    expect(pickReply(rows, 0)?.text).toBe('좋아!');
    expect(pickReply(rows, 7)).toBeNull();
    expect(pickReply([{ ts: 3, who: 'kid', text: 'x' }], 0)).toBeNull();
  });
});
