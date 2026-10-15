import { describe, expect, it } from 'vitest';
import { makeTaskLog, makeTaskTail, mergeTaskTail, parseTaskChunk, type TaskChunk } from './taskTail';

const ch = (text: string, next: number, reset = false): TaskChunk => ({ text, next, reset });

describe('mergeTaskTail — 작업 기록 이어 받기(2026-10-08, 5초마다 518KB 통째로 받던 것)', () => {
  it('새 줄만 뒤에 붙이고, 안 바뀌었으면 같은 글', () => {
    expect(mergeTaskTail('a\n', ch('b\n', 4))).toBe('a\nb\n');
    expect(mergeTaskTail('a\n', ch('', 2))).toBe('a\n');
  });
  it('reset 이면 받은 글로 갈아 끼운다', () => {
    expect(mergeTaskTail('a\nb\n', ch('x\n', 2, true))).toBe('x\n');
  });
  it('꼬리 상한을 넘으면 앞을 줄 단위로 버린다', () => {
    expect(mergeTaskTail('aaaa\nbbbb\n', ch('cccc\n', 15), 10)).toBe('bbbb\ncccc\n');
    expect(mergeTaskTail('aaaa\nbbbb\n', ch('cccc\n', 15), 9)).toBe('cccc\n');
    expect(mergeTaskTail('aa\nbb\n', ch('cc\n', 9), 7)).toBe('bb\ncc\n');
  });
});

describe('makeTaskTail — 지난번 next 를 from 으로', () => {
  it('처음엔 0, 다음엔 받은 next', async () => {
    const froms: number[] = [];
    const replies = [ch('a\nb\n', 4), ch('', 4), ch('c\n', 6)];
    const read = makeTaskTail(async (from) => { froms.push(from); return replies.shift()!; });
    expect(await read()).toBe('a\nb\n');
    expect(await read()).toBe('a\nb\n');
    expect(await read()).toBe('a\nb\nc\n');
    expect(froms).toEqual([0, 4, 4]);
  });
  it('같은 자리에서 두 번 겹쳐 받으면 늦은 답은 안 붙인다(줄이 두 번 들어가지 않게)', async () => {
    let wake: (() => void)[] = [];
    const read = makeTaskTail((from) => new Promise((ok) => wake.push(() => ok(from === 0 ? ch('a\n', 2) : ch('', 2)))));
    const p1 = read();
    const p2 = read();
    wake.forEach((w) => w());
    wake = [];
    expect([await p1, await p2]).toEqual(['a\n', 'a\n']);
  });
});

describe('parseTaskChunk — 서버 몸통(첫 줄 {next,reset} + 줄 원문)', () => {
  it('첫 줄은 자리, 나머지는 원문 그대로', () => {
    expect(parseTaskChunk('{"next":24,"reset":false}\n{"c":3}\n')).toEqual(ch('{"c":3}\n', 24));
    expect(parseTaskChunk('{"next":0,"reset":true}\n')).toEqual(ch('', 0, true));
  });
  it('모양이 틀리면 던진다(받기 고리가 다음에 다시)', () => {
    expect(() => parseTaskChunk('{"a":1}\n')).toThrow();
    expect(() => parseTaskChunk('')).toThrow();
  });
});

describe('makeTaskLog — 데스크톱 작업 기록 이어 받기(2026-10-11, 3초마다 686KB 통째로 읽던 것)', () => {
  type C = { text: string; next: number; reset: boolean; id: string };
  const line = (task: string, type = 'send') => `{"ts":"t","type":"${type}","task":"${task}"}\n`;
  const c = (text: string, next: number, reset = false, id = 'f1'): C => ({ text, next, reset, id });
  it('처음은 통째, 다음엔 지난 next·id 로 늘어난 줄만 붙인다', async () => {
    const asks: [number | undefined, string | undefined][] = [];
    const replies = [c(line('a1') + line('b2'), 80, true), c(line('c3'), 120)];
    const read = makeTaskLog(async (from, id) => { asks.push([from, id]); return replies.shift()!; });
    expect((await read()).map((e) => e.task)).toEqual(['a1', 'b2']);
    expect((await read()).map((e) => e.task)).toEqual(['a1', 'b2', 'c3']);
    expect(asks).toEqual([[undefined, undefined], [80, 'f1']]);
  });
  it('안 바뀌었으면 같은 배열(App 이 다시 안 그린다)', async () => {
    const replies = [c(line('a1'), 40, true), c('', 40)];
    const read = makeTaskLog(async () => replies.shift()!);
    const first = await read();
    expect(await read()).toBe(first);
  });
  it('reset 이면 갈아 끼운다(파일이 줄었거나 바뀜)', async () => {
    const replies = [c(line('a1') + line('b2'), 80, true), c(line('x9'), 40, true, 'f2')];
    const read = makeTaskLog(async () => replies.shift()!);
    await read();
    expect((await read()).map((e) => e.task)).toEqual(['x9']);
  });
  it('겹쳐 받은 늦은 답은 안 붙인다(줄이 두 번 들어가지 않게)', async () => {
    let wake: (() => void)[] = [];
    const read = makeTaskLog((from) => new Promise((ok) => wake.push(() => ok(from === undefined ? c(line('a1'), 40, true) : c('', 40)))));
    const p1 = read();
    const p2 = read();
    wake.forEach((w) => w());
    wake = [];
    expect((await p1).map((e) => e.task)).toEqual(['a1']);
    expect((await p2).map((e) => e.task)).toEqual(['a1']);
  });
});
