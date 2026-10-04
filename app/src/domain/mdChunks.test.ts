import { describe, expect, it } from 'vitest';
import { alignChunks, joinChunks, nestChildren, planChunks, splitChunks, type Chunk, type Seg } from './mdChunks';

// 문서를 한 글자만 고쳐도 BlockNote 가 파일 전체를 다시 써서(링크·굵게·목록 모양이 바뀌고 저장마다 번짐) 안 바뀐 블록은
// 원래 md 글 그대로 쓴다(2026-10-04) — 원문을 md 블록 경계로 조각내고, 조각 ↔ 편집기 블록을 맞춰 이어 붙인다
const texts = (md: string) => splitChunks(md).map((p) => md.slice(p.start, p.end));

describe('splitChunks — md 블록 경계로 원문 조각', () => {
  it('빈 줄로 나뉜 문단·제목, 빈 줄 없는 제목 다음 줄도', () => {
    expect(texts('# 제목\n본문 한 줄\n둘째 줄\n\n다음 문단\n')).toEqual(['# 제목', '본문 한 줄\n둘째 줄', '다음 문단']);
  });
  it('최상위 목록 항목마다(안쪽 목록·이어진 줄은 그 항목에)', () => {
    expect(texts('- a\n  - a1\n  이어짐\n- b\n\n- c\n\n  c 둘째 문단\n- d')).toEqual(['- a\n  - a1\n  이어짐', '- b', '- c\n\n  c 둘째 문단', '- d']);
    expect(texts('1. 하나\n2. 둘\n* [ ] 할 일')).toEqual(['1. 하나', '2. 둘', '* [ ] 할 일']);
  });
  it('코드 펜스는 통째로 — 안의 목록·제목·빈 줄은 안 나눈다', () => {
    expect(texts('앞\n\n```js\n# 아님\n\n- 아님\n```\n뒤')).toEqual(['앞', '```js\n# 아님\n\n- 아님\n```', '뒤']);
    expect(texts('~~~\n```\n~~~')).toEqual(['~~~\n```\n~~~']);
  });
  it('닫히지 않은 펜스는 끝까지 한 조각', () => {
    expect(texts('a\n\n```\nb\n\nc')).toEqual(['a', '```\nb\n\nc']);
  });
  it('표·인용은 빈 줄까지 한 조각', () => {
    expect(texts('| a | b |\n|---|---|\n| 1 | 2 |\n\n> 인용\n> 둘째')).toEqual(['| a | b |\n|---|---|\n| 1 | 2 |', '> 인용\n> 둘째']);
  });
  it('앞뒤 빈 줄·끝 줄바꿈 없음 — 조각엔 안 들어간다', () => {
    const md = '\n\n가\n\n\n나';
    expect(texts(md)).toEqual(['가', '나']);
    expect(splitChunks(md)[0]!.start).toBe(2);
  });
  it('링크만 있는 줄이 이어지면 줄마다(편집기에선 페이지 블록 하나씩) — 글이 섞이면 한 문단', () => {
    expect(texts('[a](a.md)\n[b](b.md)\n\n[c](c.md)\n글 섞임')).toEqual(['[a](a.md)', '[b](b.md)', '[c](c.md)\n글 섞임']);
  });
  it('빈 문서', () => expect(splitChunks('')).toEqual([]));
});

// 가짜 파서 — 조각 하나를 블록 직렬화 목록으로(목록 항목·문단마다 하나)
const fakeParse = async (t: string) => t.split(/\n\n+/).filter((x) => x.trim() && !x.startsWith('<!--')).map((x) => x.trim().replace(/^- /, '* '));

