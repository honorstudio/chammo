import { describe, expect, it } from 'vitest';
import { codeLinkText, keepCodeLinks, keepFences, keepLinkTitles, keepMarkedCode, keepSpanBreaks, mergeAroundCode, mergeInStrike, mergeSplitLinks, mergeSplitMarks } from './mdInline';

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

describe('mergeInStrike — 취소선 안 굵게·기울임', () => {
  // 편집기(ProseMirror)는 꾸밈을 굵게 → 기울임 → 취소선 순으로 감싸서 취소선 안 굵게를 취소선을 끊고 굵게 안에 다시 연다.
  // '~~a ~~' 는 닫는 기호 앞 띄어쓰기라 취소선이 아니어서 다시 읽으면 물결이 글자로 남았다
  it('재현: ~~a **b** c~~ 를 ~~a ~~**~~b~~**~~ c~~ 로 쓴다 → 되돌린다', () => {
    expect(mergeInStrike('~~a ~~**~~b~~**~~ c~~')).toBe('~~a **b** c~~');
    expect(mergeInStrike('~~a ~~*~~b~~*~~ c~~ 끝')).toBe('~~a *b* c~~ 끝');
    expect(mergeInStrike('~~a ~~***~~b~~***~~ c~~')).toBe('~~a ***b*** c~~');
    expect(mergeInStrike('x ~~a ~~**~~b~~**~~ c ~~**~~d~~**~~ e~~ y')).toBe('x ~~a **b** c **d** e~~ y');
  });
  it('취소선이 굵게로 시작하거나 끝나도', () => {
    expect(mergeInStrike('**~~b~~**~~ c~~')).toBe('~~**b** c~~');
    expect(mergeInStrike('~~a ~~**~~b~~**')).toBe('~~a **b**~~');
  });
  it('굵게 전체에 취소선·따로 쓴 둘·코드 안은 그대로', () => {
    for (const md of ['**~~b~~**', '~~a~~ **b**', '**a** ~~b~~', '`~~a ~~**~~b~~**~~ c~~`', '```\n~~a ~~**~~b~~**~~ c~~\n```']) expect(mergeInStrike(md)).toBe(md);
  });
});

describe('mergeSplitMarks — 기울임 안 굵게·굵게 안 기울임·꾸밈 안 취소선', () => {
  // 진짜 BlockNote 0.51 로 읽고 쓴 출력(2026-10-10 md-harness 실측) — 편집기는 글 조각마다 꾸밈을 따로 감싸서(굵게 → 기울임 → 취소선 순)
  // 바깥 꾸밈을 안 꾸밈 앞에서 끊고 다시 연다. '* c*'·'** c**' 는 여는 기호 뒤 띄어쓰기라 꾸밈이 아니어서 다시 읽으면 별표가 글자로 남았다
  it('재현: *a **b** c* 를 *a* ***b**** c* 로 쓴다 → 되돌린다', () => {
    expect(mergeSplitMarks('*a* ***b**** c*')).toBe('*a **b** c*');
    expect(mergeSplitMarks('x *a* ***b**** c* y')).toBe('x *a **b** c* y');
    expect(mergeSplitMarks('*a* ***b**** c* ***d**** e*')).toBe('*a **b** c **d** e*');
  });
  it('재현: **a *b* c** 를 **a** ***b***** c** 로', () => {
    expect(mergeSplitMarks('**a** ***b***** c**')).toBe('**a *b* c**');
    expect(mergeSplitMarks('*a* ***b**** c* 와 **d** ***e***** f**')).toBe('*a **b** c* 와 **d *e* f**');
  });
  it('재현: 기울임·굵게 안 취소선', () => {
    expect(mergeSplitMarks('*a* *~~b~~** c*')).toBe('*a ~~b~~ c*');
    expect(mergeSplitMarks('**a** **~~b~~**** c**')).toBe('**a ~~b~~ c**');
  });
  it('재현: 세 겹 — 굵게 안 취소선·기울임, 기울임 안 굵게 안 취소선', () => {
    expect(mergeSplitMarks('x **a** **~~b~~** ***c***** d** y')).toBe('x **a ~~b~~ *c* d** y');
    expect(mergeSplitMarks('*a* ***b*** ***~~c~~****** d**** e*')).toBe('*a **b ~~c~~ d** e*');
  });
  it('취소선 안 굵게(mergeInStrike 가 하던 것)도 같은 규칙으로', () => {
    expect(mergeSplitMarks('~~a ~~**~~b~~**~~ c~~')).toBe('~~a **b** c~~');
  });
  it('목록·제목 줄 앞 기호는 그대로', () => {
    expect(mergeSplitMarks('* *a* ***b**** c*')).toBe('* *a **b** c*');
    expect(mergeSplitMarks('- [ ] **a** ***b***** c**')).toBe('- [ ] **a *b* c**');
    expect(mergeSplitMarks('## *a* ***b**** c*')).toBe('## *a **b** c*');
  });
  it('편집기가 안 끊은 모양·따로 쓴 꾸밈·코드 안·펜스 안은 그대로', () => {
    for (const md of ['*a **b***', '***b** c*', '*a* *b*', '**a** *b*', '***b***', '2 * 3 * 4', '`*a* ***b**** c*`', '```\n*a* ***b**** c*\n```', '\\*a\\* b'])
      expect(mergeSplitMarks(md)).toBe(md);
  });
});

