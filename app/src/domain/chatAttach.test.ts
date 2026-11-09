import { describe, expect, it } from 'vitest';
import { attachStep, NO_ATT, type AttEvent, type AttState } from './chatAttach';

const img = (k: string) => ({ key: k, name: k, url: `u:${k}` });
const run = (evs: AttEvent[], s: AttState = NO_ATT) => {
  const out: ReturnType<typeof attachStep>[] = [];
  for (const e of evs) { const r = attachStep(s, e); out.push(r); s = r.s; }
  return { s, out };
};
/** 0.4초마다 읽기 n 번 */
const reads = (raw: string | null | undefined, draft: string, from: number, n: number): AttEvent[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'read', raw, draft, now: from + i * 400 }));

// 2026-11-05 사용자 캡처(참모-2 기록 03:33:52 → 03:36:19): #img1·#img2 를 보내자마자 다음 말에 쓸 그림을 붙여 넣으니,
// 앞 그림이 줄에 그대로 남고 번호가 #img3·#img4 로 이어졌다. 줄은 '터미널 입력칸이 4번 연달아 비고 + 입력칸에 이름표가 없고 + 붙인 지 5초'일 때만
// 비워서, 그 전에 새 그림을 붙이면(입력칸에 #img 이름표, 터미널 입력칸엔 [Image #n]) 영영 안 비었다
describe('attachStep — 보낸 뒤 첨부 줄', () => {
  it('보내면 줄이 바로 비고, 그 그림은 보낸 말과 같이 간 것으로 돌려준다', () => {
    const { s, out } = run([
      { kind: 'add', item: img('a'), as: 'img', now: 0 },
      { kind: 'add', item: img('b'), as: 'img', now: 1000 },
      { kind: 'sent' },
    ]);
    expect(s.list).toEqual([]);
    expect(out[2]!.went?.map((a) => a.label)).toEqual(['#img1', '#img2']);
  });
  it('보내자마자(입력칸 읽기가 비기 전에) 다음 그림을 붙여도 앞 그림은 안 남고 새 번호는 #img1', () => {
    const { s, out } = run([
      { kind: 'add', item: img('a'), as: 'img', now: 0 },
      { kind: 'add', item: img('b'), as: 'img', now: 1000 },
      { kind: 'sent' },
      ...reads(undefined, '', 1500, 2),
      { kind: 'add', item: img('c'), as: 'img', now: 2400 },
      ...reads('[Image #3]', '#img1 ', 2800, 300), // 다음 말을 2분 동안 쓴다
    ]);
    expect(out[5]!.label).toBe('#img1');
    expect(s.list.map((a) => a.key)).toEqual(['c']);
  });
  it('일하는 중 보낸 말(대기열)도 같다 — 줄 선 말과 같이 간 그림은 줄에서 빠진다', () => {
    const { s, out } = run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, { kind: 'sent' }, ...reads('', '', 2000, 2)]);
    expect(s.list).toEqual([]);
    expect(out[1]!.went).toHaveLength(1);
  });
  it('보내기가 실패하면 그림을 줄에 되돌린다 — 그 사이 붙인 것은 뒤에, 번호는 안 겹치게', () => {
    let { s, out } = run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, { kind: 'add', item: img('b'), as: 'img', now: 10 }, { kind: 'sent' }]);
    const went = out[2]!.went!;
    ({ s, out } = run([{ kind: 'back', went }], s));
    expect(s.list.map((a) => a.label)).toEqual(['#img1', '#img2']);
    ({ s, out } = run([{ kind: 'add', item: img('c'), as: 'img', now: 20 }], s));
    expect(out[0]!.label).toBe('#img3');
    ({ s } = run([{ kind: 'back', went }], s));
    expect(s.list.map((a) => a.key)).toEqual(['a', 'b', 'c']); // 같은 것을 두 번 되돌려도 하나
  });
  it('안 보냈는데 다른 길로 터미널 입력칸이 비면(터미널에서 직접 보냄·지움) 4번 연달아 빈 뒤에 비운다', () => {
    const { s, out } = run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, ...reads('', '', 6000, 4)]);
    expect(s.list).toEqual([]);
    expect(out[4]!.idle).toBe(true);
  });
  it('입력칸 읽기를 못 하면(null)·보낸 직후(undefined)는 빈 걸로 안 센다 — 보낼 그림이 사라지지 않게', () => {
    const r = run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, ...reads(null, '', 6000, 10), ...reads(undefined, '', 10000, 10)]);
    expect(r.s.list).toHaveLength(1);
    const mixed = run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, ...reads('', '', 6000, 3), ...reads(null, '', 7200, 1), ...reads('', '', 7600, 3)]);
    expect(mixed.s.list).toHaveLength(1);
  });
  it('쓰는 중(입력칸에 #img 이름표)·붙인 지 5초 안이면 비지 않는다', () => {
    expect(run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, ...reads('', '#img1 이거', 6000, 8)]).s.list).toHaveLength(1);
    expect(run([{ kind: 'add', item: img('a'), as: 'img', now: 0 }, ...reads('', '', 1000, 8)]).s.list).toHaveLength(1);
  });
  it('그림과 파일 번호는 따로 센다', () => {
    const { out } = run([
      { kind: 'add', item: img('a'), as: 'img', now: 0 },
      { kind: 'add', item: { key: 'f', name: 'f.pdf', path: '/f.pdf' }, as: 'file', now: 0 },
      { kind: 'add', item: img('b'), as: 'img', now: 0 },
    ]);
    expect(out.map((o) => o.label)).toEqual(['#img1', '#file1', '#img2']);
  });
  it('빈 줄에서 보내도 아무 일 없다', () => {
    const r = attachStep(NO_ATT, { kind: 'sent' });
    expect(r.went).toEqual([]);
    expect(r.s.list).toEqual([]);
  });
});
