import { describe, expect, it } from 'vitest';
import { fwd, samePath } from './paths';

describe('윈도우 경로를 한 모양으로 — 앱은 C:\\Users\\me/.chammo/hq, claude agents 는 C:\\Users\\me\\.chammo\\hq 라 참모 세션을 못 알아봤다(윈도우 5단계)', () => {
  it('역슬래시를 / 로, 드라이브 글자는 대문자로', () => {
    expect(fwd('C:\\Users\\me/.chammo/hq')).toBe('C:/Users/me/.chammo/hq');
    expect(fwd('C:\\Users\\me\\.chammo\\hq')).toBe('C:/Users/me/.chammo/hq');
    expect(fwd('c:\\dev')).toBe('C:/dev');
  });
  it('맥 경로는 그대로', () => {
    expect(fwd('/Users/a/dev')).toBe('/Users/a/dev');
    expect(fwd('/Users/a/odd\\name')).toBe('/Users/a/odd\\name');
    expect(fwd('')).toBe('');
  });
});

describe('samePath — 경로 같은가(윈도우 폰 "떠 있는 참모가 없어요": /api/env hqDir 이 C:\\Users\\Me/.chammo/hq 로 섞여 와 agents cwd C:/Users/Me/.chammo/hq 와 안 맞았다, 2026-10-05)', () => {
  it('윈도우: 섞인 구분자·끝 / ·대소문자가 달라도 같은 폴더', () => {
    expect(samePath('C:\\Users\\Me/.chammo/hq', 'C:/Users/Me/.chammo/hq')).toBe(true);
    expect(samePath('C:\\Users\\Me\\.chammo\\hq\\', 'C:/Users/Me/.chammo/hq')).toBe(true);
    expect(samePath('c:/users/me/.chammo/HQ', 'C:\\Users\\Me/.chammo/hq')).toBe(true);
    expect(samePath('C:/Users/Me/.chammo/hq2', 'C:/Users/Me/.chammo/hq')).toBe(false);
    expect(samePath('D:/Users/Me/.chammo/hq', 'C:/Users/Me/.chammo/hq')).toBe(false);
  });
  it('맥: 끝 / 만 무시하고 대소문자는 그대로(지금 동작 유지)', () => {
    expect(samePath('/Users/a/hq/', '/Users/a/hq')).toBe(true);
    expect(samePath('/Users/a/HQ', '/Users/a/hq')).toBe(false);
    expect(samePath('/Users/a/odd\\name', '/Users/a/odd/name')).toBe(false);
  });
  it('빈 값끼리는 지금처럼 같다(설정 전 HQ 빈 문자열) · 한쪽만 비면 다르다', () => {
    expect(samePath('', '')).toBe(true);
    expect(samePath('', '/Users/a/hq')).toBe(false);
  });
});
