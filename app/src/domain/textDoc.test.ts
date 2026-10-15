import { describe, expect, it } from 'vitest';
import { joinEol, outsideStep, splitEol } from './textDoc';

describe('글 파일 편집 — 바깥이 고쳤을 때 (md 편집기와 같은 길: 모르는 판은 덮지 않는다)', () => {
  it('바깥 판이 내가 아는 판과 같으면 할 일 없음', () => {
    expect(outsideStep('가', '가나', '가')).toBe('same');
  });
  it('내가 안 고쳤으면 바깥 판을 그대로 받는다', () => {
    expect(outsideStep('가', '가', '가나')).toBe('take');
  });
  it('내가 고친 것과 바깥 판이 같아졌으면 기준만 맞춘다', () => {
    expect(outsideStep('가', '가나', '가나')).toBe('adopt');
  });
  it('둘 다 다르게 고쳤으면 충돌 — 저장을 멈추고 고르게', () => {
    expect(outsideStep('가', '가나', '가다')).toBe('conflict');
  });
  it('줄바꿈만 다른 판도 다른 판이다', () => {
    expect(outsideStep('a\nb', 'a\nb', 'a\r\nb')).toBe('take');
  });
});

describe('줄바꿈 — 윈도우식(CRLF) 글 파일을 열어 한 글자 고쳐도 파일 전체가 LF 로 바뀌지 않는다', () => {
  it('CRLF 글은 편집칸엔 LF 로 보이고 저장할 땐 CRLF 로 되돌린다', () => {
    const e = splitEol('가\r\n나\r\n');
    expect(e.text).toBe('가\n나\n');
    expect(joinEol('가\n나 고침\n', e.crlf)).toBe('가\r\n나 고침\r\n');
  });
  it('LF 글·섞인 글은 그대로 둔다', () => {
    expect(splitEol('가\n나')).toEqual({ text: '가\n나', crlf: false });
    expect(joinEol('가\n나', false)).toBe('가\n나');
    expect(splitEol('한 줄')).toEqual({ text: '한 줄', crlf: false });
  });
});
