import { describe, expect, it } from 'vitest';
import { diffInput, hasNonAscii, normalizeInput, toSequence, yieldsToXterm, imeStep } from './imeBridge';

// 실측 이벤트 로그(2026-09-25, WKWebView 두벌식)에서 그대로 가져온 전후 쌍들
describe('diffInput — 입력기가 바꿔치기한 텍스트칸의 전후 차이', () => {
  it('첫 자모가 들어온다: "" → "ㅇ"', () => {
    expect(diffInput('', 'ㅇ')).toEqual({ del: 0, ins: 'ㅇ' });
  });

  it('자모가 글자로 바뀐다: "ㅇ" → "아" (한 글자 지우고 한 글자)', () => {
    expect(diffInput('ㅇ', '아')).toEqual({ del: 1, ins: '아' });
  });

  it('받침이 붙었다 떨어진다: "앙" → "아"', () => {
    expect(diffInput('앙', '아')).toEqual({ del: 1, ins: '아' });
  });

  it('앞 글자는 확정되고 새 글자가 붙는다: "아" → "아아"', () => {
    expect(diffInput('아', '아아')).toEqual({ del: 0, ins: '아' });
  });

  it('공통 앞부분은 건드리지 않는다: "안녕 하" → "안녕 하세"', () => {
    expect(diffInput('안녕 하', '안녕 하세')).toEqual({ del: 0, ins: '세' });
  });

  it('조합 중 백스페이스: "한" → "하"', () => {
    expect(diffInput('한', '하')).toEqual({ del: 1, ins: '하' });
  });

  it('전부 지워진다: "아" → ""', () => {
    expect(diffInput('아', '')).toEqual({ del: 1, ins: '' });
  });

  it('같으면 보낼 게 없다', () => {
    expect(diffInput('아아', '아아')).toEqual({ del: 0, ins: '' });
  });

  it('서로게이트 쌍(이모지)은 한 글자로 센다: "아😀" → "아"', () => {
    expect(diffInput('아😀', '아')).toEqual({ del: 1, ins: '' });
  });

  it('상위 서로게이트가 같은 이모지끼리 바뀌면 쌍 중간에서 끊지 않는다: "😀a" → "😁a"', () => {
    expect(diffInput('😀a', '😁a')).toEqual({ del: 2, ins: '😁a' });
  });
});

describe('normalizeInput — 웹뷰가 끝 공백을 NBSP로 넣는다', () => {
  it('NBSP를 일반 공백으로', () => {
    expect(normalizeInput('아 ')).toBe('아 ');
  });

  it('여러 개도 전부', () => {
    expect(normalizeInput(' a ')).toBe(' a ');
  });
});

describe('hasNonAscii — 한글이 섞였을 때만 다리가 나선다', () => {
  it('한글', () => expect(hasNonAscii('아')).toBe(true));
  it('영문·숫자·공백', () => expect(hasNonAscii('hello 123')).toBe(false));
  it('빈 문자열', () => expect(hasNonAscii('')).toBe(false));
});

describe('toSequence — 지운 만큼 DEL, 새 글자는 그대로', () => {
  it('DEL 두 번 + 글자', () => {
    expect(toSequence({ del: 2, ins: '아' })).toBe('\x7f\x7f아');
  });

  it('지울 것 없이 글자만', () => {
    expect(toSequence({ del: 0, ins: '세요' })).toBe('세요');
  });

  it('아무것도 없으면 빈 문자열', () => {
    expect(toSequence({ del: 0, ins: '' })).toBe('');
  });
});

