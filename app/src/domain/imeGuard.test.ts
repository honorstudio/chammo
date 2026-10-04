import { describe, expect, it } from 'vitest';
import { keyKind, nextComposing, seqShape, shouldCommit, traceOf } from './imeGuard';

const kd = (key: string, keyCode: number) => ({ type: 'keydown', key, keyCode });

describe('nextComposing — 한글을 치던 중(조합 중일 수 있음)인가', () => {
  it('입력기 키(229)를 누르면 조합 중', () => expect(nextComposing(false, kd('ㄱ', 229))).toBe(true));
  it('조합 이벤트 — 시작·갱신은 조합 중, 끝은 아님', () => {
    expect(nextComposing(false, { type: 'compositionstart' })).toBe(true);
    expect(nextComposing(false, { type: 'compositionupdate' })).toBe(true);
    expect(nextComposing(true, { type: 'compositionend' })).toBe(false);
  });
  it('입력기를 안 거친 키(스페이스·영문·Enter·방향키)는 조합을 끝낸다', () => {
    expect(nextComposing(true, kd(' ', 32))).toBe(false);
    expect(nextComposing(true, kd('a', 65))).toBe(false);
    expect(nextComposing(true, kd('Enter', 13))).toBe(false);
    expect(nextComposing(true, kd('ArrowLeft', 37))).toBe(false);
  });
  it('수식키(Cmd+Tab 의 Cmd·Shift)는 그대로 — 조합 중에 Cmd+Tab 으로 나가는 게 이 버그', () => {
    expect(nextComposing(true, kd('Meta', 91))).toBe(true);
    expect(nextComposing(true, kd('Shift', 16))).toBe(true);
    expect(nextComposing(false, kd('Meta', 91))).toBe(false);
  });
  it('칸을 옮기거나 마우스로 누르면 끝', () => {
    expect(nextComposing(true, { type: 'focusin' })).toBe(false);
    expect(nextComposing(true, { type: 'focusout' })).toBe(false);
    expect(nextComposing(true, { type: 'mousedown' })).toBe(false);
  });
  it('다른 이벤트는 그대로', () => {
    expect(nextComposing(true, { type: 'input' })).toBe(true);
    expect(nextComposing(false, { type: 'beforeinput' })).toBe(false);
  });
});

describe('shouldCommit — 창이 초점을 잃을 때 칸을 다시 잡아 조합을 확정할까', () => {
  it('조합 중 + 입력칸·글상자·문서 편집기면 한다', () => {
    expect(shouldCommit(true, 'textarea')).toBe(true);
    expect(shouldCommit(true, 'input')).toBe(true);
    expect(shouldCommit(true, 'editor')).toBe(true);
  });
  it('터미널은 안 건드린다(한글 다리가 따로 맡는다)', () => expect(shouldCommit(true, 'xterm')).toBe(false));
  it('조합 중이 아니거나 글칸이 아니면 안 한다', () => {
    expect(shouldCommit(false, 'textarea')).toBe(false);
    expect(shouldCommit(true, 'other')).toBe(false);
  });
});

describe('keyKind·traceOf — 진단 기록엔 글자 내용을 안 남긴다(종류·길이만)', () => {
  it('글자 키는 char 로만', () => {
    expect(keyKind('ㄱ', 229)).toBe('ime');
    expect(keyKind('a', 65)).toBe('char');
    expect(keyKind('가', 0)).toBe('char');
    expect(keyKind('ArrowLeft', 37)).toBe('nav');
    expect(keyKind('Meta', 91)).toBe('mod');
    expect(keyKind('Enter', 13)).toBe('enter');
    expect(keyKind('Backspace', 8)).toBe('backspace');
  });
  it('기록 한 줄 — 글자·값은 길이만', () => {
    const t = traceOf({ type: 'beforeinput', inputType: 'insertReplacementText', data: '비밀', isComposing: false }, 'textarea', 5);
    expect(t).toEqual({ type: 'beforeinput', field: 'textarea', comp: false, it: 'insertReplacementText', dl: 2, vl: 5 });
    expect(JSON.stringify(t)).not.toContain('비밀');
    const k = traceOf({ type: 'keydown', key: 'ㅂ', keyCode: 229, isComposing: true }, 'editor', 0);
    expect(k).toEqual({ type: 'keydown', field: 'editor', comp: true, kk: 'ime', vl: 0 });
    expect(JSON.stringify(k)).not.toContain('ㅂ');
  });
});

describe('seqShape — 터미널로 보낸 글은 모양만(종류·개수) 남긴다, 친 글자는 X', () => {
  it('글자는 종류×개수 — 영문·숫자·기호는 a, 한글(자모 포함)은 한, 그 밖은 u', () => {
    expect(seqShape('P@ss1')).toBe('a×5');
    expect(seqShape('가나')).toBe('한×2');
    expect(seqShape('ㄱ')).toBe('한');
    expect(seqShape('😀')).toBe('u');
    expect(seqShape('a b')).toBe('a sp a');
  });
  it('지우기·제어 문자는 이름으로', () => {
    expect(seqShape('\x7f\x7f가')).toBe('DEL×2 한');
    expect(seqShape('\r')).toBe('CR');
    expect(seqShape('\n\t')).toBe('LF TAB');
    expect(seqShape('\x03')).toBe('^C');
  });
  it('이스케이프 시퀀스는 종류만(방향키·붙여넣기 괄호), Alt+글자는 글자를 숨긴다', () => {
    expect(seqShape('\x1b[A')).toBe('ESC[A');
    expect(seqShape('\x1b[200~비밀번호\x1b[201~')).toBe('ESC[200~ 한×4 ESC[201~');
    expect(seqShape('\x1bb')).toBe('ESC+');
    expect(seqShape('\x1b')).toBe('ESC');
  });
  it('빈 글', () => expect(seqShape('')).toBe(''));
  it('결과에 친 글자가 안 남는다', () => {
    for (const s of ['hunter2', '비밀번호123', '\x1b[200~secret\x1b[201~']) expect(seqShape(s)).not.toMatch(/hunter|비밀|secret/);
  });
});

describe('traceOf — 터미널 키 이벤트도 같은 모양(글자 없이)', () => {
  it('xterm 칸 — 키 종류·data 길이·텍스트칸 길이만', () => {
    const t = traceOf({ type: 'input', key: undefined, inputType: 'insertReplacementText', data: '앙', isComposing: false }, 'xterm', 1);
    expect(t).toEqual({ type: 'input', field: 'xterm', comp: false, it: 'insertReplacementText', dl: 1, vl: 1 });
  });
});
