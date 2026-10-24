// 폰 팀 시트 — 초대 링크·팀 만들기가 실패하면 영어 오류 원문('Error: not found')이 화면 글로 떴다(2026-10-24 폰 QA 2차).
// 화면엔 한국어 한 줄, 원문은 이름표(title)로 — PDF 를 못 열 때와 같은 규칙(reader/pdfErrText)
import { describe, expect, it } from 'vitest';
import src from './PhoneTeam.tsx?raw';
import convo from '../team/TeamConvo.tsx?raw';

describe('폰 팀 오류 문구', () => {
  it('오류 원문을 그대로 화면 글로 안 쓴다', () => expect(src).not.toMatch(/setErr\(String\(e\)\)/));
  it('초대 링크·팀 만들기 실패는 한국어 한 줄', () => {
    expect(src).toContain('초대 링크를 못 만들었어요');
    expect(src).toContain('팀을 못 만들었어요');
  });
  it('원문은 이름표(title)로 남긴다', () => expect(src).toMatch(/role="alert" title=\{err\.raw\}>\{err\.msg\}/));
  it('일 넘기기 실패도 무엇이 안 됐는지 앞에 한 줄(보내기 실패와 같은 모양)', () => {
    expect(convo).not.toMatch(/\(e: unknown\) => setErr\(String\(e\)\)/);
    expect(convo).toMatch(/못 넘겼어요 — \$\{String\(e\)\}/);
  });
});