describe('alignChunks — 조각을 따로 읽은 블록이 문서 전체를 읽은 블록과 맞아야 짝', () => {
  it('맞으면 조각마다 블록', async () => {
    const md = '가\n\n- 나\n- 다';
    const m = await alignChunks(md, ['가', '* 나', '* 다'], fakeParse);
    expect(m.complete).toBe(true);
    expect(m.chunks.map((c) => c.sers)).toEqual([['가'], ['* 나'], ['* 다']]);
  });
  it('블록이 없는 조각(주석·참조 링크 정의)은 블록 없는 조각으로 따로 — 이웃이 남으면 같이 남는다', async () => {
    const md = '<!-- 메모 -->\n\n가\n\n<!-- 끝 -->';
    const m = await alignChunks(md, ['가'], fakeParse);
    expect(m.chunks.map((c) => [md.slice(c.start, c.end), c.sers.length])).toEqual([['<!-- 메모 -->', 0], ['가', 1], ['<!-- 끝 -->', 0]]);
    expect(m.complete).toBe(true);
  });
  it('따로 읽으면 빈 블록만 나오는 조각(편집기는 주석을 빈 문단으로 읽는다)도 블록 없는 조각', async () => {
    const md = '<!-- 메모 -->\n\n가';
    const m = await alignChunks(md, ['가'], async (t) => (t.startsWith('<!--') ? [''] : [t]));
    expect(m.chunks.map((c) => c.sers.length)).toEqual([0, 1]);
  });
  it('따로 읽으면 다르게 읽히는 조각(참조 링크 등)은 다음 조각과 합쳐 다시', async () => {
    const md = 'A\n\nB';
    const parse = async (t: string) => (t === 'A\n\nB' ? ['AB'] : [t]);
    const m = await alignChunks(md, ['AB'], parse);
    expect(m.chunks.map((c) => md.slice(c.start, c.end))).toEqual(['A\n\nB']);
    expect(m.complete).toBe(true);
  });
  it('끝내 안 맞으면 거기서 멈춘다(그 뒤 블록은 새로 쓴다)', async () => {
    const md = '가\n\n나';
    const m = await alignChunks(md, ['가', '전혀 다름'], fakeParse);
    expect(m.chunks.map((c) => c.sers)).toEqual([['가']]);
    expect(m.complete).toBe(false);
  });
});

const ch = (md: string, sers: string[][]): Chunk[] => {
  const ps = splitChunks(md);
  return ps.map((p, i) => ({ ...p, sers: sers[i]! }));
};

describe('planChunks — 지금 블록에서 안 바뀐 조각 찾기', () => {
  const chunks = [{ start: 0, end: 1, sers: ['a'] }, { start: 3, end: 4, sers: ['b', 'c'] }, { start: 6, end: 7, sers: ['d'] }];
  it('그대로면 전부 keep', () => {
    expect(planChunks(chunks, ['a', 'b', 'c', 'd'])).toEqual([{ keep: 0, from: 0, to: 1 }, { keep: 1, from: 1, to: 3 }, { keep: 2, from: 3, to: 4 }]);
  });
  it('조각 안 블록 하나가 바뀌면 그 조각만 새로', () => {
    expect(planChunks(chunks, ['a', 'b', 'C', 'd'])).toEqual([{ keep: 0, from: 0, to: 1 }, { fresh: true, from: 1, to: 3 }, { keep: 2, from: 3, to: 4 }]);
  });
  it('지움·넣음·옮김', () => {
    expect(planChunks(chunks, ['a', 'd'])).toEqual([{ keep: 0, from: 0, to: 1 }, { keep: 2, from: 1, to: 2 }]);
    expect(planChunks(chunks, ['새', 'a', 'b', 'c', 'd'])[0]).toEqual({ fresh: true, from: 0, to: 1 });
    expect(planChunks(chunks, ['d', 'a', 'b', 'c'])).toEqual([{ keep: 2, from: 0, to: 1 }, { keep: 0, from: 1, to: 2 }, { keep: 1, from: 2, to: 4 }]);
  });
  it('같은 조각을 두 번 쓰지 않는다(복제한 블록은 새로)', () => {
    expect(planChunks(chunks, ['a', 'a', 'b', 'c', 'd'])).toEqual([{ keep: 0, from: 0, to: 1 }, { fresh: true, from: 1, to: 2 }, { keep: 1, from: 2, to: 4 }, { keep: 2, from: 4, to: 5 }]);
  });
});

