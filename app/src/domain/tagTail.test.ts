import { describe, expect, it } from 'vitest';
import { makeTagTail, parseTagChunk, type TagChunk } from './tagTail';

const ch = (text: string, tag: string, same = false): TagChunk => ({ text, tag, same });

describe('parseTagChunk — 서버 몸통(첫 줄 {tag,same} + 기록 원문)', () => {
  it('첫 줄은 꼬리표, 나머지는 원문 그대로', () => {
    expect(parseTagChunk('{"tag":"5-ab","same":false}\n{"path":"/a"}\n')).toEqual(ch('{"path":"/a"}\n', '5-ab'));
    expect(parseTagChunk('{"tag":"5-ab","same":true}\n')).toEqual(ch('', '5-ab', true));
  });
  it('모양이 틀리면 던진다(받기 고리가 다음에 다시)', () => {
    expect(() => parseTagChunk('{"tag":1,"same":true}\n')).toThrow();
    expect(() => parseTagChunk('')).toThrow();
  });
});

describe('makeTagTail — 지난번 꼬리표를 since 로(2026-10-09, show 기록 5초·세션 목록 3초마다 통째로 받던 것)', () => {
  it('처음엔 빈 since, 안 바뀌면 들고 있던 글, 바뀌면 받은 글로', async () => {
    const sinces: string[] = [];
    const replies = [ch('a\n', 't1'), ch('', 't1', true), ch('a\nb\n', 't2')];
    const read = makeTagTail(async (since) => { sinces.push(since); return replies.shift()!; });
    expect(await read()).toBe('a\n');
    expect(await read()).toBe('a\n');
    expect(await read()).toBe('a\nb\n');
    expect(sinces).toEqual(['', 't1', 't1']);
  });
  it('들고 있는 글이 없는데 same 이 오면(엉뚱한 since) 다음엔 빈 since 로 다시 받는다', async () => {
    const sinces: string[] = [];
    const replies = [ch('', 'x', true), ch('a\n', 't1')];
    const read = makeTagTail(async (since) => { sinces.push(since); return replies.shift()!; });
    expect(await read()).toBe('');
    expect(await read()).toBe('a\n');
    expect(sinces).toEqual(['', '']);
  });
  it('겹쳐 받은 늦은 답이 더 새 글을 덮지 않는다', async () => {
    const wake: (() => void)[] = [];
    let n = 0;
    const read = makeTagTail((since) => new Promise((ok) => { const i = n++; wake.push(() => ok(i === 0 ? ch('old\n', 't1') : ch('new\n', 't2'))); void since; }));
    const p1 = read();
    const p2 = read();
    wake[1]!();
    expect(await p2).toBe('new\n');
    wake[0]!();
    expect(await p1).toBe('new\n');
  });
});

describe('makeTagTail — 부른 쪽 signal 을 운반에 넘긴다', () => {
  it('signal 그대로', async () => {
    const c = new AbortController();
    let got: AbortSignal | undefined;
    const read = makeTagTail(async (_since, signal) => { got = signal; return { text: 'a', tag: 't', same: false }; });
    await read(c.signal);
    expect(got).toBe(c.signal);
  });
});

describe('makeTagTail — 늦게 보낸 요청의 same 이 다른 꼬리표 기준이면', () => {
  it('지금 글이 맞는지 모르니 다음엔 빈 since 로 통째로', async () => {
    const sinces: string[] = [];
    const wake: (() => void)[] = [];
    const replies: TagChunk[] = [ch('a\n', 't1'), ch('b\n', 't2'), ch('', 't1', true), ch('a\n', 't1')];
    const read = makeTagTail((since) => { sinces.push(since); const r = replies.shift()!; return new Promise((ok) => wake.push(() => ok(r))); });
    const p0 = read(); wake.shift()!(); expect(await p0).toBe('a\n');
    const p1 = read(); const p2 = read(); // 둘 다 since t1
    wake.shift()!(); expect(await p1).toBe('b\n'); // t2 로 바뀜
    wake.shift()!(); expect(await p2).toBe('b\n'); // t1 기준 same — 글은 그대로 두되
    const p3 = read(); wake.shift()!(); expect(await p3).toBe('a\n');
    expect(sinces).toEqual(['', 't1', 't1', '']); // 다음엔 통째로
  });
});
