import { describe, expect, it } from 'vitest';
import { addLesson, groupRequest, LESSON_MAX, parseLessons, removeLesson, shouldGroup } from './lessons';

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

// 교훈이 쌓이면 스킬로 묶자고 참모에게 부탁한다 — 참모가 lesson-review 로 묶음을 짜서 결정 대기함 카드로 묻는다(2026-10-08, docs/plans/2026-10-06-self-learning.md)
describe('스킬로 묶기', () => {
  it('scripts/task 의 LESSON_MAX 와 같은 기준 — 넘을 때만, 공통 칸은 아직 아님', () => {
    expect(LESSON_MAX).toBe(12);
    expect(shouldGroup('proj', 12)).toBe(false);
    expect(shouldGroup('proj', 13)).toBe(true);
    expect(shouldGroup('_common', 40)).toBe(false);
  });

  it('부탁 글은 lesson-review 명령과 사람에게 카드로 물으라는 말을 담는다', () => {
    const t = groupRequest('honor-orchestrator', 188);
    expect(t).toContain('scripts/task lesson-review honor-orchestrator');
    expect(t).toContain('188');
    expect(t).toContain('lesson-propose');
    expect(t).not.toContain('\n');
  });
});
