import { describe, expect, it } from 'vitest';
import { mdParse, SANITIZE } from './md';

// 사용자 실기기(2026-10-02): 폰 말풍선에 "**첫 참모 …" 가 별표째 보였다
describe('mdParse — 참모 답의 흔한 꾸밈', () => {
  const text = [
    '- **첫 참모 자동 시작**: 앱을 켰을 때 *꺼져 있으면* 바로 켬',
    '- **첫 참모 자동 시작:** 버튼(`App.tsx:1151`) 대신',
    '1. 둘째 _기울임_ 줄',
  ].join('\n');
  const html = mdParse(text);

  it('굵게는 strong, 별표는 안 남는다', () => {
    expect(html).toContain('<strong>첫 참모 자동 시작</strong>:');
    expect(html).toContain('<strong>첫 참모 자동 시작:</strong>');
    expect(html).not.toContain('**');
  });
  it('기울임·인라인 코드·목록', () => {
    expect(html).toContain('<em>꺼져 있으면</em>');
    expect(html).toContain('<em>기울임</em>');
    expect(html).toContain('<code>App.tsx:1151</code>');
    expect(html).toMatch(/<ul>[\s\S]*<li>[\s\S]*<\/ul>/);
    expect(html).toMatch(/<ol>[\s\S]*<li>/);
  });
  it('한글 바로 앞뒤에 붙은 굵게도 — **"따옴표"**를', () => {
    expect(mdParse('이건 **"첫 참모"**를 켠다')).toContain('<strong>&quot;첫 참모&quot;</strong>를');
  });
});

describe('거름 — 답 글이 앱 화면을 흉내 내지 못하게(2026-10-21 리뷰)', () => {
  it('class·style·id·data-* 를 지운다 — "앱이 전함" 줄·승인 카드(dc-card) 모양을 그대로 그리거나 화면을 덮었다', () => {
    expect(SANITIZE.FORBID_ATTR).toEqual(expect.arrayContaining(['style', 'class', 'id']));
    expect(SANITIZE.ALLOW_DATA_ATTR).toBe(false);
    expect(SANITIZE.FORBID_TAGS).toContain('style');
  });
});
