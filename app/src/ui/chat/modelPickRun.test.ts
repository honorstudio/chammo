import { describe, expect, it } from 'vitest';
import { runModelPick, type Defaults } from './modelPickRun';

// 가짜 터미널 — `/model sonnet`·`/effort high` 를 치고 Enter 하면 진짜처럼 결과 줄을 낸다.
// 대화가 길면(confirm) "Switch model?" 확인 창이 먼저 뜨고 1 을 눌러야 바뀐다. 바꾸면 기본값 파일(defaults)에도 적는다(진짜도 그렇다)
class FakeTui {
  log: string[] = ['❯ 준비만 해 둬', '⏺ 준비됐어'];
  buf = '';
  model = 'Opus 5.5';
  effort = 'medium';
  confirm = false;
  asking: string | null = null;
  keys: string[] = [];
  silent = false;
  busy = false;
  info = () => ({ model: this.model, effort: this.effort });
  defaults: Record<string, unknown> = { model: 'claude-opus-5-5', effortLevel: 'xhigh', other: 1 };
  constructor(o: Partial<FakeTui> = {}) { Object.assign(this, o); }
  raw = (d: string) => {
    this.keys.push(d);
    if (this.asking) {
      if (d === '1' || d === '\r') { this.apply(this.asking); this.asking = null; }
      else if (d === '\x1b' || d === '2') { this.log.push('  ⎿  Kept model as ' + this.model); this.asking = null; }
      return;
    }
    if (d !== '\r') { this.buf += d; return; }
    const cmd = this.buf; this.buf = '';
    if (!this.busy) this.log.push(`❯ ${cmd}`); // 일하는 중엔 친 명령 줄이 안 남고 결과만 알림 줄로 뜬다(2026-10-01 실측)
    if (this.silent) return;
    const m = cmd.match(/^\/model (\w+)$/);
    if (m) { if (this.confirm && !this.model.toLowerCase().startsWith(m[1]!)) this.asking = cmd; else this.apply(cmd); return; }
    const e = cmd.match(/^\/effort (\w+)$/);
    if (e) {
      if (this.model.startsWith('Haiku')) { this.log.push('  ⎿  Effort not supported for Haiku 4.5'); return; }
      this.effort = e[1]!; this.defaults = { ...this.defaults, effortLevel: e[1] };
      this.log.push(`${this.busy ? '  ' : '  ⎿  '}Set effort level to ${e[1]} (saved as your default for`);
    }
  };
  apply = (cmd: string) => {
    const a = cmd.split(' ')[1]!;
    const name = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 4.5' }[a]!;
    if (name === this.model) { this.log.push(`  ⎿  Kept model as ${name}`); return; }
    this.model = name; this.defaults = { ...this.defaults, model: a };
    this.log.push(`${this.busy ? '  ' : '  ⎿  '}Set model to ${name} and saved as your default for`);
  };
  screen = () => {
    if (this.asking) return { lines: [...this.log, '▔▔▔', '   Switch model?', `   ❯ 1. Yes, switch to ${this.asking.split(' ')[1]}`, '     2. No, go back'], cursor: [0, 0] as [number, number] };
    const lines = [...this.log, '────────', '❯ ' + this.buf, '────────', '  Opus 5.5 · medium'];
    return { lines, cursor: [2 + this.buf.length, this.log.length + 1] as [number, number] };
  };
  /** 앱이 기본값을 떠 두고 되돌리는 자리 — 진짜는 ~/.claude/settings.json */
  store = (): Defaults => ({
    snapshot: async () => JSON.stringify({ model: this.defaults.model, effortLevel: this.defaults.effortLevel }),
    restore: async (s: string) => { this.defaults = { ...this.defaults, ...JSON.parse(s) }; return true; },
  });
}
const fast = { sleep: async () => {} };

