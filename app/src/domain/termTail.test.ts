import { describe, expect, it } from 'vitest';
import { termTail } from './termTail';

const L = (o: object) => JSON.stringify(o);
describe('termTail — 대화 기록 꼬리를 터미널처럼 몇 줄(대시보드 세션 칸, 2026-09-30 사용자 "요약돼서 못 알아보겠다")', () => {
  const tail = [
    '{잘린 줄',
    L({ type: 'user', message: { content: '로그인 화면 정리하고 PR 올려' } }),
    L({ type: 'assistant', message: { content: [{ type: 'text', text: '규칙 탭부터 볼게.\n둘째 줄' }] } }),
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: '테스트 돌리기' } }] } }),
    L({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Tests 12 passed\nDone' }] } }),
    L({ type: 'user', isMeta: true, message: { content: '숨은 줄' } }),
  ].join('\n');
  it('사람 말 >, 답·도구 ⏺, 결과 ⎿ — 터미널에 보이는 모양으로', () => {
    expect(termTail(tail, 10)).toEqual([
      '> 로그인 화면 정리하고 PR 올려',
      '⏺ 규칙 탭부터 볼게.',
      '  둘째 줄',
      '⏺ Bash(테스트 돌리기)',
      '  ⎿ Tests 12 passed',
    ]);
  });
  it('끝에서 n 줄만', () => {
    expect(termTail(tail, 2)).toEqual(['⏺ Bash(테스트 돌리기)', '  ⎿ Tests 12 passed']);
  });
});
