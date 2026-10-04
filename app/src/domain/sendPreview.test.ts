import { describe, expect, it } from 'vitest';
import { sendPreview } from './sendPreview';

describe('sendPreview — 시안이 보내자고 한 글을 사람이 보고 누르게(프롬프트 주입 막기, 2026-10-03)', () => {
  it('앞 몇 줄과 글자 수, 빈 줄은 건너뛴다', () => {
    const p = sendPreview('## 결과\n\n- 1 쓴다\n- 2 뺀다\n- 3 애매\n- 4 쓴다\n- 5 쓴다');
    expect(p.lines).toEqual(['## 결과', '- 1 쓴다', '- 2 뺀다', '- 3 애매']);
    expect(p.more).toBe(true);
    expect(p.chars).toBe([...'## 결과\n\n- 1 쓴다\n- 2 뺀다\n- 3 애매\n- 4 쓴다\n- 5 쓴다'].length);
  });
  it('긴 줄은 자르고(잘렸으니 더 있음), 짧은 글은 더 없음', () => {
    const p = sendPreview('가'.repeat(300));
    expect(p.lines[0]!.length).toBeLessThanOrEqual(121);
    expect(p.more).toBe(true);
    expect(sendPreview('짧은 글').more).toBe(false);
  });
});
