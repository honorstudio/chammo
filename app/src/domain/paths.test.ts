import { describe, expect, it } from 'vitest';
import { docRel, fwd, samePath } from './paths';
import fixture from './paths.fixture.json';

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

describe('경로 같은가 판단은 한 벌 — 공용 표(paths.fixture.json, Rust platform::same_dir 도 같은 표)', () => {
  it.each(fixture.cases as [string, string, boolean][])('%s ~ %s → %s', (a, b, same) => {
    expect(samePath(a, b)).toBe(same);
    expect(samePath(b, a)).toBe(same);
  });
});

describe('docRel — 문서 속 상대 링크를 문서 폴더 기준 절대 경로로', () => {
  it('맥 경로', () => {
    expect(docRel('/Users/me/dev/a/docs', 'img/x.png')).toBe('/Users/me/dev/a/docs/img/x.png');
    expect(docRel('/Users/me/dev/a/docs', '../README.md')).toBe('/Users/me/dev/a/README.md');
    expect(docRel('/Users/me/dev/a/docs', '/abs/y.md')).toBe('/abs/y.md');
  });
  it('윈도우 경로 — 역슬래시여도, 앞에 / 를 붙이지 않는다(2026-11-01 win-text M2)', () => {
    expect(docRel('C:/Users/me/dev/a/docs', 'img/x.png')).toBe('C:/Users/me/dev/a/docs/img/x.png');
    expect(docRel('C:\\Users\\me\\dev\\a\\docs', '../README.md')).toBe('C:/Users/me/dev/a/README.md');
    expect(docRel('C:/Users/홍 길동/docs', '그림%20하나.png')).toBe('C:/Users/홍 길동/docs/그림 하나.png');
  });
});
