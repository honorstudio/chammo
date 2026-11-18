// 패드 + 하드웨어 키보드 — 맥 앱과 같은 ⌘ 키(domain/shortcuts 의 패드에 맞는 것만). 한글 자판이어도 되게 키 자리(code)로 읽는다
import { describe, expect, it } from 'vitest';
import { enterSendsNow, padKey } from './padKeys';

const k = (code: string, o: { meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean; key?: string } = {}) =>
  ({ code, key: o.key ?? code.replace(/^Key|^Digit/, '').toLowerCase(), metaKey: !!o.meta, shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl });

describe('padKey — 맥과 같은 ⌘ 키', () => {
  it('⌘1~9 = 띠 순서 참모', () => {
    expect(padKey(k('Digit1', { meta: true }))).toEqual({ type: 'orch', n: 1 });
    expect(padKey(k('Digit9', { meta: true }))).toEqual({ type: 'orch', n: 9 });
  });
  it('⌘⇧M 메모 · ⌘⇧H 참모 홈 · ⌘⇧L 보관함 — 한글 자판(ㅡ·ㅗ·ㅣ)이어도', () => {
    expect(padKey(k('KeyM', { meta: true, shift: true, key: 'ㅡ' }))).toEqual({ type: 'notes' });
    expect(padKey(k('KeyH', { meta: true, shift: true, key: 'ㅗ' }))).toEqual({ type: 'dash', tab: 'home' });
    expect(padKey(k('KeyL', { meta: true, shift: true, key: 'ㅣ' }))).toEqual({ type: 'dash', tab: 'locker' });
  });
  it('⌘ 없이·다른 수정키가 섞이면 아무것도 아니다 — 입력칸 글자·시스템 키를 안 뺏는다', () => {
    expect(padKey(k('Digit1'))).toBeNull();
    expect(padKey(k('Digit1', { meta: true, alt: true }))).toBeNull();
    expect(padKey(k('Digit1', { meta: true, ctrl: true }))).toBeNull();
    expect(padKey(k('KeyM', { meta: true }))).toBeNull(); // ⇧ 없는 ⌘M 은 안 씀
    expect(padKey(k('Digit0', { meta: true }))).toBeNull();
    expect(padKey(k('KeyC', { meta: true }))).toBeNull(); // 복사
  });
});

describe('enterSendsNow — Enter 보내기 · ⇧Enter 줄바꿈', () => {
  const e = (o: { shift?: boolean; composing?: boolean; keyCode?: number; meta?: boolean } = {}) =>
    ({ key: 'Enter', shiftKey: !!o.shift, altKey: false, ctrlKey: false, metaKey: !!o.meta, keyCode: o.keyCode ?? 13, nativeEvent: { isComposing: !!o.composing } });
  it('Enter 는 보낸다', () => expect(enterSendsNow(e())).toBe(true));
  it('⇧Enter 는 줄바꿈', () => expect(enterSendsNow(e({ shift: true }))).toBe(false));
  it('한글 조합 확정 중 Enter 는 안 보낸다(isComposing·229)', () => {
    expect(enterSendsNow(e({ composing: true }))).toBe(false);
    expect(enterSendsNow(e({ keyCode: 229 }))).toBe(false);
  });
  it('다른 키는 아니다', () => expect(enterSendsNow({ ...e(), key: 'a' })).toBe(false));
});
