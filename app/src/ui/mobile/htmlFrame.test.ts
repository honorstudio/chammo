import { describe, expect, it } from 'vitest';
import { HTML_SANDBOX } from './htmlFrame';

describe('html 파일 보기 — 샌드박스', () => {
  it('스크립트만 허용, 같은 출처는 절대 아님(부모 localStorage·/api 에 못 닿게)', () => {
    const v = HTML_SANDBOX.split(/\s+/);
    expect(v).toContain('allow-scripts');
    expect(v).not.toContain('allow-same-origin');
    // 위로 이동·팝업·폼 보내기도 안 준다
    for (const bad of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-forms', 'allow-modals']) expect(v).not.toContain(bad);
  });
});
