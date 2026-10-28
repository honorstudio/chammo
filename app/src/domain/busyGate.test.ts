import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachTurns, BOOT_GRACE, busyOf, linkNotice, listErrorText, reattachEvery, SLOW_LINK_MS, slowLinks, TURN_MAX } from './busyGate';
import grid from '../ui/SessionGrid.tsx?raw';
import { REATTACH_POLL } from './attachExit';

// 2026-10-26 23:50 강제 재부팅 뒤 부하 35→70(코어 10): 앱이 참모 칸들을 한꺼번에 붙이자 Claude Code 데몬이 '12초 안 그려짐'으로
// 일하던 참모를 두 번 죽였다 켰다(daemon.log 23:53:29·43 settled killed → claimed-spare respawn). 바쁠 땐 하나씩·느리게 붙는다
describe('busyOf — 맥이 바쁜가(부팅 직후·1분 부하가 코어의 두 배 이상)', () => {
  const at = 1_800_000_000_000;
  it('부하 낮고 부팅한 지 오래면 ok', () => {
    expect(busyOf({ load1: 4, cores: 10, bootAt: at - 60 * 60_000 }, at)).toBe('ok');
  });
  it('1분 부하가 코어 두 배 이상이면 busy (35/10·70/10 둘 다)', () => {
    expect(busyOf({ load1: 35.8, cores: 10, bootAt: null }, at)).toBe('busy');
    expect(busyOf({ load1: 70.5, cores: 10 }, at)).toBe('busy');
    expect(busyOf({ load1: 19.9, cores: 10 }, at)).toBe('ok');
  });
  it('부팅 5분 안이면 부하가 코어 수만 넘어도 boot — 1분 부하는 늦게 오른다(이날 2.7분에 35)', () => {
    expect(busyOf({ load1: 12, cores: 10, bootAt: at - 60_000 }, at)).toBe('boot');
    expect(busyOf({ load1: 12, cores: 10, bootAt: at - BOOT_GRACE - 1 }, at)).toBe('ok');
  });
  it('조용히 재부팅한 맥은 부팅 직후라도 ok — 한가한 맥에선 예전 그대로(리뷰 8)', () => {
    expect(busyOf({ load1: 1, cores: 10, bootAt: at - 60_000 }, at)).toBe('ok');
  });
  it('부하를 아직 못 쟀으면 ok(막지 않는다) · 윈도우(부팅 시각 없음)도 부하로만', () => {
    expect(busyOf(null, at)).toBe('ok');
    expect(busyOf({ load1: 2, cores: 8 }, at)).toBe('ok');
  });
});

describe('reattachEvery — 끊긴 칸이 목록을 다시 보는 간격', () => {
  it('바쁘면 10초 — 2.5초마다 칸마다 claude agents 를 새로 띄우면 부하가 더 오른다', () => {
    expect(reattachEvery('ok')).toBe(REATTACH_POLL);
    expect(reattachEvery('busy')).toBe(10_000);
    expect(reattachEvery('boot')).toBe(10_000);
  });
});

describe('attachTurns — 바쁠 땐 attach 를 하나씩', () => {
  afterEach(() => vi.useRealTimers());
  it('한가하면 다 바로', async () => {
    const t = attachTurns(() => 'ok');
    const got: number[] = [];
    await Promise.all([1, 2, 3].map((n) => t.take().then(() => got.push(n))));
    expect(got).toEqual([1, 2, 3]);
  });
  it('바쁘면 앞 attach 가 화면을 받을(release) 때까지 다음은 기다린다 — 차례대로', async () => {
    const t = attachTurns(() => 'busy');
    const got: string[] = [];
    const r1 = await t.take();
    const p2 = t.take().then((r) => { got.push('2'); return r; });
    const p3 = t.take().then((r) => { got.push('3'); return r; });
    await Promise.resolve();
    expect(got).toEqual([]);
    expect(t.waiting()).toBe(2);
    r1();
    const r2 = await p2;
    expect(got).toEqual(['2']);
    r2();
    (await p3)();
    expect(got).toEqual(['2', '3']);
  });
  it('놓기는 한 번만 센다 — 두 번 불러도 차례가 둘 풀리지 않는다', async () => {
    const t = attachTurns(() => 'busy');
    const r1 = await t.take();
    const got: string[] = [];
    void t.take().then(() => got.push('2'));
    void t.take().then(() => got.push('3'));
    r1(); r1();
    await Promise.resolve(); await Promise.resolve();
    expect(got).toEqual(['2']);
  });
  it('화면이 끝내 안 와도 TURN_MAX 뒤엔 다음 차례로 — 한 칸 때문에 다 굳지 않는다', async () => {
    vi.useFakeTimers();
    const t = attachTurns(() => 'busy');
    await t.take();
    let second = false;
    void t.take().then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(TURN_MAX - 1);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(second).toBe(true);
  });
  it('기다리는 사이 한가해지면(poke) 남은 걸 다 푼다', async () => {
    let b: 'busy' | 'ok' = 'busy';
    const t = attachTurns(() => b);
    await t.take();
    const got: string[] = [];
    void t.take().then(() => got.push('2'));
    void t.take().then(() => got.push('3'));
    b = 'ok';
    t.poke();
    await Promise.resolve(); await Promise.resolve();
    expect(got).toEqual(['2', '3']);
  });
  it('기다리다 칸이 닫히면(cancel) 차례에서 빠진다', async () => {
    const t = attachTurns(() => 'busy');
    const r1 = await t.take();
    const ac = new AbortController();
    const p2 = t.take(ac.signal);
    const got: string[] = [];
    void t.take().then(() => got.push('3'));
    ac.abort();
    await expect(p2).rejects.toThrow();
    r1();
    await Promise.resolve(); await Promise.resolve();
    expect(got).toEqual(['3']);
  });
});

