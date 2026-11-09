// 홈 화면 앱은 맥 앱을 새로 깔아도 돌아올 때 페이지를 다시 안 읽어 옛 JS·CSS 로 계속 돈다 —
// 2026-10-05 밀기 줄 비침을 고친 판(23:05 설치)을 깔고도 폰은 23:10 에 옛 판 그대로 선이 보였다. 돌아올 때 입구 파일 이름을 맞대 본다
import { describe, expect, it } from 'vitest';
import { entryOf, makeFreshBuild, MAX_TRIES, shouldReload, START_MS } from './freshBuild';

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

// 11-08 사용자 폰 — 맥에 새 판(fitBox)을 깔았는데 폰은 옛 판으로 가렸다(웹킷 실측: 옛 판만 줄바꿈 뒤 첫 글자 10~91px·칩 141px).
// 홈 화면 앱을 새로 켜면 서비스 워커가 받아 둔 옛 껍데기를 주고, 새 판 확인은 '돌아올 때' 한 번(5초 마감)뿐이라 처음 켤 때·LTE 에서 터널이 늦으면 옛 판에 남았다
describe('새 판 확인 시점 — 처음 켤 때도, 실패하면 다시', () => {
  type Deps = Parameters<typeof makeFreshBuild>[0];
  const setup = (over: Partial<Deps> = {}) => {
    const timers: { ms: number; fn: () => void }[] = [];
    const log: string[] = [];
    let blur: (() => void) | null = null;
    const deps: Deps = {
      page: 'mobile-AAAAAAAA.js',
      fetchHtml: async () => html('mobile-BBBBBBBB.js'),
      lastReload: () => 0,
      markReload: () => log.push('mark'),
      now: () => 1e6,
      typing: () => false,
      onBlur: (fn) => { blur = fn; },
      prefetch: async () => { log.push('prefetch'); },
      reload: () => log.push('reload'),
      diag: (line) => { log.push(`diag ${line}`); },
      later: (ms, fn) => { timers.push({ ms, fn }); },
      ...over,
    };
    const fb = makeFreshBuild(deps);
    const tick = async () => { const t = timers.shift(); t?.fn(); await new Promise((r) => setTimeout(r, 0)); return t?.ms; };
    return { fb, deps, timers, log, tick, blur: () => blur?.() };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('켤 때 — 돌아옴 없이도 잠깐 뒤 맞대 보고, 다르면 새 판을 받아 두고 다시 연다 + 맥에 한 줄', async () => {
    const s = setup();
    s.fb.start();
    expect(s.timers[0]!.ms).toBe(START_MS);
    await s.tick();
    await flush();
    expect(s.log).toEqual(['prefetch', 'mark', 'diag from=mobile-AAAAAAAA.js to=mobile-BBBBBBBB.js via=start', 'reload']);
  });
  it('못 읽었으면(터널이 늦음·마감) 잠시 뒤 다시 — 정한 횟수까지만', async () => {
    let n = 0;
    const s = setup({ fetchHtml: async () => { n++; throw new Error('timeout'); } });
    s.fb.start();
    await s.tick();
    for (let i = 0; i < MAX_TRIES + 2; i++) await s.tick();
    expect(n).toBe(MAX_TRIES);
    expect(s.log).toEqual([]);
  });
  it('세 번째에 읽히면 그때 연다', async () => {
    let n = 0;
    const s = setup({ fetchHtml: async () => (++n < 3 ? '' : html('mobile-BBBBBBBB.js')) });
    s.fb.start();
    await s.tick(); await s.tick(); await s.tick();
    await flush();
    expect(n).toBe(3);
    expect(s.log).toContain('reload');
  });
  it('같은 판이면 다시 묻지 않는다', async () => {
    let n = 0;
    const s = setup({ fetchHtml: async () => { n++; return html('mobile-AAAAAAAA.js'); } });
    s.fb.start();
    await s.tick();
    expect(s.timers).toEqual([]);
    expect(n).toBe(1);
  });
  it('쓰는 중이면 손을 뗄(포커스가 빠질) 때까지 기다렸다 연다 — 새 판은 먼저 받아 둔다', async () => {
    let typing = true;
    const s = setup({ typing: () => typing });
    s.fb.check('resume');
    await flush(); await flush();
    expect(s.log).toEqual(['prefetch']);
    s.fb.check('resume'); // 기다리는 동안 또 돌아와도 다시 받지 않는다
    await flush(); await flush();
    expect(s.log).toEqual(['prefetch']);
    typing = false;
    s.blur();
    await flush();
    expect(s.log).toEqual(['prefetch', 'mark', 'diag from=mobile-AAAAAAAA.js to=mobile-BBBBBBBB.js via=resume', 'reload']);
  });
  it('돌아올 때 확인이 도는 중이면 겹쳐 묻지 않는다', async () => {
    let n = 0;
    let open: (v: string) => void = () => {};
    const s = setup({ fetchHtml: () => { n++; return new Promise((r) => { open = r; }); } });
    s.fb.check('resume');
    s.fb.check('resume');
    open(html('mobile-AAAAAAAA.js'));
    await flush();
    expect(n).toBe(1);
  });
});
