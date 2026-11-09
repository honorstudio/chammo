import { describe, expect, it } from 'vitest';
import pmView from '../../node_modules/.pnpm/node_modules/prosemirror-view/dist/index.js?raw';
import { hasHangul, isPlainEnter, pmSwallows, replayEnter } from './imeEnter';
import wire from '../ui/space/imeEnter.ts?raw';
import editor from '../ui/space/SpaceEditor.tsx?raw';

// 한글로 치고 Enter 한 번에 줄이 안 바뀌던 것(11-05 사용자 27.png) — ProseMirror 가 사파리(WKWebView)에서 조합이 끝난 직후 0.5초 안의
// Enter 를 '일본어 변환 확정'으로 보고 버린다. 한글은 Enter 가 확정 + 새 줄이라 한 번 더 쳐야 했다
describe('ProseMirror 가 아직 그 Enter 를 버리나 — 판이 바뀌어 고쳐졌으면 이 우회도 걷어 낸다', () => {
  it('사파리 조합 끝 0.5초 안 keydown 무시가 그대로 있다', () => {
    expect(pmView).toMatch(/safari && Math\.abs\(Date\.now\(\) - view\.input\.compositionEndedAt\) < 500/);
  });
});

describe('hasHangul — 조합한 글이 한글인가(자모·완성형)', () => {
  it('완성형·낱자모·옛 자모는 한글', () => {
    expect(hasHangul('한')).toBe(true);
    expect(hasHangul('ㄹ')).toBe(true);
    expect(hasHangul('ㅏ')).toBe(true);
    expect(hasHangul('abc한')).toBe(true);
    expect(hasHangul('ᄀ')).toBe(true); // 첫가끝 자모
  });
  it('일본어·중국어·영문·빈 글은 아니다 — 거기선 Enter 가 변환 확정이라 손대지 않는다', () => {
    expect(hasHangul('かな')).toBe(false);
    expect(hasHangul('漢字')).toBe(false);
    expect(hasHangul('カナ')).toBe(false);
    expect(hasHangul('abc')).toBe(false);
    expect(hasHangul('')).toBe(false);
    expect(hasHangul(null)).toBe(false);
  });
});

describe('isPlainEnter — 맨 Enter 만(⇧·⌘·⌥·⌃ 섞이면 다른 뜻)', () => {
  const k = (o: Partial<KeyboardEvent>) => ({ key: 'Enter', shiftKey: false, metaKey: false, altKey: false, ctrlKey: false, ...o });
  it('맨 Enter', () => { expect(isPlainEnter(k({}))).toBe(true); });
  it('조합 중 Enter 도 key 는 Enter', () => { expect(isPlainEnter(k({ key: 'Enter' }))).toBe(true); });
  it('⇧Enter·⌘Enter·⌥Enter·⌃Enter 는 아니다', () => {
    expect(isPlainEnter(k({ shiftKey: true }))).toBe(false);
    expect(isPlainEnter(k({ metaKey: true }))).toBe(false);
    expect(isPlainEnter(k({ altKey: true }))).toBe(false);
    expect(isPlainEnter(k({ ctrlKey: true }))).toBe(false);
  });
  it('다른 키는 아니다', () => { expect(isPlainEnter(k({ key: 'a' }))).toBe(false); });
});

describe('replayEnter — Enter 가 먹혔을 때만 한 번 대신 친다', () => {
  const base = { hangul: true, swallowed: true, sameBlock: true, sameCount: true };
  it('한글 조합 바로 뒤 Enter 가 아무 일도 안 했으면 대신 친다', () => {
    expect(replayEnter(base)).toBe(true);
  });
  it('Enter 가 이미 줄을 바꿨으면(블록이 바뀌었거나 늘었으면) 안 친다 — 두 줄 내려가지 않게', () => {
    expect(replayEnter({ ...base, sameBlock: false })).toBe(false);
    expect(replayEnter({ ...base, sameCount: false })).toBe(false);
  });
  it('한글이 아니면 안 친다(일본어 변환 확정)', () => {
    expect(replayEnter({ ...base, hangul: false })).toBe(false);
  });
  it('ProseMirror 가 받은 Enter 는 안 친다', () => {
    expect(replayEnter({ ...base, swallowed: false })).toBe(false);
  });
});

describe('pmSwallows — ProseMirror 가 그 Enter 를 버리는 때', () => {
  it('조합 중이면 어디서나 버린다', () => {
    expect(pmSwallows({ composing: true, webkit: false, sinceEnd: 1e9 })).toBe(true);
  });
  it('WebKit(맥 앱)에서 조합 끝 500ms 안이면 버린다', () => {
    expect(pmSwallows({ composing: false, webkit: true, sinceEnd: 3 })).toBe(true);
    expect(pmSwallows({ composing: false, webkit: true, sinceEnd: 499 })).toBe(true);
  });
  it('500ms 지난 Enter·크롬(윈도우 WebView2)의 조합 끝 Enter 는 받는다', () => {
    expect(pmSwallows({ composing: false, webkit: true, sinceEnd: 500 })).toBe(false);
    expect(pmSwallows({ composing: false, webkit: false, sinceEnd: 3 })).toBe(false);
  });
});

describe('편집기 배선', () => {
  it('문서·메모 공통 편집기(SpaceEditor)에 붙고, 맥 WebKit 에서만 켜진다', () => {
    expect(editor).toMatch(/installImeEnter\(el, /);
    expect(wire).toMatch(/if \(!WEBKIT\) return \(\) => \{\};/);
  });
  it('조합 중 Enter 는 막지 않는다 — 확정이 막히면 글이 사라진다', () => {
    expect(wire).toMatch(/if \(!view\.composing && !e\.isComposing\) e\.preventDefault\(\)/);
  });
});
