// 홈 화면 앱은 맥 앱을 새로 깔아도 돌아올 때 페이지를 다시 안 읽어 옛 JS·CSS 로 계속 돈다 —
// 2026-10-05 밀기 줄 비침을 고친 판(23:05 설치)을 깔고도 폰은 23:10 에 옛 판 그대로 선이 보였다. 돌아올 때 입구 파일 이름을 맞대 본다
import { describe, expect, it } from 'vitest';
import { entryOf, shouldReload } from './freshBuild';

const html = (e: string) => `<!doctype html><script type="module" crossorigin src="/assets/${e}"></script><link rel="stylesheet" href="/assets/mobile-BUPSf7S3.css">`;

describe('새 판 알아채기', () => {
  it('맥이 주는 껍데기의 입구 파일 이름을 읽는다', () => {
    expect(entryOf(html('mobile-BchcK4_e.js'))).toBe('mobile-BchcK4_e.js');
    expect(entryOf('<html>502</html>')).toBe('');
  });
  it('입구가 바뀌었으면 다시 연다', () => {
    expect(shouldReload({ page: 'mobile-AAAAAAAA.js', server: 'mobile-BchcK4_e.js', lastReload: 0, now: 1e6 })).toBe(true);
  });
  it('같으면·서버 답이 이상하면·개발판(입구 없음)이면 안 연다', () => {
    expect(shouldReload({ page: 'mobile-BchcK4_e.js', server: 'mobile-BchcK4_e.js', lastReload: 0, now: 1e6 })).toBe(false);
    expect(shouldReload({ page: 'mobile-AAAAAAAA.js', server: '', lastReload: 0, now: 1e6 })).toBe(false);
    expect(shouldReload({ page: '', server: 'mobile-BchcK4_e.js', lastReload: 0, now: 1e6 })).toBe(false);
  });
  it('방금(1분 안) 다시 열었으면 또 안 연다 — 서비스 워커가 옛 껍데기를 주면 끝없이 돌지 않게', () => {
    expect(shouldReload({ page: 'mobile-AAAAAAAA.js', server: 'mobile-BchcK4_e.js', lastReload: 1e6 - 30_000, now: 1e6 })).toBe(false);
    expect(shouldReload({ page: 'mobile-AAAAAAAA.js', server: 'mobile-BchcK4_e.js', lastReload: 1e6 - 61_000, now: 1e6 })).toBe(true);
  });
});
