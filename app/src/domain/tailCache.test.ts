import { describe, expect, it } from 'vitest';
import { makeTailReader, TAIL_KEEP, type TailRead } from './tailCache';

function fake(files: Record<string, { s: string; t: string }>) {
  const calls: { ids: string[]; tail?: number; known?: Record<string, string>; sent: string[] }[] = [];
  const read: TailRead = async (ids, tail, known) => {
    const out: Record<string, { s: string; t?: string }> = {};
    const sent: string[] = [];
    for (const id of ids) {
      const f = files[id];
      if (!f) continue;
      if (known?.[id] === f.s) out[id] = { s: f.s };
      else { out[id] = f; sent.push(id); }
    }
    calls.push({ ids, tail, known, sent });
    return out;
  };
  return { read, calls };
}

describe('대화 꼬리 — 안 바뀐 세션은 글을 다시 안 받는다(11-07 분당 23MB)', () => {
  it('두 번째부터는 바뀐 세션 글만 오고, 부르는 쪽은 늘 전체 지도를 받는다', async () => {
    const files = { a: { s: '1', t: '가' }, b: { s: '1', t: '나' } };
    const { read, calls } = fake(files);
    const r = makeTailReader(read);
    expect(await r(['a', 'b'])).toEqual({ a: '가', b: '나' });
    expect(calls[0]!.sent).toEqual(['a', 'b']);
    expect(await r(['a', 'b'])).toEqual({ a: '가', b: '나' });
    expect(calls[1]!.sent).toEqual([]);
    expect(calls[1]!.known).toEqual({ a: '1', b: '1' });
    files.b = { s: '2', t: '나다' };
    expect(await r(['a', 'b'])).toEqual({ a: '가', b: '나다' });
    expect(calls[2]!.sent).toEqual(['b']);
  });
  it('맥에 없는 세션(기록 파일 없음)은 지도에서 빠진다', async () => {
    const r = makeTailReader(fake({ a: { s: '1', t: '가' } }).read);
    expect(await r(['a', '없음'])).toEqual({ a: '가' });
  });
  it('깊게 읽기는 기억하지 않는다 — 8MB 를 쥐고 있지 않게, 다음 보통 읽기가 짧은 꼬리로', async () => {
    const files = { a: { s: '1', t: '짧은 꼬리' } };
    const { read, calls } = fake(files);
    const r = makeTailReader(read);
    expect(await r(['a'], 8_000_000)).toEqual({ a: '짧은 꼬리' });
    expect(calls[0]!.known).toBeUndefined();
    await r(['a']);
    expect(calls[1]!.known).toEqual({}); // 깊게 읽은 표를 안 넘겼다
  });
  it('기억은 상한까지 — 넘으면 오래된 것부터 빠져 다음에 다시 받는다', async () => {
    const files: Record<string, { s: string; t: string }> = {};
    const ids = Array.from({ length: TAIL_KEEP + 1 }, (_, i) => `s${i}`);
    for (const id of ids) files[id] = { s: '1', t: id };
    const { read, calls } = fake(files);
    const r = makeTailReader(read);
    await r(ids);
    await r(['s0']);
    expect(calls[1]!.sent).toEqual(['s0']);
  });
});
