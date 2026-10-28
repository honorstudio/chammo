import { describe, expect, it } from 'vitest';
import { AGENT_COLORS, TEMPLATES, blankDef, changesOf, estimate, foldLong, nameProblem, needsConfirm, refCandidates, calledAgent, type AgentDef, type AgentShown } from './teamAgent';

const def = (o: Partial<AgentDef> = {}): AgentDef => ({ ...blankDef(), name: '회의록', guide: '정리한다', ...o });
const shown = (o: Partial<AgentShown> = {}): AgentShown => ({ id: 'a1', ver: 'v1', def: def(), by: 'm1', edited: 0, mine: true, canEdit: true, clash: false, ...o });

describe('이름', () => {
  it('Rust name_ok 와 같은 규칙 — 1~12자 글자·숫자, 기본 이름 금지', () => {
    expect(nameProblem('회의록', [], [])).toBe('');
    expect(nameProblem('', [], [])).not.toBe('');
    expect(nameProblem('회의 록', [], [])).not.toBe('');
    expect(nameProblem('가나다라마바사아자차카타파', [], [])).not.toBe('');
    expect(nameProblem('팀참모', [], [])).not.toBe('');
    expect(nameProblem('TeamHelper', [], [])).not.toBe('');
  });
  it('사람 이름·다른 참모 이름과 겹치면 안 되고 자기 자신은 된다', () => {
    expect(nameProblem('민지', ['민지'], [])).not.toBe('');
    expect(nameProblem('회의록', [], [shown()])).not.toBe('');
    expect(nameProblem('회의록', [], [shown()], 'a1')).toBe('');
  });
});

describe('템플릿', () => {
  it('넷 — 회의록 정리·요약·번역·일정 정리, 기본은 도구 꺼짐 말고 템플릿에 맞게', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual(['minutes', 'summary', 'translate', 'schedule']);
    for (const t of TEMPLATES) {
      expect(nameProblem(t.def.name, [], [])).toBe('');
      expect(t.def.guide.length).toBeGreaterThan(20);
      expect(t.def.web).toBe(false);
    }
    expect(TEMPLATES.find((t) => t.key === 'minutes')!.def.attach).toBe(true);
    expect(TEMPLATES.find((t) => t.key === 'summary')!.def.model).toBe('haiku');
  });
  it('색은 여섯 개', () => expect(AGENT_COLORS).toHaveLength(6));
});

describe('바뀐 것 보기', () => {
  it('처음이면 first, 확인한 판이면 확인 필요 없음', () => {
    expect(needsConfirm(shown(), {})).toBe(true);
    expect(needsConfirm(shown(), { a1: { ver: 'v1', def: def() } })).toBe(false);
    expect(needsConfirm(shown({ ver: 'v2' }), { a1: { ver: 'v1', def: def() } })).toBe(true);
    expect(changesOf(undefined, def()).first).toBe(true);
  });
  it('도구가 켜지면 앞에, 지침은 줄 단위로 더한 줄·뺀 줄', () => {
    const c = changesOf(def({ guide: '정한 것\n할 일\n남은 질문' }), def({ guide: '정한 것\n할 일\n남은 질문(기사 찾아서)', web: true, model: 'sonnet' }));
    expect(c.first).toBe(false);
    expect(c.toolsOn).toEqual(['web']);
    expect(c.toolsOff).toEqual([]);
    expect(c.model).toEqual(['haiku', 'sonnet']);
    expect(c.added).toEqual(['남은 질문(기사 찾아서)']);
    expect(c.removed).toEqual(['남은 질문']);
    expect(c.grew).toBe(true);
  });
  it('글자만 고친 건 도구가 안 늘었다', () => {
    const c = changesOf(def(), def({ guide: '정리한다!' }));
    expect(c.grew).toBe(false);
    expect(c.toolsOn).toEqual([]);
  });
});

describe('긴 답 접기·토큰 어림', () => {
  it('8줄 넘으면 앞 6줄 + 남은 수', () => {
    const t = Array.from({ length: 14 }, (_, i) => `줄${i}`).join('\n');
    expect(foldLong(t)).toEqual({ head: Array.from({ length: 6 }, (_, i) => `줄${i}`).join('\n'), more: 14 });
    expect(foldLong('a\nb')).toEqual({ head: 'a\nb', more: 0 });
  });
  it('Rust estimate 와 같은 식', () => {
    expect(estimate(def({ guide: '가'.repeat(100) }), 0)).toBe(2600 + 100);
    expect(estimate(def({ guide: '' }), 4000)).toBe(2600 + 1000);
  });
});

describe('참고 자료 후보', () => {
  it('팀 보관함의 글 파일만 — 대화 파일·그림·휴지통·폴더 줄은 빼고', () => {
    const base = { kind: 'file', room: '', state: 'live', why: '' };
    const items = [
      { ...base, id: 'f1', name: '양식.md' },
      { ...base, id: 'f2', name: '사진.png' },
      { ...base, id: 'f3', name: '대화.txt', room: 'r1' },
      { ...base, id: 'f4', name: '지운.csv', state: 'trash' },
      { ...base, id: 'f5', name: '폴더', dir: true },
      { ...base, id: 'f6', name: '용어집.CSV' },
    ];
    expect(refCandidates(items).map((r) => r.id)).toEqual(['f1', 'f6']);
  });
});

describe('부르는 팀 참모 찾기', () => {
  const agents = [shown({ id: 'a1', def: def({ name: '회의' }) }), shown({ id: 'a2', def: def({ name: '회의록' }) }), shown({ id: 'a3', def: def({ name: '번역' }), clash: true })];
  it('Rust mention 과 같다 — 긴 이름 먼저, 따로 선 것만, 이름 겹침 빼고', () => {
    expect(calledAgent('@회의록 정리', agents)?.id).toBe('a2');
    expect(calledAgent('이거 @회의 봐', agents)?.id).toBe('a1');
    expect(calledAgent('메일@회의록', agents)).toBeNull();
    expect(calledAgent('@회의록이 뭐야', agents)).toBeNull();
    expect(calledAgent('@번역 hi', agents)).toBeNull();
  });
});
