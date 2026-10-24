// 폰 음성 모드 소리가 듣던 음악·영상을 멈췄다(2026-10-23 사용자) — 말하는 동안만 다른 소리를 잠깐 줄이고(transient), 끝나면 원래대로
import { describe, expect, it } from 'vitest';
import { makeDuck } from './audioDuck';

const sess = (type = 'auto') => ({ type });

describe('makeDuck — navigator.audioSession.type 을 말하는 동안만 바꾸고 되돌린다', () => {
  it('말하기 시작 → transient, 끝 → 원래 값', () => {
    const s = sess();
    const d = makeDuck(() => s);
    d.begin('transient');
    expect(s.type).toBe('transient');
    d.end();
    expect(s.type).toBe('auto');
  });
  it('끝을 두 번 불러도·시작 없이 불러도 원래 값 그대로', () => {
    const s = sess('playback');
    const d = makeDuck(() => s);
    d.end();
    expect(s.type).toBe('playback');
    d.begin('transient');
    d.end();
    d.end();
    expect(s.type).toBe('playback');
  });
  it('끝나기 전에 다음 소리가 시작돼도 되돌릴 값은 처음 값(transient 를 원래 값으로 굳히지 않는다)', () => {
    const s = sess();
    const d = makeDuck(() => s);
    d.begin('ambient');
    d.begin('transient');
    expect(s.type).toBe('transient');
    d.end();
    expect(s.type).toBe('auto');
  });
  it('앞 소리(무음 풀기)의 늦은 끝은 뒤에 시작한 말을 되돌리지 않는다', () => {
    const s = sess();
    const d = makeDuck(() => s);
    const unlock = d.begin('ambient');
    const speak = d.begin('transient');
    d.end(unlock);
    expect(s.type).toBe('transient');
    d.end(speak);
    expect(s.type).toBe('auto');
  });
  it('audioSession 이 없는 브라우저는 아무것도 안 한다(던지지도 않는다)', () => {
    const d = makeDuck(() => undefined);
    expect(() => { d.begin('transient'); d.end(); }).not.toThrow();
  });
  it('type 을 못 바꾸는 브라우저(던짐)도 소리 틀기를 막지 않는다', () => {
    const s = { get type() { return 'auto'; }, set type(_v: string) { throw new Error('NotSupported'); } };
    const d = makeDuck(() => s);
    expect(() => { d.begin('transient'); d.end(); }).not.toThrow();
  });
});
