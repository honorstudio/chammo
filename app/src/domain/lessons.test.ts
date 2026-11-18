import { describe, expect, it } from 'vitest';
import { addLesson, canPromote, groupRequest, isOrchScope, LESSON_MAX, lessonScope, memoryRuleId, parseLessons, removeLesson, shouldGroup, shownLesson } from './lessons';

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

// 교훈이 쌓이면 스킬로 묶자고 참모에게 부탁한다 — 참모가 lesson-review 로 묶음을 짜서 카드 없이 lesson-group 으로 묶고 한 줄만 보고한다(2026-10-08, docs/plans/2026-10-06-self-learning.md)
describe('스킬로 묶기', () => {
  it('scripts/task 의 LESSON_MAX 와 같은 기준 — 넘을 때만, 공통 칸은 아직 아님', () => {
    expect(LESSON_MAX).toBe(12);
    expect(shouldGroup('proj', 12)).toBe(false);
    expect(shouldGroup('proj', 13)).toBe(true);
    expect(shouldGroup('_common', 40)).toBe(false);
  });

  it('부탁 글은 lesson-review·lesson-group 명령과 결과 한 줄만, 버리기만 카드라는 말을 담는다', () => {
    const t = groupRequest('honor-orchestrator', 188);
    expect(t).toContain('scripts/task lesson-review honor-orchestrator');
    expect(t).toContain('188');
    expect(t).toContain('lesson-group');
    expect(t).toContain('lesson-drop');
    expect(t).not.toContain('lesson-propose');
    expect(t).not.toContain('\n');
  });
});

// 참모 창 교훈 탭 = 그 참모 기억 칸(<데이터>/memory/orch/<기본 이름>/MEMORY.md) + 공통 교훈. 모든 참모가 HQ 폴더라 프로젝트로 고르면 다 같은 HQ 교훈이 떴다(2026-11-18)
describe('참모 기억 칸', () => {
  it('참모 창은 기억 칸 이름, 그 밖은 프로젝트', () => {
    expect(lessonScope({ name: '참모-2 · 참모 업데이트', project: 'honor-orchestrator' }, true)).toBe('orch:참모-2');
    expect(lessonScope({ name: 'shop', project: 'shop' }, false)).toBe('shop');
    expect(isOrchScope('orch:참모-2')).toBe(true);
    expect(isOrchScope('shop')).toBe(false);
  });

  it('보이는 글 — 색인 링크는 제목만, 규칙 id 주석은 뺀다', () => {
    expect(shownLesson('[chammo.app 도메인](chammo-app-domain.md) — Cloudflare')).toBe('chammo.app 도메인 — Cloudflare');
    expect(shownLesson('한글로 답한다 <!-- r-a41b -->')).toBe('한글로 답한다');
    expect(shownLesson('그냥 줄')).toBe('그냥 줄');
  });

  it('알아서 기억 규칙 줄이면 id — 지우기는 memory undo 길로', () => {
    expect(memoryRuleId('한글로 답한다 <!-- r-a41b -->')).toBe('r-a41b');
    expect(memoryRuleId('그냥 줄')).toBeNull();
  });

  it('색인 링크 줄은 공통으로 못 올린다(파일이 따라가지 않는다)', () => {
    expect(canPromote('orch:참모-2', '[제목](a.md) — 설명')).toBe(false);
    expect(canPromote('orch:참모-2', '그냥 규칙')).toBe(true);
    expect(canPromote('shop', '[제목](a.md)')).toBe(true);
  });
});
