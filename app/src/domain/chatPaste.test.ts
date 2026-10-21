// 채팅 붙여넣기 — 그림이 아닌 파일(파인더에서 ⌘C 한 PDF)을 그림 길(Ctrl+V)로 보내 #img 이름표를 달았다.
// 참모는 파일 아이콘 그림만 받는데 사람은 PDF 를 붙였다고 믿었다(2026-10-21 리뷰 ②-10)
import { describe, expect, it } from 'vitest';
import { pasteKind } from './chat';

describe('pasteKind — 붙여넣은 것이 그림인가·파일인가·글인가', () => {
  it('그림 파일·그림 자료는 그림', () => {
    expect(pasteKind([{ kind: 'file', type: 'image/png' }], false)).toBe('image');
    expect(pasteKind([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/jpeg' }], true)).toBe('image');
  });
  it('그림이 아닌 파일은 파일 — 그림 길로 안 보낸다(이름 글이 같이 와도)', () => {
    expect(pasteKind([{ kind: 'file', type: 'application/pdf' }], false)).toBe('file');
    expect(pasteKind([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: '' }], true)).toBe('file');
  });
  it('웹뷰가 그림을 파일로 안 넘기고 글도 없으면 그림으로(2026-09-30)', () => {
    expect(pasteKind([], false)).toBe('image');
  });
  it('글만 있으면 글', () => {
    expect(pasteKind([{ kind: 'string', type: 'text/plain' }], true)).toBe('text');
  });
});
