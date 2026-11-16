// 윈도우 터미널 보기를 오간 뒤 한글이 두 번(공개 이슈 #13) — 입력기가 조합 없이 keypress 로 글자를 넘길 때
import { describe, expect, it } from 'vitest';
import { imeKeypressGuard } from './imeKeypress';

/** xterm 6 의 두 길을 흉내 낸다(CoreBrowserTerminal._keyPress · CompositionHelper._handleAnyTextareaChanges · _inputEvent).
 *  order: 'char-first' = 글자(keypress)가 0ms 타이머보다 먼저(보기 오간 뒤 윈도우 실측 대부분), 'timer-first' = 반대 */
function xterm(guard: ((e: { type: string; keyCode: number }) => boolean) | null) {
  let value = '';
  const sent: string[] = [];
  return {
    sent,
    /** 입력기가 먹은 키 하나(keydown 229) + 그 키에 확정된 글자(없으면 조합만 바뀜) */
    imeKey(char: string | null, order: 'char-first' | 'timer-first' = 'char-first') {
      guard?.({ type: 'keydown', keyCode: 229 });
      const old = value; // keydown 때 입력칸 글
      const timer = () => { if (value.length > old.length) sent.push(value.replace(old, '')); };
      const press = () => {
        if (char == null) return;
        const prevented = guard?.({ type: 'keypress', keyCode: char.charCodeAt(0) }) ?? false;
        sent.push(char); // xterm _keyPress 는 늘 보낸다(cancelEvents 기본 false 라 기본 동작은 안 막는다)
        if (!prevented) value += char; // 막지 않으면 웹뷰가 입력칸에 넣고 input(insertText) — keydown 을 본 뒤라 xterm 은 안 보냄
      };
      if (order === 'char-first') { press(); timer(); } else { timer(); press(); }
      guard?.({ type: 'keyup', keyCode: 229 });
    },
    /** 입력기를 안 거친 키(스페이스·영문) — keydown 229 가 아니고 keypress 로 한 번 */
    plainKey(char: string) {
      guard?.({ type: 'keydown', keyCode: char.toUpperCase().charCodeAt(0) });
      const prevented = guard?.({ type: 'keypress', keyCode: char.charCodeAt(0) }) ?? false;
      sent.push(char);
      if (!prevented) value += char;
      guard?.({ type: 'keyup', keyCode: char.toUpperCase().charCodeAt(0) });
    },
  };
}

/** '안녕 하세요' — 자모 키는 조합만(글자 없음), 다음 음절 첫 키에 앞 음절이 확정된다 */
function typeHello(t: ReturnType<typeof xterm>, order: 'char-first' | 'timer-first') {
  t.imeKey(null); t.imeKey(null); t.imeKey(null); t.imeKey('안', order);
  t.imeKey(null); t.imeKey('녕', order);
  t.plainKey(' ');
  t.imeKey(null); t.imeKey('하', order); t.imeKey(null); t.imeKey('세', order); t.imeKey('요', order);
}

describe('imeKeypressGuard — 229 keydown 뒤 keypress 는 입력칸에 안 넣는다', () => {
  it('막이 없으면 지금처럼 두 번(재현) — 글자가 타이머보다 먼저 올 때', () => {
    const t = xterm(null);
    t.imeKey('한');
    expect(t.sent).toEqual(['한', '한']);
  });

  it('막이를 걸면 한 번', () => {
    const t = xterm(imeKeypressGuard());
    t.imeKey('한');
    expect(t.sent).toEqual(['한']);
  });

  it('타이머가 먼저 돌아도(경쟁 반대) 빠지지 않고 한 번', () => {
    const t = xterm(imeKeypressGuard());
    t.imeKey('한', 'timer-first');
    expect(t.sent).toEqual(['한']);
    const u = xterm(null);
    u.imeKey('한', 'timer-first');
    expect(u.sent).toEqual(['한']); // 고치기 전에도 이 순서는 한 번 — 그래서 '가끔 한 번'이었다
  });

  it('문장 전체 — 두 경쟁 순서 모두 친 그대로', () => {
    for (const order of ['char-first', 'timer-first'] as const) {
      const t = xterm(imeKeypressGuard());
      typeHello(t, order);
      expect(t.sent.join('')).toBe('안녕 하세요');
    }
  });

  it('입력기를 안 거친 키(영문·스페이스)는 건드리지 않는다', () => {
    const g = imeKeypressGuard();
    expect(g({ type: 'keydown', keyCode: 65 })).toBe(false);
    expect(g({ type: 'keypress', keyCode: 97 })).toBe(false);
    expect(g({ type: 'keyup', keyCode: 65 })).toBe(false);
  });

  it('229 다음에 보통 키가 오면 막이가 풀린다', () => {
    const g = imeKeypressGuard();
    g({ type: 'keydown', keyCode: 229 });
    expect(g({ type: 'keypress', keyCode: 0xd55c })).toBe(true);
    g({ type: 'keydown', keyCode: 32 });
    expect(g({ type: 'keypress', keyCode: 32 })).toBe(false);
  });

  it('keydown·keyup 엔 막으라고 안 한다(키 자체는 xterm·조합 도우미 몫)', () => {
    const g = imeKeypressGuard();
    expect(g({ type: 'keydown', keyCode: 229 })).toBe(false);
    expect(g({ type: 'keyup', keyCode: 229 })).toBe(false);
  });

  it('한 키에 글자 둘(확정 + 기호)이 와도 둘 다 한 번씩', () => {
    const g = imeKeypressGuard();
    g({ type: 'keydown', keyCode: 229 });
    expect(g({ type: 'keypress', keyCode: 0xd55c })).toBe(true);
    expect(g({ type: 'keypress', keyCode: 46 })).toBe(true);
  });
});
