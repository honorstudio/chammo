import { describe, expect, it } from 'vitest';
import { linesAsBlocks } from './pasteLines';

// 다른 앱에서 맨 글(text/plain)만 붙일 때 — 노션처럼 줄마다 블록(2026-11-09 사용자). 편집기는 맨 글을 md 로 읽어서
// 줄바꿈 하나는 한 문단 안 줄바꿈이 됐다(`첫 줄\` 로 저장). 빈 줄은 문단 구분(빈 블록은 안 만든다)
describe('linesAsBlocks — 맨 글 여러 줄 → 줄마다 블록인 md', () => {
  it('줄마다 블록, 빈 줄은 구분만', () => {
    expect(linesAsBlocks('첫 줄\n둘째 줄\n\n\n넷째 줄')).toBe('첫 줄\n\n둘째 줄\n\n넷째 줄');
  });
  it('CRLF·CR 도 줄바꿈', () => {
    expect(linesAsBlocks('가\r\n나\r다')).toBe('가\n\n나\n\n다');
  });
  it('목록 기호 줄은 목록 그대로, 들여 쓴 아래 줄은 그 항목 안', () => {
    expect(linesAsBlocks('- 하나\n  - 안쪽\n- 둘')).toBe('- 하나\n  - 안쪽\n\n- 둘');
  });
  it('목록이 아닌 줄의 앞 공백은 지운다(4칸이면 코드 블록이 되던 것)', () => {
    expect(linesAsBlocks('문단\n    들여 쓴 줄\n\t탭 줄')).toBe('문단\n\n들여 쓴 줄\n\n탭 줄');
  });
  it('코드 펜스 안은 줄 그대로(빈 줄도)', () => {
    expect(linesAsBlocks('앞\n```js\nconst a = 1\n\nb()\n```\n뒤')).toBe('앞\n\n```js\nconst a = 1\n\nb()\n```\n\n뒤');
  });
  it('닫히지 않은 펜스는 끝까지 코드', () => {
    expect(linesAsBlocks('```\na\nb')).toBe('```\na\nb');
  });
  it('이어진 표 줄은 한 표', () => {
    expect(linesAsBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |\n다음')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n다음');
  });
  it('앞뒤 빈 줄은 버린다', () => {
    expect(linesAsBlocks('\n\n가\n나\n\n')).toBe('가\n\n나');
  });
});