describe('linkNotice — 채팅 칸 위 한 줄(사람 말로)', () => {
  it('붙은 칸은 없음', () => {
    expect(linkNotice({ link: 'live', busy: 'busy' })).toBeNull();
    expect(linkNotice({ link: undefined, busy: 'ok' })).toBeNull();
  });
  it('Claude Code 가 응답 없는 참모를 다시 켜는 중 — 맥이 바쁘다는 것과 보낸 말은 간다는 것', () => {
    const s = linkNotice({ link: 'attaching', phase: 'restarting', busy: 'busy' })!;
    expect(s).toContain('맥이 바빠');
    expect(s).toContain('다시 켜는 중');
    expect(s).toContain('보낸 말은');
  });
  it('차례 기다림·붙는 중·켜지는 중', () => {
    expect(linkNotice({ link: 'attaching', phase: 'queued', busy: 'boot' })).toContain('차례');
    expect(linkNotice({ link: 'attaching', phase: 'attaching', busy: 'ok' })).toContain('붙는 중');
    expect(linkNotice({ link: 'attaching', phase: 'attaching', busy: 'busy' })).toContain('맥이 바빠');
    expect(linkNotice({ link: 'attaching', phase: 'starting', busy: 'ok' })).toContain('켜지는 중');
  });
  it('끊겨 다시 붙는 중 — 목록을 못 읽는 중이면 그렇게', () => {
    expect(linkNotice({ link: 'reattaching', busy: 'ok' })).toContain('다시 붙는 중');
    expect(linkNotice({ link: 'reattaching', listUnknown: true, busy: 'busy' })).toContain('세션 목록');
  });
  it('굳은 끊김은 다시 보내 달라고', () => {
    expect(linkNotice({ link: 'gone', busy: 'ok' })).toContain('다시 보내');
  });
  it('계속 멈춤(데몬이 포기)', () => {
    const s = linkNotice({ link: 'attaching', phase: 'stalled', busy: 'busy' })!;
    expect(s).toContain('계속 멈춰');
    expect(s).toContain('기다려'); // 말은 아직 줄에 있다 — '안 갔을 수 있어'가 아니다(리뷰 7)
  });
});

describe('listErrorText — 세션 목록 실패 띠', () => {
  it('바쁠 때 시간 초과는 한 번으론 안 띄우고, 이어지면 사람 말로', () => {
    expect(listErrorText('command timed out', 1, 'busy')).toBeNull();
    const s = listErrorText('command timed out', 2, 'boot')!;
    expect(s).toContain('막 켜져 바빠');
    expect(s).not.toContain('command timed out');
  });
  it('한가한데 시간 초과가 이어지면 — 관리 프로그램이 응답 없음(재부팅 전 23:45, 부하 1.7)', () => {
    expect(listErrorText('command timed out', 1, 'ok')).toBeNull();
    expect(listErrorText('command timed out', 2, 'ok')).toContain('응답이 없어');
  });
  it('시간 초과가 아닌 실패(옛 claude·로그인 풀림)는 바로, 원문 그대로', () => {
    expect(listErrorText('error: unknown option --json', 1, 'ok')).toContain('unknown option');
  });
});

// 10-27 리뷰 — 1.5초 타이머 하나가 [linkOf] 효과에 묶여 다른 칸이 바뀔 때마다 처음부터 다시 돌았다(칸 여럿이 번갈아 붙으면 안내가 영영 안 뜸)
describe('slowLinks — 붙는 중이 SLOW_LINK_MS 를 넘긴 칸(칸마다 시작 시각을 기억)', () => {
  it('다른 칸이 바뀌어도 처음 붙는 중이 된 시각부터 잰다', () => {
    const since = new Map<string, number>();
    expect(slowLinks({ a: 'attaching' }, since, 0)).toEqual({ slow: [], wait: SLOW_LINK_MS });
    expect(slowLinks({ a: 'attaching', b: 'live' }, since, 1000)).toEqual({ slow: [], wait: SLOW_LINK_MS - 1000 });
    expect(slowLinks({ a: 'attaching', b: 'reattaching' }, since, 1200)).toEqual({ slow: [], wait: SLOW_LINK_MS - 1200 });
    expect(slowLinks({ a: 'attaching', b: 'reattaching' }, since, SLOW_LINK_MS)).toEqual({ slow: ['a'], wait: 1200 });
    expect(slowLinks({ a: 'attaching', b: 'reattaching' }, since, 1200 + SLOW_LINK_MS)).toEqual({ slow: ['a', 'b'], wait: null });
  });
  it('붙으면 잊고 다시 끊기면 처음부터', () => {
    const since = new Map<string, number>();
    slowLinks({ a: 'attaching' }, since, 0);
    expect(slowLinks({ a: 'live' }, since, 1000)).toEqual({ slow: [], wait: null });
    expect(slowLinks({ a: 'reattaching' }, since, 2000)).toEqual({ slow: [], wait: SLOW_LINK_MS });
    expect(slowLinks({}, since, 2100)).toEqual({ slow: [], wait: null });
    expect(since.size).toBe(0);
  });
  it('꺼짐(gone)도 붙어 있지 않은 칸', () => {
    expect(slowLinks({ a: 'gone' }, new Map([['a', 0]]), SLOW_LINK_MS).slow).toEqual(['a']);
  });
  it('SessionGrid 는 칸마다 시각을 기억하는 slowLinks 로 잰다(효과마다 1.5초 새 타이머 X)', () => {
    expect(grid).toMatch(/slowLinks\(/);
    expect(grid).not.toMatch(/\}, 1500\)/);
  });
});
