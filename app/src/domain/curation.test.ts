import { describe, expect, it } from 'vitest';
import { curStep, DOC_SANDBOX, emptyStore, fromFrame, isCurationHtml } from './curation';
import previewSrc from '../ui/space/Preview.tsx?raw';
import curModeSrc from '../ui/space/CurationMode.tsx?raw';

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

describe('DOC_SANDBOX — 데스크톱 시안 칸도 폰처럼 앱과 다른 출처', () => {
  it('스크립트·확인 창만 — 같은 출처·팝업·위 창 옮기기·폼은 주지 않는다', () => {
    expect(DOC_SANDBOX.split(' ').sort()).toEqual(['allow-modals', 'allow-scripts']);
  });
});

describe('curStep — 시안이 알려 온 표시를 파일에 적거나 되돌린다', () => {
  const st = (store?: Record<string, unknown>, text = '결과') => ({ hodoc: 'cur-state', text, store });
  it('칸을 새로 연 첫 알림이 비어 있으면 파일에서 되돌린다(적지 않는다 — 좋은 기록을 빈 걸로 덮지 않게)', () => {
    expect(curStep(true, st({ marks: {}, notes: {} }))).toEqual({ do: 'restore' });
    expect(curStep(true, st(undefined))).toEqual({ do: 'restore' });
  });
  it('첫 알림에 표시가 있으면 바로 적는다', () => {
    expect(curStep(true, st({ marks: { a: 'pick' } }, 'T'))).toEqual({ do: 'save', text: 'T', json: '{"marks":{"a":"pick"}}' });
  });
  it('그 뒤엔 비어도 적는다 — 시안 안 초기화(지우고 새로 고침)가 파일까지 지워야 한다', () => {
    expect(curStep(false, st({ marks: {} }, 'E'))).toEqual({ do: 'save', text: 'E', json: '{"marks":{}}' });
    expect(curStep(false, st(undefined, 'E'))).toEqual({ do: 'save', text: 'E', json: '{}' });
  });
  it('다른 알림·모양이 틀린 것은 무시', () => {
    expect(curStep(false, null)).toBeNull();
    expect(curStep(false, { hodoc: 'esc' })).toBeNull();
    expect(curStep(false, { hodoc: 'cur-state', text: 3 })).toBeNull();
    expect(curStep(false, 'cur-state')).toBeNull();
  });
  it('저장분이 객체가 아니면 빈 것으로 본다', () => {
    expect(curStep(true, { hodoc: 'cur-state', text: 'x', store: 'nope' })).toEqual({ do: 'restore' });
    expect(curStep(false, { hodoc: 'cur-state', text: 'x', store: [1] })).toEqual({ do: 'save', text: 'x', json: '{}' });
  });
});

// 시안 칸 message 는 그 칸이 보낸 것만 — 다른 칸(다른 시안·떼어 낸 창)이 cur-state·curation(참모에게 보낼 글)·esc 를 흉내 내지 못하게(리더·폰 시트와 같은 규칙)
describe('fromFrame — 시안 칸이 보낸 message 인가', () => {
  const a = {} as Window, b = {} as Window;
  it('그 칸 창일 때만', () => {
    expect(fromFrame({ source: a } as MessageEvent, a)).toBe(true);
    expect(fromFrame({ source: b } as MessageEvent, a)).toBe(false);
    expect(fromFrame({ source: null } as MessageEvent, a)).toBe(false);
    expect(fromFrame({ source: null } as MessageEvent, undefined)).toBe(false); // 칸이 없으면 아무것도
  });
  it('재현: 미리보기·검토 모드의 message 듣기마다 fromFrame 으로 거른다(소스 검사)', () => {
    for (const src of [previewSrc, curModeSrc]) {
      const listeners = src.match(/\(e: MessageEvent\) =>/g)?.length ?? 0;
      expect(listeners).toBeGreaterThan(0);
      expect(src.match(/fromFrame\(e, /g)?.length ?? 0).toBe(listeners);
    }
  });
});