describe('joinChunks — 원문 조각 + 새로 쓴 조각 이어 붙이기', () => {
  const md = '\n# 제목\n본문\n\n- 하나\n- 둘\n\n```\n코드\n```\n\n끝 문단';
  const chunks = ch(md, [['# 제목'], ['본문'], ['* 하나'], ['* 둘'], ['```\n코드\n```'], ['끝 문단']]);
  const all = chunks.map((_, j) => ({ keep: j, from: j, to: j + 1 }));
  it('안 바뀌면 원래 글 그대로(앞 빈 줄·끝 줄바꿈 없음까지)', () => {
    expect(joinChunks(md, chunks, all, () => '', true).text).toBe(md);
  });
  it('한 블록 고치면 그 조각만 바뀐다', () => {
    const segs = all.map((s, j) => (j === 1 ? { fresh: true as const, from: 1, to: 2 } : s));
    expect(joinChunks(md, chunks, segs, () => '본문 X\n', true).text).toBe(md.replace('본문', '본문 X'));
  });
  it('목록 사이에 새 항목 — 빽빽한 목록은 줄바꿈 하나로', () => {
    const segs = [...all.slice(0, 3), { fresh: true as const, from: 3, to: 4 }, ...all.slice(3).map((s) => ({ ...s, from: s.from + 1, to: s.to + 1 }))];
    expect(joinChunks(md, chunks, segs, () => '* 새 항목\n', true).text).toContain('- 하나\n* 새 항목\n- 둘');
  });
  it('문단 사이에 새 문단 — 빈 줄로(한 문단으로 붙지 않게)', () => {
    const segs = [all[0]!, all[1]!, { fresh: true as const, from: 2, to: 3 }, ...all.slice(2).map((s) => ({ ...s, from: s.from + 1, to: s.to + 1 }))];
    expect(joinChunks(md, chunks, segs, () => '새 문단', true).text).toContain('본문\n\n새 문단\n\n- 하나');
  });
  it('지우면 그 조각과 앞 사이만 빠진다', () => {
    const segs = [all[0]!, all[1]!, all[2]!, all[4]!, all[5]!].map((s, i) => ({ ...s, from: i, to: i + 1 }));
    expect(joinChunks(md, chunks, segs, () => '', true).text).toBe('\n# 제목\n본문\n\n- 하나\n\n```\n코드\n```\n\n끝 문단');
  });
  it('끝 조각을 고치면 원래 끝(줄바꿈 없음)을 따른다', () => {
    const segs = all.map((s, j) => (j === 5 ? { fresh: true as const, from: 5, to: 6 } : s));
    expect(joinChunks(md, chunks, segs, () => '끝 X\n', true).text.endsWith('\n\n끝 X')).toBe(true);
  });
  it('새로 쓴 게 비면(빈 줄 블록) 건너뛴다', () => {
    const segs = [...all, { fresh: true as const, from: 6, to: 7 }];
    expect(joinChunks(md, chunks, segs, () => '\n', true).text).toBe(md);
  });
  it('짝을 다 못 맞춘 문서(complete=false)는 원래 끝 글을 붙이지 않는다', () => {
    const part = chunks.slice(0, 2);
    const segs = [all[0]!, all[1]!, { fresh: true as const, from: 2, to: 6 }];
    const out = joinChunks(md, part, segs, () => '* 하나\n* 둘\n\n```\n코드\n```\n\n끝 문단\n', false).text;
    expect(out).toBe('\n# 제목\n본문\n\n* 하나\n* 둘\n\n```\n코드\n```\n\n끝 문단');
  });
  it('이어 붙인 글의 조각 지도도 돌려준다 — 다음 저장의 기준', () => {
    const segs = all.map((s, j) => (j === 1 ? { fresh: true as const, from: 1, to: 2 } : s));
    const cur = ['# 제목', '본문 X', '* 하나', '* 둘', '```\n코드\n```', '끝 문단'];
    const r = joinChunks(md, chunks, segs, () => '본문 X\n', true, cur);
    expect(r.chunks.map((c) => r.text.slice(c.start, c.end))).toEqual(['# 제목', '본문 X', '- 하나', '- 둘', '```\n코드\n```', '끝 문단']);
    expect(r.chunks[1]!.sers).toEqual(['본문 X']);
    // 이어 붙인 글로 다시 이어 붙이면 그대로
    expect(joinChunks(r.text, r.chunks, all, () => '', true).text).toBe(r.text);
  });
});

