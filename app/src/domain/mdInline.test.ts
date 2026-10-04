import { describe, expect, it } from 'vitest';
import { codeLinkText, keepCodeLinks, keepFences, keepSpanBreaks, mergeAroundCode } from './mdInline';

// 고친 블록 안에서 BlockNote 가 망가뜨리는 글 모양(2026-10-04 실측) — 안 고친 블록은 원래 글 그대로 남고(mdChunks), 이건 고친 블록만
describe('codeLinkText·keepCodeLinks — 글자가 코드인 링크', () => {
  it('재현: 편집기는 코드가 링크를 밀어내 링크가 통째로 사라진다 → 읽기 전에 링크 글자의 백틱을 뺀다', () => {
    expect(codeLinkText('앞 [`a.md`](a.md) 뒤')).toBe('앞 [a.md](a.md) 뒤');
    expect(codeLinkText('**함정은 [`../p.md`](../p.md)**.')).toBe('**함정은 [../p.md](../p.md)**.');
    expect(codeLinkText('[`코드` 와 글](x.md)')).toBe('[코드 와 글](x.md)');
  });
  it('그림·코드 안·펜스 안·백틱 없는 링크는 그대로', () => {
    for (const md of ['[a](a.md)', '`[`a`](b)` 글', '```\n[`a`](a.md)\n```', '![`그림`](a.png)']) expect(codeLinkText(md)).toBe(md);
  });
  it('쓸 땐 원래 글에 있던 코드 링크로 되돌린다', () => {
    const base = '앞 [`a.md`](a.md) 뒤\n\n[`코드` 와 글](x.md)';
    expect(keepCodeLinks(base, '앞 X [a.md](a.md) 뒤\n')).toBe('앞 X [`a.md`](a.md) 뒤\n');
    expect(keepCodeLinks(base, '[코드 와 글](x.md) 새')).toBe('[`코드` 와 글](x.md) 새');
  });
  it('원래 글에 없던 링크·주소가 다른 링크는 그대로', () => {
    expect(keepCodeLinks('[`a.md`](a.md)', '[a.md](b.md) [b](a.md)')).toBe('[a.md](b.md) [b](a.md)');
  });
});

describe('mergeAroundCode — 굵게·기울임·취소선 안 코드', () => {
  it('재현: **a `b` c** 를 **a** `b`** c** 로 써서(** c** 는 굵게가 아님) 저장할 때마다 번졌다', () => {
    expect(mergeAroundCode('**며칠 뒤** `site:`** 재확인** — 결과')).toBe('**며칠 뒤 `site:` 재확인** — 결과');
    expect(mergeAroundCode('**a** `b`** c** `d`** e**')).toBe('**a `b` c `d` e**');
    expect(mergeAroundCode('*기울임* `코드`* 끝*')).toBe('*기울임 `코드` 끝*');
    expect(mergeAroundCode('~~a~~ `b`~~ c~~')).toBe('~~a `b` c~~');
  });
  it('재현: 코드로 시작하는 굵게 **`A` 이 B** 를 `A`** 이 B** 로 쓴다(여는 ** 뒤 띄어쓰기라 굵게가 아님)', () => {
    expect(mergeAroundCode('- [ ] `BLOG_CLI_TOKEN`** 이 Vercel 에 없다** — 로컬')).toBe('- [ ] **`BLOG_CLI_TOKEN` 이 Vercel 에 없다** — 로컬');
    expect(mergeAroundCode('⚠️ `xtc44`** 가 불일치였던 건 대소문자였다** — 끝')).toBe('⚠️ **`xtc44` 가 불일치였던 건 대소문자였다** — 끝');
  });
  it('코드 뒤에서 닫는 굵게(**a `b`** c)는 그대로', () => {
    expect(mergeAroundCode('**a `b`** c')).toBe('**a `b`** c');
    expect(mergeAroundCode('x **a** `b`** c** 끝')).toBe('x **a `b` c** 끝');
  });
  it('따로 쓴 굵게(사이에 띄어쓰기)·탈출 별표·코드 블록은 그대로', () => {
    for (const md of ['**a** `b` **c**', '\\*a\\* `b`\\* c\\*', '```\n**a** `b`** c**\n```', '*a* `b` *c*']) expect(mergeAroundCode(md)).toBe(md);
  });
});

describe('keepSpanBreaks — 줄을 넘던 굵게', () => {
  it('재현: **A\\nB** 를 줄마다 끊어 **A**\\n**B** 로 — 원래 글이 그 모양이면 되돌린다', () => {
    const base = '전에는 **마지막 글의 날짜 줄이\n잘리고**, 두 번째';
    expect(keepSpanBreaks(base, 'X전에는 **마지막 글의 날짜 줄이**\n**잘리고**, 두 번째\n')).toBe('X전에는 **마지막 글의 날짜 줄이\n잘리고**, 두 번째\n');
  });
  it('들여 쓴 이어진 줄로 넘어가던 굵게도', () => {
    const base = '— **\'로그인 상태 유지\'는\n   기본이 꺼짐**이고, 꺼진 채';
    expect(keepSpanBreaks(base, 'X— **\'로그인 상태 유지\'는**\n   **기본이 꺼짐**이고, 꺼진 채')).toBe('X— **\'로그인 상태 유지\'는\n   기본이 꺼짐**이고, 꺼진 채');
  });
  it('원래 따로 굵게였던 두 줄은 그대로', () => {
    expect(keepSpanBreaks('**제목**\n**부제**', '**제목**\n**부제**')).toBe('**제목**\n**부제**');
    expect(keepSpanBreaks('', 'a **b**\n**c** d')).toBe('a **b**\n**c** d');
  });
});

describe('keepFences — 언어 없는 코드 펜스', () => {
  it('재현: ``` 를 ```text 로 쓴다 — 원래 문서에 ```text 가 없으면 되돌린다', () => {
    expect(keepFences('```\n코드\n```', '```text\n코드 X\n```\n')).toBe('```\n코드 X\n```\n');
  });
  it('원래 ```text 를 쓰던 문서·다른 언어는 그대로', () => {
    expect(keepFences('```text\na\n```', '```text\nb\n```')).toBe('```text\nb\n```');
    expect(keepFences('```\na\n```', '```js\nb\n```')).toBe('```js\nb\n```');
  });
});

describe('검토 지적 — 꾸밈 손질', () => {
  it('목록 기호 * 를 기울임 여는 기호로 보지 않는다', () => {
    expect(mergeAroundCode('* `x`*y*')).toBe('* `x`*y*');
    expect(mergeAroundCode('* *a* `b`* c*')).toBe('* *a `b` c*');
  });
  it('코드 블록 안 ```text 줄·긴 펜스 안 짧은 펜스는 건드리지 않는다', () => {
    expect(keepFences('```\na\n```', '````text\n```text\n````\n')).toBe('````\n```text\n````\n');
    expect(codeLinkText('````\n```\n[`x`](y)\n```\n````')).toBe('````\n```\n[`x`](y)\n```\n````');
  });
});
