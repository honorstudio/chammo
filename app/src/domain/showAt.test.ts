import { describe, expect, it } from 'vitest';
import { lineNeedle, parseAt } from './showAt';

describe('parseAt — show.jsonl 의 at', () => {
  it('맞는 값만 남긴다', () => {
    expect(parseAt({ line: 264, lineEnd: 270, find: '네이버', page: 3, box: [0.1, 0.2, 0.3, 0.4] })).toEqual({ line: 264, lineEnd: 270, find: '네이버', page: 3, box: [0.1, 0.2, 0.3, 0.4] });
    expect(parseAt({ line: 'x', page: -1, box: [1] })).toBeUndefined();
    expect(parseAt(null)).toBeUndefined();
  });
});

describe('lineNeedle — 원본 줄 번호를 그려진 화면에서 찾을 글로(몇 번째인지까지)', () => {
  const src = ['# 계정', '', '| 서비스 | 아이디 |', '|---|---|', '| 예시 서비스 | demo1 |', '', '## 예시 서비스 — 지점 A', '- **아이디**: `demo1`', '예시 서비스 설명'].join('\n');
  it('표 줄은 가장 긴 칸 글', () => {
    expect(lineNeedle(src, 5)).toEqual({ needle: '예시 서비스', nth: 0 });
  });
  it('제목·목록·굵게·코드 표시는 벗긴다', () => {
    expect(lineNeedle(src, 7)).toEqual({ needle: '예시 서비스 — 지점 A', nth: 0 });
    expect(lineNeedle(src, 8)).toEqual({ needle: '아이디: demo1', nth: 0 });
  });
  it('같은 글이 앞에 또 나오면 몇 번째인지 센다', () => {
    expect(lineNeedle(src, 9)).toEqual({ needle: '예시 서비스 설명', nth: 0 });
    expect(lineNeedle('가\n가\n가', 3)).toEqual({ needle: '가', nth: 2 });
  });
  it('빈 줄·구분선이면 아래로 내려가 처음 글 있는 줄', () => {
    expect(lineNeedle(src, 2)).toEqual({ needle: '서비스', nth: 0 });
    expect(lineNeedle(src, 4)).toEqual({ needle: '예시 서비스', nth: 0 });
  });
  it('링크는 보이는 글만', () => {
    expect(lineNeedle('자세히는 [가이드](https://x.y/z) 참고', 1)).toEqual({ needle: '자세히는 가이드 참고', nth: 0 });
  });
});

describe('lineNeedle(raw) — 글 파일은 줄 그대로', () => {
  it('마크다운 표시를 안 벗긴다', () => {
    expect(lineNeedle('a\n  # 주석 줄  \nb', 2, true)).toEqual({ needle: '# 주석 줄', nth: 0 });
  });
});