describe('joinChunks — 줄바꿈 하나로 붙이면 md 가 섞이는 곳은 빈 줄', () => {
  const md = '- 하나\n- 둘\n문단';
  const chunks = ch(md, [['* 하나'], ['* 둘'], ['문단']]);
  const run = (fresh: string, at: number) => {
    const segs: Seg[] = [];
    chunks.forEach((_, j) => { if (j === at) segs.push({ fresh: true, from: 0, to: 0 }); segs.push({ keep: j, from: 0, to: 0 }); });
    return joinChunks(md, chunks, segs, (s) => ('fresh' in s ? fresh : ''), true).text;
  };
  it('목록 항목 뒤에 새 문단 — 항목에 붙지 않게 빈 줄', () => expect(run('새 문단', 1)).toContain('- 하나\n\n새 문단'));
  it('새 문단 뒤에 --- (제목 밑줄이 되지 않게)', () => expect(run('---', 2).includes('- 둘\n---')).toBe(false));
  it('문단 앞 3. 번호(문단을 못 끊는다)는 빈 줄, 기호 목록은 줄바꿈 하나', () => {
    const md2 = '문단\n\n끝';
    const c2 = ch(md2, [['문단'], ['끝']]);
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { fresh: true, from: 1, to: 2 }, { keep: 1, from: 2, to: 3 }];
    expect(joinChunks(md2, c2, segs, () => '3. 셋', true).text).toBe('문단\n\n3. 셋\n\n끝');
  });
});

describe('joinChunks — 이어진 줄이 붙은 목록 항목 다음 항목', () => {
  it('재현: "2.5." 처럼 목록이 아닌 이어진 줄로 끝나는 항목 뒤 항목을 고치면 빈 줄이 생겼다', () => {
    const md = '1. 하나\n2. 둘\n2.5. 이어진 줄\n3. 셋';
    const chunks = ch(md, [['#. 하나'], ['#. 둘\n2.5. 이어진 줄'], ['#. 셋']]);
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 1, from: 1, to: 2 }, { fresh: true, from: 2, to: 3 }];
    expect(joinChunks(md, chunks, segs, () => '3. 셋 X', true).text).toBe('1. 하나\n2. 둘\n2.5. 이어진 줄\n3. 셋 X');
  });
});

// BlockNote 는 목록 항목의 하위 문단을 들여쓰기 없이 최상위로 꺼내 써서 다시 읽으면 형제가 된다(번호도 1부터 다시) — 2026-10-04 실측
describe('nestChildren — 목록 항목 아래 하위 블록', () => {
  it('재현: 하위 문단을 항목 글자 폭만큼 들여 쓴다', () => {
    expect(nestChildren('* a', 'child c', false)).toBe('* a\n\n  child c');
    expect(nestChildren('1. one', 'child two\\\nline2', false)).toBe('1. one\n\n   child two\\\n   line2');
    expect(nestChildren('* [ ] 할 일', '설명', false)).toBe('* [ ] 할 일\n\n  설명');
  });
  it('하위 목록은 빈 줄 없이, 깊이 들여 쓴 줄·빈 줄은 그대로 한 번만 민다', () => {
    expect(nestChildren('* a', '* sub\n\n  deep', true)).toBe('* a\n  * sub\n\n    deep');
  });
  it('목록이 아닌 블록 아래(편집기만의 들여쓰기)는 md 로 못 나타내 그대로 이어 쓴다', () => {
    expect(nestChildren('top', 'kid', false)).toBe('top\n\nkid');
  });
  it('코드 펜스 안 줄도 같이 민다(항목 안 펜스)', () => {
    expect(nestChildren('- a', '```\nx\n```', false)).toBe('- a\n\n  ```\n  x\n  ```');
  });
});

