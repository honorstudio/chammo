import { describe, expect, it } from 'vitest';
import { envFromCache, firstThumbs, PRELOAD_GRACE, splashDeadline, splashDone, SPLASH_MAX } from './boot';

describe('폰 첫 화면 스플래시 — 글자 화면 없이 모찌 한 장으로(2026-10-04 사용자 LTE "불러오는 중…")', () => {
  const at = (o: Partial<Parameters<typeof splashDone>[0]>) => splashDone({ base: 'wait', preloaded: false, now: 0, readyAt: 0, ...o });
  it('맥 정보·세션을 받기 전엔 2.5초가 지나도 걷지 않는다(그 사이 글자 화면이 떴다)', () => {
    expect(at({ base: 'wait', now: 900 })).toBe(false);
    expect(at({ base: 'wait', now: SPLASH_MAX + 5000 })).toBe(false);
  });
  it('짝짓기 화면·못 닿음은 바로 보인다', () => {
    expect(at({ base: 'nokey', now: 100 })).toBe(true);
    expect(at({ base: 'error', now: 100 })).toBe(true);
  });
  it('준비되면 미리 받기가 끝날 때 걷는다', () => {
    expect(at({ base: 'ready', readyAt: 800, now: 900, preloaded: true })).toBe(true);
    expect(at({ base: 'ready', readyAt: 800, now: 900, preloaded: false })).toBe(false);
  });
  it('미리 받기가 늦으면 마감에 — 일찍 준비됐으면 연 지 2.5초, 늦게 준비됐으면 준비 + 0.8초', () => {
    expect(splashDeadline(800)).toBe(SPLASH_MAX);
    expect(splashDeadline(3200)).toBe(3200 + PRELOAD_GRACE);
    expect(at({ base: 'ready', readyAt: 800, now: SPLASH_MAX - 1 })).toBe(false);
    expect(at({ base: 'ready', readyAt: 800, now: SPLASH_MAX })).toBe(true);
    expect(at({ base: 'ready', readyAt: 3200, now: 3500 })).toBe(false);
    expect(at({ base: 'ready', readyAt: 3200, now: 3200 + PRELOAD_GRACE })).toBe(true);
  });
});

describe('envFromCache — 지난번 맥 정보(먼저 그리고 새로 받아 바꾼다)', () => {
  const env = { assistantName: '참모', language: 'ko', devRoot: '/u/dev', extraProjects: ['/u/x'], hqDir: '/u/dev/hq' };
  it('모양이 맞으면 그대로', () => {
    expect(envFromCache(JSON.stringify(env))).toEqual(env);
  });
  it('없거나 깨졌거나 모양이 다르면 null — 받을 때까지 기다린다', () => {
    expect(envFromCache(null)).toBeNull();
    expect(envFromCache('{')).toBeNull();
    expect(envFromCache('null')).toBeNull();
    expect(envFromCache(JSON.stringify({ ...env, hqDir: 3 }))).toBeNull();
    expect(envFromCache(JSON.stringify({ ...env, extraProjects: [1] }))).toBeNull();
    expect(envFromCache(JSON.stringify({ ...env, hqDir: '' }))).toBeNull();
  });
  it('모르는 칸은 버린다 — 맥이 준 것만 남긴다', () => {
    expect(envFromCache(JSON.stringify({ ...env, token: 'x' }))).toEqual(env);
  });
});

describe('firstThumbs — 대시보드 첫 카드들 썸네일(첫 카드 720, 나머지 360)만 미리', () => {
  const log = [
    { ts: '1', path: '/u/a.png', from: 'o1' },
    { ts: '2', path: '/u/b.md', from: 'o1' },
    { ts: '3', path: '/u/c.pdf', from: 'o1' },
    { ts: '4', path: '/u/x.png', from: 'o2' },
    { ts: '5', path: 'https://example.com', from: 'o1' },
    { ts: '6', path: '/u/d.jpg', from: 'o1' },
  ].map((r) => JSON.stringify(r)).join('\n');
  it('그 참모가 보여 준 최근 순 앞 n 개 중 그림·첫 장이 있는 것만', () => {
    // 최근 순 앞 4개 = d.jpg·웹 주소·c.pdf·b.md → 그림·첫 장은 d(첫 카드 720)·c
    expect(firstThumbs(log, 'o1', 4)).toEqual([
      { path: '/u/d.jpg', size: 720 },
      { path: '/u/c.pdf', size: 360 },
    ]);
    expect(firstThumbs(log, 'o1', 6).map((x) => x.path)).toEqual(['/u/d.jpg', '/u/c.pdf', '/u/a.png']);
  });
});

describe('firstThumbs 순서 — 화면 카드(보낸 시각 최근 순)와 같게', () => {
  it('기록 줄 순서가 아니라 ts 최근 순', () => {
    const log = [{ ts: '9', path: '/u/new.png', from: 'o1' }, { ts: '1', path: '/u/old.png', from: 'o1' }].map((r) => JSON.stringify(r)).join('\n');
    expect(firstThumbs(log, 'o1').map((x) => x.path)).toEqual(['/u/new.png', '/u/old.png']);
  });
});
