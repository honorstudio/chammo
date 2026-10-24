import { describe, expect, it } from 'vitest';
import { splitRefs, withRefs } from './chat';
import { REF_TOKEN, splitTokens } from './chatTokens';
import { bubbleWho, goalRefText, nextRefLabel, taskRefText } from './refChips';

// 2026-10-23 사용자(폰): 진행 칸의 일을 눌러 바로 참모에게 '이거 뭐야' — #task1·#goal1, 폰 말풍선도 #chat1
describe('#task·#goal 참조 — 진행 칸의 일·목표를 참모가 바로 찾게', () => {
  const job = { title: '로그인 고치기', task: '1001-1000-cd34', target: 'ref-chips', state: '일하는 중' };
  it('일 한 줄 = 제목 (task id, 세션, 상태)', () => {
    expect(taskRefText(job)).toBe('로그인 고치기 (task 1001-1000-cd34, ref-chips, 일하는 중)');
  });
  it('목표 한 줄 = 이름 (목표 끝/전체 — 일마다 task id·세션·상태), 일이 많으면 6개 + 외 N', () => {
    expect(goalRefText({ name: '진행 막대 다듬기', done: 1, total: 4, jobs: [job, { ...job, title: '색', task: 'a1', state: '끝' }] }))
      .toBe('진행 막대 다듬기 (목표 1/4 끝 — 로그인 고치기 task 1001-1000-cd34 ref-chips 일하는 중; 색 task a1 ref-chips 끝)');
    const many = Array.from({ length: 8 }, (_, i) => ({ ...job, title: `일${i}`, task: `t${i}` }));
    const t = goalRefText({ name: '큰 일', done: 0, total: 8, jobs: many });
    expect(t).toContain('일5 task t5');
    expect(t).not.toContain('일6 task');
    expect(t).toMatch(/외 2\)$/);
  });
  it('이름표는 종류마다 따로 번호 — 남은 것 중 가장 큰 번호 다음', () => {
    const refs = [{ label: '#chat1', who: '', text: '' }, { label: '#task1', who: '', text: '' }, { label: '#task3', who: '', text: '' }];
    expect(nextRefLabel(refs, 'task')).toBe('#task4');
    expect(nextRefLabel(refs, 'goal')).toBe('#goal1');
    expect(nextRefLabel(refs, 'chat')).toBe('#chat2');
    expect(nextRefLabel([], 'chat', 5)).toBe('#chat6');
  });
  it('보낼 땐 #task1 "…" 로 그 자리에 풀린다(#file1 "경로" 와 같은 꼴) — 말풍선 #chat 은 그대로 인용 블록', () => {
    const refs = [{ label: '#task1', who: '일', text: taskRefText(job) }, { label: '#chat1', who: '답 20:40', text: '앞 답' }];
    expect(withRefs('#task1 이거 뭐야? #chat1 이랑 같은 거야?', refs))
      .toBe('#task1 "로그인 고치기 (task 1001-1000-cd34, ref-chips, 일하는 중)" 이거 뭐야? #chat1 이랑 같은 거야?\n\n[참조 #chat1 · 답 20:40]\n> 앞 답');
  });
  it('글에서 지운 이름표는 안 붙고, #task1 은 #task10 과 헷갈리지 않는다', () => {
    const refs = [{ label: '#task1', who: '일', text: 'A' }];
    expect(withRefs('그냥 말', refs)).toBe('그냥 말');
    expect(withRefs('#task10 봐', refs)).toBe('#task10 봐');
  });
  it('따옴표 속 글은 한 줄 — 큰따옴표·줄바꿈이 따옴표를 깨지 않게, 길면 200자', () => {
    const t = withRefs('#goal1', [{ label: '#goal1', who: '목표', text: `"새" 일\n둘째 ${'가'.repeat(300)}` }]);
    expect(t.startsWith(`#goal1 "'새' 일 둘째 `)).toBe(true);
    expect([...t].length).toBeLessThan(220);
    expect(withRefs('#task1', [{ label: '#task1', who: '일', text: '값 $& 그대로' }])).toBe('#task1 "값 $& 그대로"');
    expect(t.endsWith('…"')).toBe(true);
  });
  it('보낸 말풍선에선 #task1·#goal1 이 이름표 칩으로 보이고, 인용 블록 가르기는 그대로', () => {
    const sent = withRefs('#task1 뭐야', [{ label: '#task1', who: '일', text: 'A (task t1, s, 끝)' }]);
    expect(splitRefs(sent)).toEqual({ body: sent, refs: [] });
    expect(splitTokens(sent)[0]).toEqual({ ref: '#task1' });
    expect(REF_TOKEN.test('#goal2')).toBe(true);
  });
});

describe('말풍선 누구 — 폰·데스크톱 같은 이름(내 말 / 답 + 시각)', () => {
  it('시각을 붙이고, 못 읽는 시각이면 이름만', () => {
    const ts = new Date(2026, 9, 23, 20, 5).toISOString();
    expect(bubbleWho(true, ts)).toBe('내 말 20:05');
    expect(bubbleWho(false, ts)).toBe('답 20:05');
    expect(bubbleWho(false, 'x')).toBe('답');
  });
});