describe('joinChunks — 블록 없는 조각(주석·참조 링크 정의)은 이웃이 남으면 같이', () => {
  const md = '가\n\n<!-- 메모 -->\n\n[a](a.md)\n[b](b.md)\n\n[x]: https://x';
  const chunks = ch(md, [['가'], [], ['[a]'], ['[b]'], []]);
  it('재현: 페이지 블록 하나를 지우면 앞 주석·옆 링크까지 새로 쓰였다 → 주석·남은 링크는 원래 글', () => {
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 2, from: 1, to: 2 }];
    expect(joinChunks(md, chunks, segs, () => '', true).text).toBe('가\n\n<!-- 메모 -->\n\n[a](a.md)\n\n[x]: https://x');
  });
  it('양쪽 이웃이 새로 쓰여도 주석·참조 정의는 남는다', () => {
    const segs: Seg[] = [{ fresh: true, from: 0, to: 3 }];
    expect(joinChunks(md, chunks, segs, () => '나\n\n[a](a.md)', true).text).toBe('나\n\n[a](a.md)\n\n<!-- 메모 -->\n\n[x]: https://x');
  });
  it('다 그대로면 원문 그대로', () => {
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 2, from: 1, to: 2 }, { keep: 3, from: 2, to: 3 }];
    expect(joinChunks(md, chunks, segs, () => '', true).text).toBe(md);
  });
});

describe('joinChunks — 같은 목록에 새 항목은 그 목록의 촘촘함으로', () => {
  const md = '- 하나\n- 둘\n\n1. 영';
  const chunks = ch(md, [['* 하나'], ['* 둘'], ['#. 영']]);
  it('재현: 목록 끝 항목 뒤에 넣으면 목록 끝 빈 줄을 따라 빈 줄이 생겼다', () => {
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 1, from: 1, to: 2 }, { fresh: true, from: 2, to: 3 }, { keep: 2, from: 3, to: 4 }];
    expect(joinChunks(md, chunks, segs, () => '- 셋', true).text).toBe('- 하나\n- 둘\n- 셋\n\n1. 영');
  });
  it('고친 항목(원래 자리를 대신)은 원래 사이 글 — 빈 줄로 띄운 목록이면 빈 줄', () => {
    const md2 = '- 가\n\n- 나\n  이어짐\n\n- 다\n- 라';
    const c2 = ch(md2, [['* 가'], ['* 나'], ['* 다'], ['* 라']]);
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { fresh: true, from: 1, to: 2 }, { keep: 2, from: 2, to: 3 }, { keep: 3, from: 3, to: 4 }];
    expect(joinChunks(md2, c2, segs, () => '- X나\n  이어짐', true).text).toBe(md2.replace('- 나', '- X나'));
  });
  it('다른 종류 목록 사이(지운 뒤)는 원래 빈 줄', () => {
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 2, from: 1, to: 2 }];
    expect(joinChunks(md, chunks, segs, () => '', true).text).toBe('- 하나\n\n1. 영');
  });
});

