import { describe, expect, it } from 'vitest';
import { foldTails } from './tailFold';

// 2026-11-01 ux-daily M9 — 10초마다 세션마다 256KB 꼬리를 전부 다시 풀고(JSON.parse) 매번 새 객체로 넣어 App 전체가 다시 그려졌다
describe('foldTails — 바뀐 꼬리만 다시 풀고, 하나도 안 바뀌면 같은 객체', () => {
  const sum = (raw: string) => ({ n: raw.length });
  it('처음엔 다 푼다', () => {
    const calls: string[] = [];
    const r = foldTails({}, {}, { a: 'xx', b: 'yyy' }, (v) => { calls.push(v); return sum(v); });
    expect(r.sums).toEqual({ a: { n: 2 }, b: { n: 3 } });
    expect(calls).toEqual(['xx', 'yyy']);
    expect(r.changed).toBe(true);
  });
  it('안 바뀐 꼬리는 안 풀고 앞 요약을 그대로(같은 참조)', () => {
    const first = foldTails({}, {}, { a: 'xx', b: 'yyy' }, sum);
    const calls: string[] = [];
    const r = foldTails(first.raws, first.sums, { a: 'xx', b: 'yyyz' }, (v) => { calls.push(v); return sum(v); });
    expect(calls).toEqual(['yyyz']);
    expect(r.sums.a).toBe(first.sums.a);
    expect(r.changed).toBe(true);
  });
  it('하나도 안 바뀌면 changed=false·같은 요약 객체 — 상태를 안 넣어 다시 안 그린다', () => {
    const first = foldTails({}, {}, { a: 'xx' }, sum);
    const r = foldTails(first.raws, first.sums, { a: 'xx' }, sum);
    expect(r.changed).toBe(false);
    expect(r.sums).toBe(first.sums);
  });
  it('세션이 빠지면 바뀐 것', () => {
    const first = foldTails({}, {}, { a: 'xx', b: 'y' }, sum);
    const r = foldTails(first.raws, first.sums, { a: 'xx' }, sum);
    expect(r.changed).toBe(true);
    expect(Object.keys(r.sums)).toEqual(['a']);
  });
});
