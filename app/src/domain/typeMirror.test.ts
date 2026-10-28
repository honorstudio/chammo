import { describe, expect, it } from 'vitest';
import type { InputEv } from './agentInput';
import { TypeMirror } from './typeMirror';

/** 페이지 입력칸 흉내 — 받은 입력으로 글을 만든다(조합 중 글자는 따로, insertText 가 조합을 바꿔 넣는다 = 크롬 ImeCommitText) */
function page() {
  let text = '';
  let comp = '';
  return {
    apply(evs: InputEv[]) {
      for (const e of evs) {
        if (e.kind === 'compose') comp = e.text;
        else if (e.kind === 'text') { text += e.text; comp = ''; }
        else if (e.kind === 'key' && e.key === 'Backspace' && e.type === 'rawKeyDown') {
          if (comp) comp = ''; else text = [...text].slice(0, -1).join('');
        } else if (e.kind === 'key' && e.key === 'Enter' && e.type === 'rawKeyDown') text += '⏎';
      }
    },
    get value() { return text + comp; },
    get committed() { return text; },
  };
}

describe('칸 글칸 → 페이지(차이만 보낸다)', () => {
  it('조합형 입력기(조합 사건) — 조합 중 글자는 미리 보이고, 끝나면 한 번만', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.compose('ㅇ'));
    expect(p.value).toBe('ㅇ');
    p.apply(m.compose('유'));
    p.apply(m.input('유', true)); // 조합 중 input 은 기다린다
    p.apply(m.end('유'));
    p.apply(m.compose('ㅌ'));
    p.apply(m.compose('튜'));
    p.apply(m.end('유튜'));
    p.apply(m.compose('ㅂ'));
    p.apply(m.compose('브'));
    expect(p.value).toBe('유튜브');
    expect(p.committed).toBe('유튜');
    p.apply(m.end('유튜브'));
    expect(p.value).toBe('유튜브');
  });

  it('WebKit — 조합을 끝내는 Enter 뒤 글칸에 글이 되살아나도(input isComposing=false) 두 번 안 간다(10-28 사용자 "유튜브브")', () => {
    const m = new TypeMirror();
    const p = page();
    for (const [c, v] of [['유', '유'], ['튜', '유튜'], ['브', '유튜브']] as const) { p.apply(m.compose(c)); p.apply(m.end(v)); }
    p.apply(m.input('유튜브', false)); // 되살아난 글
    p.apply(m.enter(229, '유튜브'));
    expect(p.value).toBe('유튜브⏎');
  });

  it('조합 끝(compositionend)에 글칸이 아직 안 바뀌었으면 뒤따르는 input 이 넣는다', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.compose('가'));
    p.apply(m.end('')); // WebKit 이 아직 안 넣음
    expect(p.value).toBe(''); // 조합은 지웠다
    p.apply(m.input('가', false));
    expect(p.value).toBe('가');
  });

  it('macOS 26 기본 입력기(바꿔치기, 조합 사건 없음) — 앞 글자를 바꿔 넣어도 페이지가 같다', () => {
    const m = new TypeMirror();
    const p = page();
    for (const v of ['ㅇ', '유', '유ㅌ', '유튜', '유튜ㅂ', '유튜브']) p.apply(m.input(v, false));
    expect(p.value).toBe('유튜브');
  });

  it('지우기 — 글칸에 글이 있으면 글칸이 지우고 차이로 간다, 비었으면 키로', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.input('abc', false));
    expect(m.nativeBackspace('abc')).toBe(true);
    p.apply(m.input('ab', false));
    expect(p.value).toBe('ab');
    expect(m.nativeBackspace('')).toBe(false);
  });

  it('섞어 치기·빠르게 치기 — 영문과 한글, 붙여 넣은 여러 글자', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.input('hi ', false));
    p.apply(m.compose('하'));
    p.apply(m.end('hi 하'));
    p.apply(m.input('hi 하이123', false));
    expect(p.value).toBe('hi 하이123');
  });

  it('Enter·화살표 같은 키 뒤엔 새로 시작 — 글칸을 비워도 된다(영문 Enter)', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.input('abc', false));
    p.apply(m.enter(13, 'abc'));
    m.reset();
    p.apply(m.input('d', false));
    expect(p.value).toBe('abc⏎d');
  });

  it('조합 중에 Enter(229, 조합 아직 안 끝남 표시) — 마지막 글자가 Enter 앞에', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.compose('브'));
    // compositionend 가 아직 안 왔는데 글칸엔 들어가 있다
    p.apply(m.enter(229, '브'));
    expect(p.value).toBe('브⏎');
  });

  it('칸을 눌러 조합이 끊기면 그 글자는 페이지가 이미 가졌다 — 다시 안 넣는다', () => {
    const m = new TypeMirror();
    const p = page();
    p.apply(m.compose('브'));
    m.clicked();
    expect(m.end('브')).toEqual([]);
    p.apply(m.input('브', false));
    expect(p.value).toBe('브');
  });
});
