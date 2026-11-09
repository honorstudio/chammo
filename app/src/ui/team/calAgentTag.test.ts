// 일정 보기의 '참모가 넣음' 태그 — 22px 아이콘 칸에 혼자 들어가 글자가 세로로 한 자씩 꺾였다(11-04 사용자 캡처)
import { describe, expect, it } from 'vitest';
import css from './teamCal.css?raw';
import form from './CalForm.tsx?raw';

describe('일정 보기 참모 태그', () => {
  it('태그 앞에 빈 아이콘 칸을 두어 글 칸(1fr)에 놓인다', () => {
    expect(form).toMatch(/tcal-row tcal-agent"><span className="tcal-ic" \/><span className=\{`tcal-agent-tag/);
  });
  it('태그는 한 줄로, 칸 폭만큼 늘지 않는다', () => {
    expect(css).toMatch(/\.tcal-agent-tag \{[^}]*white-space: nowrap;[^}]*justify-self: start;/);
  });
});