describe('keepMarkedCode — 꾸밈으로만 감싼 코드(**`a`**)', () => {
  // roadmap 문서 저장 ② — 편집기는 코드에 다른 꾸밈을 못 얹어 **`a`** 를 읽으면 굵게가 사라지고, 그 블록을 고쳐 쓰면 `a` 만 남았다(BlockNote 0.51 실측)
  it('재현: 원래 글에서 꾸밈으로 감싼 코드였으면 되돌린다', () => {
    expect(keepMarkedCode('x **`a`** y', 'x `a` y 고침')).toBe('x **`a`** y 고침');
    expect(keepMarkedCode('*`b`* 와 ~~`c`~~', '`b` 와 `c` 더')).toBe('*`b`* 와 ~~`c`~~ 더');
  });
  it('원래 글에 같은 코드가 맨 것으로도 있으면(어느 쪽인지 모름)·없던 코드·이미 감싼 것은 그대로', () => {
    expect(keepMarkedCode('**`a`** 와 `a`', '`a` 와 `a`')).toBe('`a` 와 `a`');
    expect(keepMarkedCode('**`a`**', '`z`')).toBe('`z`');
    expect(keepMarkedCode('**`a`**', '**`a`**')).toBe('**`a`**');
  });
});

describe('mergeSplitLinks — 링크 글자 안 꾸밈', () => {
  // 진짜 BlockNote 0.51: [링크 **굵게**](a.md) 를 [링크 ](a.md)**[굵게](a.md)** 로 써서 링크가 둘로 갈라졌다(보이는 건 같지만 글이 번진다)
  it('재현: 같은 주소로 이어 붙은 링크 조각을 하나로', () => {
    expect(mergeSplitLinks('[링크 ](a.md)**[굵게](a.md)**')).toBe('[링크 **굵게**](a.md)');
    expect(mergeSplitLinks('x **[굵게](a.md)**[ 뒤](a.md) y')).toBe('x [**굵게** 뒤](a.md) y');
    expect(mergeSplitLinks('[a ](u)*[b](u)*[ c](u)')).toBe('[a *b* c](u)');
  });
  it('주소가 다르거나 사이에 글이 있거나 그림이면 그대로', () => {
    for (const md of ['[a](u)**[b](v)**', '[a](u) **[b](u)**', '![a](u)**[b](u)**', '`[a](u)**[b](u)**`']) expect(mergeSplitLinks(md)).toBe(md);
  });
});

describe('keepLinkTitles — 링크·그림 툴팁', () => {
  // roadmap 문서 저장 ④ — 편집기는 [a](a.md "툴팁") 의 툴팁을 버려(BlockNote 0.51 실측) 그 블록을 고치면 툴팁이 사라졌다
  it('재현: 원래 글에 같은 글자·같은 주소로 툴팁이 있었으면 되살린다', () => {
    expect(keepLinkTitles('[a](a.md "툴팁")', '[a](a.md) 더')).toBe('[a](a.md "툴팁") 더');
    expect(keepLinkTitles("앞 [링크](https://x.com/ '제목') 뒤", '앞 [링크](https://x.com/) 뒤!')).toBe("앞 [링크](https://x.com/ '제목') 뒤!");
    expect(keepLinkTitles('![그림](p.png "설명")', '![그림](p.png)')).toBe('![그림](p.png "설명")');
  });
  it('글자나 주소가 다르면·이미 툴팁이 있으면·코드 안이면 그대로', () => {
    expect(keepLinkTitles('[a](a.md "t")', '[b](a.md) [a](b.md)')).toBe('[b](a.md) [a](b.md)');
    expect(keepLinkTitles('[a](a.md "t")', '[a](a.md "새")')).toBe('[a](a.md "새")');
    expect(keepLinkTitles('[a](a.md "t")', '`[a](a.md)`')).toBe('`[a](a.md)`');
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
