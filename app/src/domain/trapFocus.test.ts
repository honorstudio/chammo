import { describe, expect, it } from 'vitest';
import { trapNext } from './trapFocus';

// 겹창 포커스 가두기 — Tab 이 겹창 밖(뒤 화면)으로 새지 않게 끝에서 처음으로, 처음에서 끝으로 돈다
describe('겹창 Tab 가두기', () => {
  it('마지막에서 Tab 이면 처음으로, 처음에서 ⇧Tab 이면 마지막으로', () => {
    expect(trapNext(3, 2, false)).toBe(0);
    expect(trapNext(3, 0, true)).toBe(2);
  });
  it('가운데는 브라우저 차례 그대로(-1 = 손대지 않음)', () => {
    expect(trapNext(3, 1, false)).toBe(-1);
    expect(trapNext(3, 1, true)).toBe(-1);
  });
  it('포커스가 겹창 밖이면 안으로 — Tab 은 처음, ⇧Tab 은 마지막', () => {
    expect(trapNext(3, -1, false)).toBe(0);
    expect(trapNext(3, -1, true)).toBe(2);
  });
  it('누를 게 없으면 아무 데도 안 간다(-2 = 막기만)', () => {
    expect(trapNext(0, -1, false)).toBe(-2);
  });
});
