import { describe, expect, it } from 'vitest';
import reader from '../../src-tauri/src/reader.rs?raw';

// 2026-10-22 사용자 제보(윈도우 Ctrl +/-) — html 탭(iframe)에 포커스가 있으면 키가 앱에 안 온다. hodoc 이 심는 다리 줄이
// 확대 셋(Ctrl/⌘ + = - 0, 숫자패드 포함)만 부모에게 넘기고 나머지(설정·탭 이동 등)는 절대 안 넘기는지 진짜로 돌려 본다
const js = (() => {
  const m = /const ESC_BRIDGE: &str = "<script>([\s\S]*?)<\/script>";/.exec(reader);
  if (!m) throw new Error('ESC_BRIDGE 를 못 찾음');
  return m[1]!;
})();

function bridge(inFrame = true) {
  const keys: ((e: unknown) => void)[] = [];
  const posts: unknown[] = [];
  const parent = { postMessage: (d: unknown) => posts.push(d) };
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') keys.push(f); } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('addEventListener', 'parent', 'window', 'document', js)(self.addEventListener, inFrame ? parent : self, self, {});
  const press = (key: string, code: string, m: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) => {
    let prevented = false;
    const e = { key, code, ctrlKey: !!m.ctrl, metaKey: !!m.meta, altKey: !!m.alt, shiftKey: !!m.shift, preventDefault: () => { prevented = true; } };
    keys.forEach((f) => f(e));
    return prevented;
  };
  return { press, posts };
}

describe('hodoc 다리 — iframe 안 확대 키만 부모에게', () => {
  it('Ctrl/⌘ + = - 0 · Ctrl+Shift+= · 숫자패드', () => {
    const b = bridge();
    expect(b.press('=', 'Equal', { ctrl: true })).toBe(true);
    b.press('+', 'Equal', { ctrl: true, shift: true });
    b.press('-', 'Minus', { meta: true });
    b.press('0', 'Digit0', { ctrl: true });
    b.press('+', 'NumpadAdd', { ctrl: true });
    b.press('-', 'NumpadSubtract', { ctrl: true });
    expect(b.posts).toEqual([1, 1, -1, 0, 1, -1].map((c) => ({ hodoc: 'zoom', c })));
  });
  it('다른 단축키·Alt 섞임·그냥 글자는 안 넘긴다(남의 html 이 앱 단축키를 못 흉내 내게)', () => {
    const b = bridge();
    expect(b.press(',', 'Comma', { ctrl: true })).toBe(false);
    b.press('w', 'KeyW', { ctrl: true, shift: true });
    b.press('=', 'Equal', { ctrl: true, alt: true });
    b.press('=', 'Equal');
    b.press('1', 'Digit1', { ctrl: true });
    expect(b.posts).toEqual([]);
  });
  it('Esc 다리는 그대로, 맨 창(iframe 아님)이면 아무것도 안 넘긴다', () => {
    const b = bridge();
    b.press('Escape', 'Escape');
    expect(b.posts).toEqual([{ hodoc: 'esc' }]);
    const top = bridge(false);
    top.press('=', 'Equal', { ctrl: true });
    top.press('Escape', 'Escape');
    expect(top.posts).toEqual([]);
  });
});
