import { describe, expect, it } from 'vitest';
import { moveInOrder, orchSort, stepTarget } from './orchOrder';

const o = (id: string) => ({ id, sid: `S${id}` });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const key = (x: { sid: string }) => x.sid;

describe('참모 순서 — 채팅 탭·⌘1~9·사이드바·폰이 같이 쓰는 하나의 순서(2026-10-10 사용자)', () => {
  it('저장한 순서가 없으면 원래 순서(고정만 앞)', () => {
    expect(ids(orchSort([o('a'), o('b'), o('c')], [], [], key))).toEqual(['a', 'b', 'c']);
    expect(ids(orchSort([o('a'), o('b'), o('c')], [], ['Sc'], key))).toEqual(['c', 'a', 'b']);
  });

  it('저장한 순서대로, 순서에 없는 새 참모는 뒤에(원래 순서로)', () => {
    expect(ids(orchSort([o('a'), o('b'), o('c'), o('d')], ['Sc', 'Sa'], [], key))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('순서에만 있고 지금 없는(꺼진) 참모는 건너뛴다', () => {
    expect(ids(orchSort([o('a'), o('b')], ['Sz', 'Sb', 'Sa'], [], key))).toEqual(['b', 'a']);
  });

  it('고정한 참모는 앞 — 고정끼리는 저장한 순서로(끌어 옮긴 게 보이게)', () => {
    // 고정 순서는 a, c 지만 사용자가 c 를 a 앞으로 끌었다
    expect(ids(orchSort([o('a'), o('b'), o('c')], ['Sc', 'Sb', 'Sa'], ['Sa', 'Sc'], key))).toEqual(['c', 'a', 'b']);
  });

  it('고정끼리 저장한 순서가 없으면 고정한 순서', () => {
    expect(ids(orchSort([o('a'), o('b'), o('c')], ['Sb'], ['Sc', 'Sa'], key))).toEqual(['c', 'a', 'b']);
  });

  it('moveInOrder — 오른쪽으로 끌면 놓은 탭 뒤, 왼쪽이면 앞', () => {
    expect(moveInOrder([], ['A', 'B', 'C', 'D'], 'A', 'C')).toEqual(['B', 'C', 'A', 'D']);
    expect(moveInOrder([], ['A', 'B', 'C', 'D'], 'D', 'B')).toEqual(['A', 'D', 'B', 'C']);
    expect(moveInOrder(['X'], ['A', 'B'], 'A', 'A')).toEqual(['X']); // 제자리 — 저장 안 바뀜
  });

  it('moveInOrder — 지금 안 보이는(꺼진) 참모는 저장해 둔 자리 그대로', () => {
    // 저장: A Z B C (Z 는 꺼짐). 보이는 건 A B C — C 를 맨 앞으로
    expect(moveInOrder(['A', 'Z', 'B', 'C'], ['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'Z', 'B']);
    // 저장 맨 앞의 꺼진 참모는 맨 앞에 남는다
    expect(moveInOrder(['Z', 'A', 'B'], ['A', 'B'], 'B', 'A')).toEqual(['Z', 'B', 'A']);
  });

  it('stepTarget — 한 칸 옆(단축키), 끝이거나 고정 경계를 넘으면 없음', () => {
    const shown = ['P', 'A', 'B'];
    const pinned = new Set(['P']);
    expect(stepTarget(shown, pinned, 'A', 1)).toBe('B');
    expect(stepTarget(shown, pinned, 'B', 1)).toBeNull();
    expect(stepTarget(shown, pinned, 'A', -1)).toBeNull(); // 고정한 P 앞으로는 못 간다
    expect(stepTarget(shown, pinned, 'X', 1)).toBeNull();
  });
});
