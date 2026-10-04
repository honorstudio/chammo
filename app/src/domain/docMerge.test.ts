import { describe, expect, it } from 'vitest';
import { applyOps, diffBlocks, merge3, rebase } from './docMerge';

// 블록 하나 = md 한 덩어리. 편집기가 연 판(base) · 지금 편집기(mine) · 지금 파일(theirs)
const run = (base: string[], mine: string[], theirs: string[]) => {
  const r = merge3(base, mine, theirs);
  return 'conflict' in r ? 'conflict' : applyOps(mine, r.ops, theirs);
};

describe('diffBlocks — 블록 줄 차이', () => {
  it('같으면 없음, 끝에 덧붙이면 끝 자리 삽입', () => {
    expect(diffBlocks(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(diffBlocks(['a', 'b'], ['a', 'b', 'c'])).toEqual([{ s: 2, e: 2, ts: 2, te: 3 }]);
  });
  it('가운데를 바꾸면 그 칸만', () => {
    expect(diffBlocks(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ s: 1, e: 2, ts: 1, te: 2 }]);
  });
  it('떨어진 두 곳은 두 덩어리', () => {
    expect(diffBlocks(['a', 'b', 'c', 'd'], ['x', 'b', 'c', 'y'])).toEqual([{ s: 0, e: 1, ts: 0, te: 1 }, { s: 3, e: 4, ts: 3, te: 4 }]);
  });
});

describe('merge3 — 밖(참모·세션)이 고친 것을 편집기에 받는다(D1, 2026-10-04 QA)', () => {
  const base = ['# 장보기', '우유', '계란', '빵'];
  it('재현: 밖이 끝에 한 줄 덧붙이고 내가 제목을 고쳐도 덧붙인 줄이 남는다', () => {
    expect(run(base, ['# 장보기 메모', '우유', '계란', '빵'], [...base, '사과'])).toEqual(['# 장보기 메모', '우유', '계란', '빵', '사과']);
  });
  it('내가 안 고쳤으면 바깥 판 그대로', () => {
    expect(run(base, base, ['# 장보기', '두유', '계란'])).toEqual(['# 장보기', '두유', '계란']);
  });
  it('바뀐 게 없으면 할 일 없음', () => {
    expect(merge3(base, base, base)).toEqual({ ops: [] });
  });
  it('내가 위에 줄을 넣고 밖이 아래를 고쳐도 자리를 맞춰 받는다', () => {
    expect(run(base, ['# 장보기', '메모 먼저', '또 메모', '우유', '계란', '빵'], ['# 장보기', '우유', '계란', '통밀빵'])).toEqual(['# 장보기', '메모 먼저', '또 메모', '우유', '계란', '통밀빵']);
  });
  it('밖이 내가 안 건드린 블록을 지우면 지운다', () => {
    expect(run(base, ['# 장보기 메모', '우유', '계란', '빵'], ['# 장보기', '우유', '빵'])).toEqual(['# 장보기 메모', '우유', '빵']);
  });
  it('같은 블록을 둘 다 다르게 고치면 충돌 — 덮지 않는다', () => {
    expect(run(base, ['# 장보기', '우유 2개', '계란', '빵'], ['# 장보기', '저지방 우유', '계란', '빵'])).toBe('conflict');
  });
  it('같은 블록을 둘 다 똑같이 고쳤으면 충돌 아님', () => {
    const same = ['# 장보기', '두유', '계란', '빵'];
    expect(run(base, same, same)).toEqual(same);
  });
  it('내가 지운 블록을 밖이 고쳤으면 충돌', () => {
    expect(run(base, ['# 장보기', '계란', '빵'], ['# 장보기', '우유 1L', '계란', '빵'])).toBe('conflict');
  });
  it('같은 자리에 둘 다 새 블록을 넣으면 순서를 모르니 충돌', () => {
    expect(run(base, [...base, '내 줄'], [...base, '바깥 줄'])).toBe('conflict');
  });
  it('밖이 파일을 비웠는데 내가 고친 게 있으면 충돌(통째로 지우기를 말없이 받지 않는다)', () => {
    expect(run(base, ['# 장보기', '우유', '계란', '빵', '내 줄'], [])).toBe('conflict');
    expect(run(base, ['# 장보기 메모', '우유', '계란', '빵'], [])).toBe('conflict');
  });
  it('맞붙은 블록(내 것 바로 다음)을 밖이 고친 건 합친다', () => {
    expect(run(base, ['# 장보기', '우유!', '계란', '빵'], ['# 장보기', '우유', '계란!', '빵'])).toEqual(['# 장보기', '우유!', '계란!', '빵']);
  });
  it('여러 곳을 따로 고쳐도 다 받는다', () => {
    const b = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(run(b, ['a', 'B', 'c', 'd', 'E', 'f'], ['A', 'b', 'c', 'D', 'e', 'f', 'g'])).toEqual(['A', 'B', 'c', 'D', 'E', 'f', 'g']);
  });
  it('큰 문서(블록 5천 개) 양 끝 고치기도 빠르게', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `줄 ${i}`);
    const mine = ['처음 고침', ...big.slice(1)];
    const theirs = [...big.slice(0, -1), '끝 고침'];
    const t = Date.now();
    expect(run(big, mine, theirs)).toEqual(['처음 고침', ...big.slice(1, -1), '끝 고침']);
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('같은 글 블록이 여럿이어도(빈 줄·구분선) 엉뚱한 자리에 넣지 않는다', () => {
    const b = ['---', 'a', '---', 'b', '---'];
    expect(run(b, ['---', 'a!', '---', 'b', '---'], ['---', 'a', '---', 'b', '---', 'c'])).toEqual(['---', 'a!', '---', 'b', '---', 'c']);
  });
  it('흩어진 큰 변경(가운데가 너무 크면 한 덩어리로 본다)은 겹치면 충돌로 — 잃지 않는 쪽', () => {
    const big = Array.from({ length: 6000 }, (_, i) => `줄 ${i}`);
    const theirs = big.map((x, i) => (i % 2 ? `${x}!` : x));
    const mine = big.map((x, i) => (i === 3000 ? '내 것' : x));
    expect(run(big, mine, theirs)).toBe('conflict');
  });
});

describe('rebase — 보낼 것 기준에도 바깥 변경을 옮긴다(사용자가 고친 줄만 남게)', () => {
  it('안 고쳤으면 바깥 판이 새 기준', () => {
    expect(rebase('a\nb', 'a\nb', 'a\nb\nc')).toBe('a\nb\nc');
  });
  it('내가 b 를 고친 뒤 밖이 c 를 덧붙이면 기준에도 c 만 붙는다(내 고침은 기준에 안 들어감)', () => {
    expect(rebase('a\nb', 'a\nb!', 'a\nb!\nc')).toBe('a\nb\nc');
  });
  it('내가 고친 줄을 밖도 고쳤으면 못 옮긴다', () => {
    expect(rebase('a\nb', 'a\nb!', 'a\nb?')).toBeNull();
  });
});
