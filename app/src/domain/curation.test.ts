import { describe, expect, it } from 'vitest';
import { canCurSend, curSendState, curStep, DOC_SANDBOX, emptyStore, fromFrame, isCurationHtml, readCurSent, reviewEscCloses, writeCurSent } from './curation';
import htmlSheetSrc from '../ui/mobile/HtmlSheet.tsx?raw';
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

describe('폰 시안 보내기 — 두 번 눌러도 한 번, 보낸 건 보냄으로(2026-10-11 같은 결과가 두 번 들어감)', () => {
  it('마지막으로 보낸 글과 같으면 보냄 — 다시 안 보낸다', () => {
    expect(curSendState('idle', '## 시안 결과\n- a — 쓴다', '## 시안 결과\n- a — 쓴다')).toBe('sent');
    expect(canCurSend(curSendState('idle', '## 시안 결과\n- a — 쓴다', '## 시안 결과\n- a — 쓴다'))).toBe(false);
  });
  it('표시를 바꿔 글이 달라지면 다시 보낼 수 있다', () => {
    expect(curSendState('idle', '## 시안 결과\n- a — 쓴다', '## 시안 결과\n- a — 뺀다')).toBe('idle');
    expect(curSendState('idle', null, '## 시안 결과')).toBe('idle');
  });
  it('보내는 중엔 또 못 누르고, 실패면 그 자리에서 다시', () => {
    expect(canCurSend(curSendState('sending', null, 'x'))).toBe(false);
    expect(curSendState('fail', null, 'x')).toBe('fail');
    expect(canCurSend('fail')).toBe(true);
  });
  it('보낸 글은 시안마다 저장소에 — 창을 닫았다 다시 열어도 기억', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(readCurSent(s, '/tmp/v1.html')).toBeNull();
    writeCurSent(s, '/tmp/v1.html', '결과 글');
    writeCurSent(s, '/tmp/v2.html', '다른 글');
    expect(readCurSent(s, '/tmp/v1.html')).toBe('결과 글');
    expect(readCurSent(s, '/tmp/v2.html')).toBe('다른 글');
    expect(readCurSent(null, '/tmp/v1.html')).toBeNull();
  });
  it('폰 시안 창은 보낼 함으로 보낸다 — 채팅에 말풍선이 바로 뜨고, 보낸 뒤 창을 닫는다', () => {
    expect(htmlSheetSrc).not.toMatch(/sendTextToSession/);
    expect(htmlSheetSrc).toMatch(/sendOut\(/);
    expect(htmlSheetSrc).toMatch(/setTimeout\(onClose/);
  });
});

describe('폰 블록 메모 — 시안 안 작은 칸 말고 폰 아래 시트(2026-10-11 폰에서 거의 못 씀)', () => {
  it('시안이 메모를 넘기면(cur-note) 아래 시트에 큰 칸으로 받고, 저장은 cur-cmd note 로 되돌린다', () => {
    expect(htmlSheetSrc).toMatch(/hodoc === 'cur-note'/);
    expect(htmlSheetSrc).toMatch(/<textarea/);
    expect(htmlSheetSrc).toMatch(/cmd: 'note'/);
  });
});

// 시안 검토가 스페이스 탭이 되며 채팅 칸이 같이 보인다(fix/curation-space) — Esc 는 검토를 닫되, 채팅 입력칸에서 누른 Esc 까지 검토를 닫진 않는다
describe('reviewEscCloses — Esc 로 검토 닫기', () => {
  const base = { key: 'Escape', inReview: false, editable: false, overlay: false };
  it('검토 화면·빈 자리에서 누르면 닫힌다', () => {
    expect(reviewEscCloses(base)).toBe(true);
    expect(reviewEscCloses({ ...base, inReview: true })).toBe(true);
    expect(reviewEscCloses({ ...base, inReview: true, editable: true })).toBe(true); // 보낼 말 칸
  });
  it('채팅 입력칸(검토 밖 글 칸)·한글 조합 중·위에 뜬 창이 있으면 안 닫는다', () => {
    expect(reviewEscCloses({ ...base, editable: true })).toBe(false);
    expect(reviewEscCloses({ ...base, composing: true })).toBe(false);
    expect(reviewEscCloses({ ...base, overlay: true })).toBe(false);
    expect(reviewEscCloses({ ...base, key: 'Enter' })).toBe(false);
  });
});
