import { describe, expect, it } from 'vitest';
import { askRef, takeRefs, type RefAsk } from './refBus';

const r = (text: string): RefAsk => ({ kind: 'task', who: '일', text });

describe('참조 나르기 — 그 참모 입력칸으로만', () => {
  it('받는 입력칸이 있으면 그 참모 것만 받는다', () => {
    const a: RefAsk[] = [], b: RefAsk[] = [];
    const offA = takeRefs('orch-a', (x) => a.push(x));
    const offB = takeRefs('orch-b', (x) => b.push(x));
    expect(askRef('orch-a', r('1'))).toBe(true);
    expect(a.map((x) => x.text)).toEqual(['1']);
    expect(b).toEqual([]);
    offA(); offB();
  });
  it('입력칸이 아직 없으면 모아 뒀다가 붙을 때 차례대로 넣는다(한 번만)', () => {
    expect(askRef('orch-c', r('1'))).toBe(false);
    askRef('orch-c', r('2'));
    const got: string[] = [];
    const off = takeRefs('orch-c', (x) => got.push(x.text));
    expect(got).toEqual(['1', '2']);
    off();
    const again: string[] = [];
    takeRefs('orch-c', (x) => again.push(x.text))();
    expect(again).toEqual([]);
  });
});
