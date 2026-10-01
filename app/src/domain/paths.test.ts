import { describe, expect, it } from 'vitest';
import { fwd } from './paths';

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
