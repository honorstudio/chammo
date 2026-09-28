import { describe, expect, it } from 'vitest';
import { addLesson, parseLessons, removeLesson } from './lessons';

// 교훈 = <데이터 폴더>/lessons/<프로젝트>.md 의 '- ' 줄. scripts/task lesson 이 쓰고 send 가 지시에 붙인다
describe('교훈 파일', () => {
  it("'- ' 줄만 교훈이다", () => {
    expect(parseLessons('- 하나\n메모\n\n- 둘 — 설명\n')).toEqual(['하나', '둘 — 설명']);
    expect(parseLessons('')).toEqual([]);
  });

  it('지우기는 그 줄 하나만 — 다른 줄(교훈 아닌 줄 포함)은 그대로', () => {
    expect(removeLesson('- 하나\n# 머리\n- 둘\n- 하나\n', '하나')).toBe('# 머리\n- 둘\n- 하나\n');
    expect(removeLesson('- 하나\n', '없음')).toBe('- 하나\n');
  });

  it('더하기는 끝에, 이미 있으면 그대로', () => {
    expect(addLesson('- 하나\n', '둘')).toBe('- 하나\n- 둘\n');
    expect(addLesson('- 하나', '둘')).toBe('- 하나\n- 둘\n');
    expect(addLesson('', '하나')).toBe('- 하나\n');
    expect(addLesson('- 하나\n', '하나')).toBe('- 하나\n');
  });
});
