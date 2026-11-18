import { describe, expect, it } from 'vitest';
import pmView from '../../node_modules/.pnpm/node_modules/prosemirror-view/dist/index.js?raw';
import { fakeCompositionEnter, hasHangul, replayTab, isPlainEnter, pmSwallows, replayEnter } from './imeEnter';
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

// 11-17 사용자 '새 문서 8.md' — 하위 번호 목록 새 항목에서 '이렇게' → '1. 이 / 2. 이렇게', 자음 연타 'ㅇ / ㅇㅇㅇ…'
describe('fakeCompositionEnter — 조합 확정 때 ProseMirror 가 DOM 바뀜에서 지어낸 Enter', () => {
  const base = { composing: true, sinceRealEnter: 5000, blockText: 'ㅇ', composed: 'ㅇ' };
  it('하위 항목의 유일한 글이 조합 글인데 진짜 Enter 없이 온 가짜 Enter 는 가짜다', () => {
    expect(fakeCompositionEnter(base)).toBe(true);
    expect(fakeCompositionEnter({ ...base, blockText: '이', composed: '이' })).toBe(true);
  });
  it('방금 누른 진짜 Enter·조합 밖·다른 글이 섞인 줄은 그대로 둔다(조합 중 Enter 로 새 줄, 안드로이드식 Enter)', () => {
    expect(fakeCompositionEnter({ ...base, sinceRealEnter: 30 })).toBe(false);
    expect(fakeCompositionEnter({ ...base, composing: false })).toBe(false);
    expect(fakeCompositionEnter({ ...base, blockText: '하나ㅇ' })).toBe(false);
    expect(fakeCompositionEnter({ ...base, composed: '' , blockText: '' })).toBe(false);
  });
  it('ProseMirror 가 아직 DOM 바뀜을 Enter 로 바꿔 친다 — 판이 바뀌어 없어졌으면 이 막이도 걷어 낸다', () => {
    expect(pmView).toMatch(/!inlineChange && looksLikeEnter\(parse\.doc, \$from\.pos, \$to\.pos\)\)\) &&\s*view\.someProp\("handleKeyDown", f => f\(view, keyEvent\(13, "Enter"\)\)\)/);
    expect(pmView).toMatch(/let event = document\.createEvent\("Event"\);\s*event\.initEvent\("keydown", true, true\)/); // 가짜는 KeyboardEvent 가 아니다
  });
  it('편집기에 걸려 있다', () => {
    expect(editor).toMatch(/extensions: \[ListKeys, NotionKeys, ImeListGuard\(\)\]/);
  });
});

// 목록 Enter 뒤 바로 Tab — 0.5초 안이면 ProseMirror 가 버려 커서가 편집기 밖으로(e2e/doc-ime 2번 장면)
describe('replayTab — 한글 확정 0.5초 안 Tab 은 대신 친다', () => {
  const t = { key: 'Tab', altKey: false, metaKey: false, ctrlKey: false, composing: false, hangul: true, sinceEnd: 120 };
  it('한글 확정 직후 Tab·Shift+Tab(shift 는 그대로 넘긴다)', () => { expect(replayTab(t)).toBe(true); });
  it('0.5초 뒤·조합 중·한글 아님·다른 키·⌘⌥⌃ 섞임은 손대지 않는다', () => {
    expect(replayTab({ ...t, sinceEnd: 600 })).toBe(false);
    expect(replayTab({ ...t, composing: true })).toBe(false);
    expect(replayTab({ ...t, hangul: false })).toBe(false);
    expect(replayTab({ ...t, key: 'a' })).toBe(false);
    expect(replayTab({ ...t, metaKey: true })).toBe(false);
    expect(replayTab({ ...t, altKey: true })).toBe(false);
    expect(replayTab({ ...t, ctrlKey: true })).toBe(false);
  });
  it('편집기 키 처리에 걸려 있다', () => { expect(wire).toMatch(/replayTab\(/); });
});
