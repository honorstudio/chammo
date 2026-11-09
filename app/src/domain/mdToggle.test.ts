import { describe, expect, it } from 'vitest';
import { summaryHtml, toggleMd } from './mdToggle';
import { splitChunks } from './mdChunks';

// 접는 목록·접는 제목 — md 엔 접기가 없어 편집기가 그냥 목록(+ 글자 `*`)·그냥 제목으로 써서 다시 열면 접힘이 사라졌다(2026-11-09).
// <details><summary> 로 쓴다: 편집기가 그 모양을 접는 블록으로 읽고, GitHub·VS Code 미리보기는 접히고, 그 밖 도구도 글은 그대로 보인다
describe('toggleMd — 접는 블록을 <details> 로', () => {
  it('접는 목록 + 안쪽 블록', () => {
    expect(toggleMd('접는 <strong>항목</strong>', null, '속 글\n\n- 속 목록')).toBe('<details>\n<summary>접는 <strong>항목</strong></summary>\n\n속 글\n\n- 속 목록\n\n</details>');
  });
  it('접는 제목은 summary 안에 제목 태그', () => {
    expect(toggleMd('접는 머리', 2, '속 글')).toBe('<details>\n<summary><h2>접는 머리</h2></summary>\n\n속 글\n\n</details>');
  });
  it('안쪽이 비면 빈 줄 없이 닫는다', () => {
    expect(toggleMd('빈 토글', null, '')).toBe('<details>\n<summary>빈 토글</summary>\n</details>');
  });
});

const texts = (md: string) => splitChunks(md).map((p) => md.slice(p.start, p.end));
describe('splitChunks — <details> 는 닫힐 때까지 한 조각(안쪽 빈 줄·접는 블록 안 접는 블록)', () => {
  it('안쪽 빈 줄이 있어도 한 조각', () => {
    expect(texts('앞\n\n<details>\n<summary>가</summary>\n\n속\n\n</details>\n\n뒤')).toEqual(['앞', '<details>\n<summary>가</summary>\n\n속\n\n</details>', '뒤']);
  });
  it('중첩된 <details> 는 바깥이 닫힐 때까지', () => {
    const inner = '<details>\n<summary>안</summary>\n\n깊은 글\n\n</details>';
    const md = `<details>\n<summary>밖</summary>\n\n${inner}\n\n</details>\n\n뒤`;
    expect(texts(md)).toEqual([md.slice(0, md.indexOf('\n\n뒤')), '뒤']);
  });
});

describe('summaryHtml — 편집기 HTML 에서 <p> 껍질과 링크 내부 속성을 벗긴다(md 파일에 남지 않게)', () => {
  it('링크는 href 만', () => {
    expect(summaryHtml('<p class="bn-inline-content">링크 <a href="https://ex.com/a b" target="_blank" rel="noopener noreferrer nofollow" classname="bn-inline-content-section" data-inline-content-type="link">가이드</a> <code>코드</code></p>'))
      .toBe('링크 <a href="https://ex.com/a b">가이드</a> <code>코드</code>');
  });
  it('껍질 없는 글은 그대로', () => expect(summaryHtml('그냥 &lt;글&gt;')).toBe('그냥 &lt;글&gt;'));
});
