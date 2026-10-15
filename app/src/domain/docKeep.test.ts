import { describe, expect, it } from 'vitest';
import { docKeepLimit, keepTouch } from './docKeep';

// 2026-10-12 사용자 결정 — 최근 참모 3명까지 문서 편집기를 살려 둔다(바꿀 때마다 BlockNote 를 다시 만들면 120~250ms 굳었다)
describe('문서 살려 두기 — 최근 참모 순서', () => {
  it('쓴 참모를 맨 뒤(최근)로, 넘치면 오래된 것부터 내린다', () => {
    expect(keepTouch(['a', 'b', 'c'], 'a', 3)).toEqual({ order: ['b', 'c', 'a'], drop: [] });
    expect(keepTouch(['a', 'b', 'c'], 'd', 3)).toEqual({ order: ['b', 'c', 'd'], drop: ['a'] });
  });
  it('한도가 줄면 한 번에 여럿 내린다 — 지금 참모는 안 내린다', () => {
    expect(keepTouch(['a', 'b', 'c'], 'c', 1)).toEqual({ order: ['c'], drop: ['a', 'b'] });
  });
  it('한도는 3, 메모리가 모자라면(스왑 4GB 넘음) 1', () => {
    expect(docKeepLimit(null)).toBe(3);
    expect(docKeepLimit(1.2)).toBe(3);
    expect(docKeepLimit(4)).toBe(1);
  });
});