describe('yieldsToXterm — 이 keydown 뒤의 입력은 xterm 몫인가 (조합을 끊어도 되나)', () => {
  it('입력기 조합 중(keyCode 229)은 다리 몫', () => {
    expect(yieldsToXterm({ key: 'ㅆ', keyCode: 229 })).toBe(false);
  });

  // 실사용 버그(2026-09-26): "있"을 치려고 Shift를 누르는 순간 조합이 끊겨 "이ㅆ"가 됐다
  it.each(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])('수식키 %s 단독은 조합을 끊지 않는다', (key) => {
    expect(yieldsToXterm({ key, keyCode: 16 })).toBe(false);
  });

  it('입력기 전환 키(한/영)도 끊지 않는다', () => {
    expect(yieldsToXterm({ key: 'Lang1', keyCode: 0 })).toBe(false);
    expect(yieldsToXterm({ key: 'Process', keyCode: 229 })).toBe(false);
  });

  it('스페이스·Enter·영문·Backspace는 xterm 몫', () => {
    expect(yieldsToXterm({ key: ' ', keyCode: 32 })).toBe(true);
    expect(yieldsToXterm({ key: 'Enter', keyCode: 13 })).toBe(true);
    expect(yieldsToXterm({ key: 'a', keyCode: 65 })).toBe(true);
    expect(yieldsToXterm({ key: 'Backspace', keyCode: 8 })).toBe(true);
  });
});

// 2026-09-28 실측(ime-debug.jsonl): 웹뷰가 조합 이벤트를 보내기 시작했고, 한글 입력기가 스페이스까지 조합으로 보낸다.
// 글자가 확정될 때마다 deleteCompositionText(칸을 비움) → insertFromComposition(도로 넣음) 이 온다
describe('imeStep — 입력 이벤트 하나를 pty 로 보낼 것으로', () => {
  const DEL = '\x7f';
  const run = (events: [string, string, string][]) => {
    let held: string | null = null;
    const out: (string | null)[] = [];
    for (const [it, prev, now] of events) {
      const r = imeStep(it, prev, now, held);
      held = r.held;
      out.push(r.send);
    }
    return out;
  };

  it('조합 중 글자는 바꿔치기 차이로', () => {
    expect(run([['insertCompositionText', '', 'ㅅ'], ['insertCompositionText', 'ㅅ', '사']])).toEqual(['ㅅ', DEL + '사']);
  });

  it('확정 때 지웠다 도로 넣는 건 아무것도 안 보낸다', () => {
    expect(run([['insertCompositionText', '사', '사 '], ['deleteCompositionText', '사 ', ''], ['insertFromComposition', '', '사 ']]))
      .toEqual([' ', '', '']);
  });

  it('조합으로 온 스페이스는 한글이 없어도 보낸다 ("?" 뒤 띄어쓰기가 사라지던 것)', () => {
    expect(run([['insertCompositionText', '', ' '], ['deleteCompositionText', ' ', ''], ['insertFromComposition', '', ' ']]))
      .toEqual([' ', '', '']);
  });

  it('스페이스를 누르고 있으면 한 번에 하나씩 이어서 (음성 입력 스페이스 누르기)', () => {
    const one: [string, string, string][] = [['insertCompositionText', '', ' '], ['deleteCompositionText', ' ', ''], ['insertFromComposition', '', ' ']];
    const sent = run([...one, ...one, ...one]).filter((s) => s);
    expect(sent).toEqual([' ', ' ', ' ']);
  });

  it('확정하면서 받침이 다음 글자로 넘어가면 그 차이만', () => {
    // 글 + ㅐ → 그 + 래
    expect(run([['insertCompositionText', '글', '그'], ['deleteCompositionText', '그', ''], ['insertFromComposition', '', '그']]))
      .toEqual([DEL + '그', '', '']);
  });

  it('조합이 아닌 영문·스페이스는 xterm 몫 (null)', () => {
    expect(run([['insertText', '', 'a'], ['insertText', '', ' ']])).toEqual([null, null]);
  });

  it('조합 이벤트가 없던 웹뷰(insertText·insertReplacementText)의 한글은 예전처럼', () => {
    expect(run([['insertText', '', 'ㅇ'], ['insertReplacementText', 'ㅇ', '아']])).toEqual(['ㅇ', DEL + '아']);
  });
});