describe('runModelPick — 명령으로 바꾸고(/model·/effort) 기본값은 되돌린다(이 세션만)', () => {
  it('모델만 — 바꾸고 기본값 파일은 그대로', async () => {
    const t = new FakeTui();
    expect(await runModelPick(t, { model: 'sonnet' }, { ...fast, defaults: t.store() })).toEqual({ ok: true });
    expect(t.model).toBe('Sonnet 5.5');
    expect(t.defaults.model).toBe('claude-opus-5-5');
  });
  it('에포트만', async () => {
    const t = new FakeTui();
    expect((await runModelPick(t, { effort: 'high' }, { ...fast, defaults: t.store() })).ok).toBe(true);
    expect(t.effort).toBe('high');
    expect(t.defaults.effortLevel).toBe('xhigh');
  });
  it('대화가 길면 뜨는 "Switch model?" 확인 창에서 예(1)를 누른다 — 안 누르면 세션이 그 창에서 멈췄다(2026-10-01 실측)', async () => {
    const t = new FakeTui({ confirm: true });
    expect((await runModelPick(t, { model: 'sonnet' }, { ...fast, defaults: t.store() })).ok).toBe(true);
    expect(t.model).toBe('Sonnet 5.5');
    expect(t.asking).toBeNull();
  });
  it('이미 그 모델이면 같다고 돌려준다', async () => {
    const t = new FakeTui();
    expect(await runModelPick(t, { model: 'opus' }, { ...fast, defaults: t.store() })).toEqual({ ok: true, same: true });
  });
  it('안 되는 조합(하이쿠 에포트)은 그 글로 실패 — Esc 는 안 누른다', async () => {
    const t = new FakeTui({ model: 'Haiku 4.5' });
    const r = await runModelPick(t, { effort: 'high' }, { ...fast, defaults: t.store() });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.why).toMatch(/Effort not supported/);
    expect(t.keys).not.toContain('\x1b');
  });
  it('결과가 안 나오면(일하는 중 등) 기다리다 실패 — 그래도 Esc 는 안 누른다(누르면 하던 일이 끊겼다)', async () => {
    const t = new FakeTui({ silent: true });
    const r = await runModelPick(t, { model: 'sonnet' }, { ...fast, defaults: t.store(), waitTries: 5 });
    expect(r.ok).toBe(false);
    expect(t.keys).not.toContain('\x1b');
  });
  it('실패해도 기본값은 되돌린다', async () => {
    const t = new FakeTui({ model: 'Haiku 4.5' });
    t.defaults.effortLevel = 'xhigh';
    const store = t.store();
    const snap = await store.snapshot();
    t.defaults = { ...t.defaults, effortLevel: 'low' }; // 명령이 적었다고 치고
    await store.restore(snap);
    expect(t.defaults.effortLevel).toBe('xhigh');
  });
  it('둘 다 — 모델 먼저, 에포트 다음', async () => {
    const t = new FakeTui();
    expect((await runModelPick(t, { model: 'sonnet', effort: 'high' }, { ...fast, defaults: t.store() })).ok).toBe(true);
    expect([t.model, t.effort]).toEqual(['Sonnet 5.5', 'high']);
    expect(t.defaults).toMatchObject({ model: 'claude-opus-5-5', effortLevel: 'xhigh' });
  });
  it('일하는 중 — 친 명령 줄 없이 알림 줄만 떠도 세션 상태(상태줄)가 바뀌면 끝난 걸로(20초씩 기다렸다, 2026-10-01 실측)', async () => {
    const t = new FakeTui({ busy: true });
    let polls = 0;
    const r = await runModelPick(t, { model: 'sonnet' }, { sleep: async () => { polls++; }, defaults: t.store(), current: t.info });
    expect(r).toEqual({ ok: true });
    expect(polls).toBeLessThan(10);
    expect(t.defaults.model).toBe('claude-opus-5-5');
  });
  it('두 번 연달아 눌러도 하나씩 — 둘째가 더럽혀진 기본값을 원래 값으로 알고 되돌리지 않는다(2026-10-01 실측: model 이 opus 로 남았다)', async () => {
    const t = new FakeTui({ busy: true });
    const store = t.store();
    const o = { ...fast, defaults: store, current: t.info };
    await Promise.all([runModelPick(t, { model: 'sonnet' }, o), runModelPick(t, { effort: 'high' }, o)]);
    expect([t.model, t.effort]).toEqual(['Sonnet 5.5', 'high']);
    expect(t.defaults).toMatchObject({ model: 'claude-opus-5-5', effortLevel: 'xhigh' });
  });
  it('입력칸에 글이 있으면 안 친다(섞인다)', async () => {
    const t = new FakeTui();
    t.buf = '쓰던 글';
    const r = await runModelPick(t, { model: 'sonnet' }, { ...fast, defaults: t.store() });
    expect(r.ok).toBe(false);
    expect(t.model).toBe('Opus 5.5');
  });
});
