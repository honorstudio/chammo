import { describe, expect, it } from 'vitest';
import type { BlockNoteEditor } from '@blocknote/core';
import { fixWritten, writeMd } from './mdPipeline';

// 가짜 편집기 — 문단만(빈 줄로 나눈 글 = 블록 하나). 문서 전체 읽기(tryParseMarkdownToBlocks) 횟수를 센다
function fakeEditor(md: string) {
  const para = (text: string, i: number) => ({ id: `b${i}`, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] });
  const parse = (t: string) => t.split(/\n{2,}/).filter((x) => x.trim()).map(para);
  const ed = {
    parses: 0,
    document: parse(md),
    tryParseMarkdownToBlocks: async (t: string) => { ed.parses++; return parse(t); },
    blocksToMarkdownLossy: async (bs: { content: { text: string }[] }[]) => bs.map((b) => b.content.map((c) => c.text).join('')).join('\n\n') + '\n',
  };
  return ed;
}

describe('mdPipeline — 치는 동안 문서 전체를 다시 읽지 않는다', () => {
  it('글자를 여러 번 쳐도 기준 문서의 조각 지도를 다시 만들지 않는다(최근 지도 캐시에서 밀려나지 않게)', async () => {
    const base = Array.from({ length: 30 }, (_, i) => `문단 ${i} 가나다`).join('\n\n') + '\n';
    const ed = fakeEditor(base);
    const e = ed as unknown as BlockNoteEditor;
    await writeMd(e, base); // 열 때 — 여기서 지도를 만든다
    const after = ed.parses;
    let typed = '';
    for (let k = 0; k < 30; k++) {
      typed += 'a';
      ed.document[10]!.content[0]!.text = `문단 10 가나다${typed}`;
      ed.document = [...ed.document];
      const out = await writeMd(e, base);
      expect(out).toContain(`문단 10 가나다${typed}`);
    }
    expect(ed.parses - after).toBe(0);
  });
});

describe('mdPipeline — 표 칸 안 줄바꿈(공개 이슈 #2)', () => {
  // 진짜 편집기(BlockNote 0.51.4)가 표 블록 하나를 쓴 모양 — '그냥 글' 칸 끝에 x 를 친 뒤
  const MD = '# 제목\n\n| 항목 | 설명 |\n| --- | --- |\n| 첫째 | 한 줄<br>두 줄 |\n| 둘째 | 그냥 글 |\n\n뒤 글\n';
  it('고친 표 블록을 쓸 때 칸 안 줄바꿈은 <br>, 안 고친 행은 원래 줄', () => {
    const raw = '| 항목         | 설명         |\n| ---------- | ---------- |\n| 첫째         | 한 줄\\\n두 줄   |\n| 둘째         | 그냥 글x      |\n';
    expect(fixWritten(MD, raw).trim()).toBe('| 항목 | 설명 |\n| --- | --- |\n| 첫째 | 한 줄<br>두 줄 |\n| 둘째 | 그냥 글x |');
  });
  it('문서 전체를 다시 쓰는 길(조각 지도 실패)에서도 안 건드린 표는 원래 글 그대로', () => {
    const raw = '# 제목\n\n| 항목         | 설명         |\n| ---------- | ---------- |\n| 첫째         | 한 줄\\\n두 줄   |\n| 둘째         | 그냥 글       |\n\n뒤 글x\n';
    expect(fixWritten(MD, raw)).toBe(MD.replace('뒤 글', '뒤 글x'));
  });
});
