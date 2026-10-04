import { describe, expect, it } from 'vitest';
import { emptyStore, isCurationHtml } from './curation';

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

describe('emptyStore — 앱이 적어 둔 표시를 되살릴지', () => {
  it('없거나 칸이 다 비었으면 빈 것', () => {
    expect(emptyStore(undefined)).toBe(true);
    expect(emptyStore({ marks: {}, notes: {}, decks: {} })).toBe(true);
  });
  it('시안 표시가 하나라도 있으면 빈 게 아니다', () => {
    expect(emptyStore({ marks: { 'A-헤더': 'pick' }, notes: {}, decks: {} })).toBe(false);
  });
  it('흐름에서 결정만 고른 것도 빈 게 아니다', () => {
    expect(emptyStore({ marks: {}, notes: {}, picks: { 'Q1 결제 방식': { o: '카드', n: '' } }, flows: {} })).toBe(false);
    expect(emptyStore({ marks: {}, notes: {}, picks: {}, flows: { 'TO-BE': '전체적으로 좋다' } })).toBe(false);
  });
});
