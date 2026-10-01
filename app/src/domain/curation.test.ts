import { describe, expect, it } from 'vitest';
import { isCurationHtml } from './curation';

describe('isCurationHtml — 검토용 시안(큐레이션 껍데기)인가, 열기 전에 글로 안다', () => {
  it('껍데기가 앱에 진행을 알리는 코드가 있으면 시안', () => {
    expect(isCurationHtml("<script>window.parent.postMessage({ hodoc: 'cur-state', title: document.title })</script>")).toBe(true);
    expect(isCurationHtml('<script>parent.postMessage({hodoc:"cur-state"})</script>')).toBe(true);
  });
  it('보통 웹 페이지는 아니다', () => {
    expect(isCurationHtml('<html><body><h1>cur-state 라는 글자만 있는 문서</h1></body></html>')).toBe(false);
    expect(isCurationHtml('')).toBe(false);
  });
});
