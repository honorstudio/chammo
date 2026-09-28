import { describe, expect, it } from 'vitest';
import { formatEntry, memoTime, parseMemo, pasteSequence, removeEntry, serializeMemo, validMemoName } from './memo';

// 형식은 iTerm 의 HOLO MEMO(~/.config/holo/memo.py)와 같다 — 둘이 같은 파일을 번갈아 쓴다
describe('parseMemo — HOLO MEMO 파일 읽기', () => {
  it('빈 파일·제목만 있으면 없음', () => {
    expect(parseMemo('')).toEqual([]);
    expect(parseMemo('# HOLO MEMO\n\n')).toEqual([]);
  });
  it('- [시각] 내용 한 줄씩', () => {
    expect(parseMemo('# HOLO MEMO\n\n- [01:10] 흐름 큐레이션중\n- [01:23] 보냄\n')).toEqual([
      { ts: '01:10', text: '흐름 큐레이션중' },
      { ts: '01:23', text: '보냄' },
    ]);
  });
  it('두 칸 들여쓴 줄은 앞 항목의 다음 줄 (두 칸만 벗긴다)', () => {
    expect(parseMemo('- [00:58] 첫 줄\n    둘째 줄\n  \n  셋째\n')).toEqual([{ ts: '00:58', text: '첫 줄\n  둘째 줄\n\n셋째' }]);
  });
  it('형식 밖의 줄은 시각 없는 항목', () => {
    expect(parseMemo('그냥 적은 줄\n')).toEqual([{ ts: '', text: '그냥 적은 줄' }]);
  });
});

describe('formatEntry — 파일 끝에 붙일 한 항목', () => {
  it('한 줄', () => expect(formatEntry('14:22', '점이 안보임.')).toBe('- [14:22] 점이 안보임.\n'));
  it('여러 줄은 둘째 줄부터 두 칸 들여쓰기', () => expect(formatEntry('02:21', '점검할거고\n편의성도')).toBe('- [02:21] 점검할거고\n  편의성도\n'));
  it('다시 읽으면 같은 글', () => {
    const text = '첫 줄\n  들여쓴 둘째\n\n넷째';
    expect(parseMemo(formatEntry('09:00', text))).toEqual([{ ts: '09:00', text }]);
  });
});

describe('memoTime — memo.py 처럼 시:분', () => {
  it('두 자리로', () => expect(memoTime(new Date(2026, 8, 27, 9, 5))).toBe('09:05'));
});

describe('pasteSequence — 세션 입력칸에 붙여넣기로 넣는다(Enter 는 안 누름)', () => {
  it('괄호 붙여넣기로 감싸고 줄바꿈은 CR', () => expect(pasteSequence('가\n나')).toBe('\x1b[200~가\r나\x1b[201~'));
});

describe('validMemoName — 파일 이름으로 쓸 수 있는 프로젝트 이름만', () => {
  it('보통 이름', () => expect(validMemoName('acme-shop-platform')).toBe(true));
  it('경로·빈 이름 막음', () => {
    expect(validMemoName('')).toBe(false);
    expect(validMemoName('../x')).toBe(false);
    expect(validMemoName('a/b')).toBe(false);
  });
});

describe('serializeMemo — 파일 통째로 (memo.py save 와 같은 모양)', () => {
  it('제목 + 항목들', () =>
    expect(serializeMemo([{ ts: '01:10', text: '가' }, { ts: '02:00', text: '나\n다' }])).toBe('# HOLO MEMO\n\n- [01:10] 가\n- [02:00] 나\n  다\n'));
  it('다시 읽으면 같은 항목', () => {
    const items = [{ ts: '01:10', text: '가\n  들여씀' }, { ts: '02:00', text: '나' }];
    expect(parseMemo(serializeMemo(items))).toEqual(items);
  });
});

describe('removeEntry — 지울 항목을 시각·글로 찾아 뺀다(그사이 iTerm 에서 줄이 늘어도 엉뚱한 걸 안 지우게)', () => {
  const a = { ts: '01:10', text: '가' };
  const b = { ts: '02:00', text: '나' };
  const c = { ts: '03:00', text: '다' };
  it('맞는 것 하나만', () => expect(removeEntry([a, b, c], b)).toEqual([a, c]));
  it('앞에 새 줄이 끼어 있어도 같은 항목', () => expect(removeEntry([{ ts: '00:01', text: '새' }, a, b], a)).toEqual([{ ts: '00:01', text: '새' }, b]));
  it('같은 게 둘이면 마지막 것 하나만', () => expect(removeEntry([a, b, a], a)).toEqual([a, b]));
  it('없으면 null(이미 지워짐)', () => expect(removeEntry([a], b)).toBeNull());
});