// 2026-10-04 독립 검토에서 찾은 것 — 재현 먼저
describe('검토 지적 — 조각 나누기·이어 붙이기', () => {
  it('[치명] 빈 줄이 든 HTML 주석은 닫는 줄까지 한 조각(가운데서 자르면 닫히지 않은 주석이 뒤를 먹었다)', () => {
    expect(texts('A\n\n<!--\nnote\n\nmore\n-->\n\nB')).toEqual(['A', '<!--\nnote\n\nmore\n-->', 'B']);
    expect(texts('<script>\nx\n\ny\n</script>\nB')).toEqual(['<script>\nx\n\ny\n</script>', 'B']);
  });
  it('[치명] 블록 없는 조각은 닫힌 주석·참조 링크 정의일 때만 — 아니면 다음 조각과 합쳐 다시', async () => {
    const md = '<!--\nnote\n\nB';
    const m = await alignChunks(md, ['B'], async (t) => (t.startsWith('<!--') && !t.includes('-->') ? [] : [t]));
    expect(m.chunks.every((c) => c.sers.length > 0 || /-->/.test(md.slice(c.start, c.end)))).toBe(true);
  });
  it('끝에 안 닫힌 코드 펜스 뒤에 새 블록 — 펜스를 닫고 붙인다', () => {
    const md = 'A\n\n```\ncode';
    const chunks = ch(md, [['A'], ['```\ncode\n```']]);
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { keep: 1, from: 1, to: 2 }, { fresh: true, from: 2, to: 3 }];
    expect(joinChunks(md, chunks, segs, () => 'NEW', true).text).toBe('A\n\n```\ncode\n```\n\nNEW');
  });
  it('문서 맨 위 주석(블록 없는 조각)은 첫 블록을 고쳐도 맨 위에', () => {
    const md = '<!-- keep at top -->\n\n# T\n\nbody';
    const chunks = ch(md, [[], ['# T'], ['body']]);
    const segs: Seg[] = [{ fresh: true, from: 0, to: 1 }, { keep: 2, from: 1, to: 2 }];
    expect(joinChunks(md, chunks, segs, () => '# T2', true).text).toBe('<!-- keep at top -->\n\n# T2\n\nbody');
  });
});

describe('검토 지적 — 편집기가 못 읽는 뒤쪽 글', () => {
  it('[치명] 문서 블록이 다 짝지어졌는데 원문이 남으면(편집기가 못 읽은 글) 원래 글 그대로 남긴다', async () => {
    const md = 'A\n\n<!--\nnote\n\nmore\n-->\n\nB\n\nC\n';
    // BlockNote 는 이 문서를 [A] 하나로 읽는다(실측) — 주석 뒤 B·C 는 편집기에 안 보인다
    const m = await alignChunks(md, ['A'], async (t) => (t === 'A' ? ['A'] : t.startsWith('<!--') ? [''] : [t]));
    expect(m.complete).toBe(true);
    const segs: Seg[] = [{ fresh: true, from: 0, to: 1 }];
    expect(joinChunks(md, m.chunks, segs, () => 'A2', m.complete).text).toBe(md.replace('A\n', 'A2\n'));
  });
  it('맨 위에 넣은 번호 항목 뒤는 그 목록의 촘촘함', () => {
    const md = '1. a\n2. b\n';
    const chunks = ch(md, [['#. a'], ['#. b']]);
    const segs: Seg[] = [{ fresh: true, from: 0, to: 1 }, { keep: 0, from: 1, to: 2 }, { keep: 1, from: 2, to: 3 }];
    expect(joinChunks(md, chunks, segs, () => '1. X', true).text).toBe('1. X\n1. a\n2. b\n');
  });
});

describe('검토 지적 2차 — 편집기가 못 읽는 꼬리는 늘 맨 끝', () => {
  it('재현: 끝에 새 블록을 넣으면 안 보이는 꼬리 뒤에 붙어 다시 열면 사라졌다', async () => {
    const md = 'A\n\n<!--\nnote\n\nmore\n-->\n\nB\n';
    const m = await alignChunks(md, ['A'], async (t) => (t === 'A' ? ['A'] : t.startsWith('<!--') ? [''] : [t]));
    const segs: Seg[] = [{ keep: 0, from: 0, to: 1 }, { fresh: true, from: 1, to: 2 }];
    const r = joinChunks(md, m.chunks, segs, () => 'D', m.complete, ['A', 'D']);
    expect(r.text).toBe('A\n\nD\n\n<!--\nnote\n\nmore\n-->\n\nB\n');
    // 이어 붙인 글의 지도에서도 꼬리는 꼬리 — 다음 저장에도 맨 끝
    expect(r.chunks[r.chunks.length - 1]!.tail).toBe(true);
  });
});
