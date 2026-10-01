import { describe, expect, it } from 'vitest';
import { runModelPick } from './modelPickRun';

// 가짜 터미널 — /model 을 치고 Enter 하면 고르는 창이 열리고, 화살표·s·Esc 에 진짜처럼 반응한다.
// Enter·번호키로 확정하면 "기본값 저장"으로 기록한다(그러면 안 된다)
class FakeTui {
  names = ['Default (recommended)', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5', 'Sonnet 5', 'Opus 5'];
  cursor: number;
  open = false;
  buf = '';
  slider = ['low', 'medium', 'high', 'xhigh', 'max'];
  effort: number;
  model: string;
  savedDefault = false;
  committed: string | null = null;
  neverOpens = false;
  /** 보이는 모델 줄 수(채팅 칸 뒤 터미널이 낮으면 2줄만 보이고 나머지는 '… +N models') */
  window = 99;
  constructor(model = 'Opus 5.5', effort = 'high') { this.model = model; this.cursor = this.names.indexOf(model); this.effort = this.slider.indexOf(effort); }
  raw = (d: string) => {
    if (!this.open) {
      if (d === '\r') { if (this.buf === '/model' && !this.neverOpens) { this.open = true; this.cursor = this.names.indexOf(this.model); } this.buf = ''; return; }
      this.buf += d; return;
    }
    if (d === '\x1b[A') this.cursor = Math.max(0, this.cursor - 1);
    else if (d === '\x1b[B') this.cursor = Math.min(this.names.length - 1, this.cursor + 1);
    else if (d === '\x1b[C' && this.supports()) this.effort = (this.effort + 1) % 5;
    else if (d === '\x1b[D' && this.supports()) this.effort = (this.effort + 4) % 5;
    else if (d === 's') { this.model = this.names[this.cursor]!; this.committed = `${this.model}/${this.slider[this.effort]}`; this.open = false; }
    else if (d === '\x1b') this.open = false;
    else if (d === '\r' || /^\d$/.test(d)) { this.savedDefault = true; this.open = false; }
  };
  supports = () => !this.names[this.cursor]!.startsWith('Haiku');
  screen = () => {
    if (!this.open) return { lines: ['❯ /model', '  ⎿  ready'] };
    const lines = ['   Select model', '   Switch between Claude models.'];
    const from = Math.max(0, Math.min(this.cursor - Math.floor(this.window / 2), this.names.length - this.window));
    this.names.forEach((n, i) => { if (i >= from && i < from + this.window) lines.push(`  ${i === this.cursor ? '❯' : ' '} ${i + 1}.  ${n}${n === this.model ? ' ✔' : ''}               desc`); });
    if (this.window < this.names.length) lines.push(`      … +${this.names.length - this.window} models`);
    lines.push(this.supports() ? `   ● ${['Low', 'Medium', 'High', 'xHigh', 'Max'][this.effort]} effort ←/→ to adjust` : '   ○ Effort not supported for Haiku 4.5');
    lines.push('   Enter to set as default · s to use this session only · Esc to cancel');
    return { lines };
  };
}
const fast = { sleep: async () => {} };

describe('runModelPick — 고르는 창을 화살표로 맞추고 s(이 세션만)로 확정', () => {
  it('모델만 바꾸기', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    const r = await runModelPick(t, { model: 'sonnet' }, fast);
    expect(r).toEqual({ ok: true });
    expect(t.committed).toBe('Sonnet 5.5/high');
    expect(t.savedDefault).toBe(false);
  });
  it('에포트만 바꾸기', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    expect(await runModelPick(t, { effort: 'low' }, fast)).toEqual({ ok: true });
    expect(t.committed).toBe('Opus 5.5/low');
    expect(t.savedDefault).toBe(false);
  });
  it('둘 다', async () => {
    const t = new FakeTui('Sonnet 5.5', 'medium');
    expect(await runModelPick(t, { model: 'opus', effort: 'xhigh' }, fast)).toEqual({ ok: true });
    expect(t.committed).toBe('Opus 5.5/xhigh');
    expect(t.savedDefault).toBe(false);
  });
  it('창이 안 열리면 Esc 로 닫고 실패(기본값은 안 건드림)', async () => {
    const t = new FakeTui();
    t.neverOpens = true;
    const r = await runModelPick(t, { model: 'sonnet' }, { sleep: async () => {}, openTries: 3 });
    expect(r.ok).toBe(false);
    expect(t.committed).toBeNull();
    expect(t.savedDefault).toBe(false);
  });
  it('하이쿠로 바꾸면서 에포트를 요구하면 실패하고 Esc — 아무것도 확정 안 함', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    const r = await runModelPick(t, { model: 'haiku', effort: 'low' }, fast);
    expect(r.ok).toBe(false);
    expect(t.committed).toBeNull();
    expect(t.open).toBe(false);
    expect(t.savedDefault).toBe(false);
  });
  it('이미 그 값이면 창을 열었다가 그냥 닫는다(확정 안 함)', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    expect(await runModelPick(t, { model: 'opus', effort: 'high' }, fast)).toEqual({ ok: true, same: true });
    expect(t.committed).toBeNull();
    expect(t.open).toBe(false);
  });
  it('목록이 접혀(2줄만 보여) 원하는 모델이 안 보이면 한 줄씩 내려가며 찾는다 — 낮은 채팅 칸에서 소넷을 못 찾고 취소했다(2026-10-01 사용자)', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    t.window = 2;
    expect(await runModelPick(t, { model: 'haiku' }, fast)).toEqual({ ok: true });
    expect(t.committed).toBe('Haiku 4.5/high');
    expect(t.savedDefault).toBe(false);
  });
  it('위쪽에 있는 것도(커서가 아래에 있을 때)', async () => {
    const t = new FakeTui('Haiku 4.5', 'high');
    t.window = 2;
    expect(await runModelPick(t, { model: 'opus' }, fast)).toEqual({ ok: true });
    expect(t.committed).toBe('Opus 5.5/high');
  });
  it('도중에 화면 읽기가 터져도(예외) Esc 로 닫고 실패로 돌려준다 — 창이 열린 채 멈추지 않게', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    let n = 0;
    const api = { raw: t.raw, screen: () => { if (++n > 1) throw new Error('boom'); return t.screen(); } };
    const r = await runModelPick(api, { model: 'sonnet' }, fast);
    expect(r.ok).toBe(false);
    expect(t.open).toBe(false);
    expect(t.committed).toBeNull();
    expect(t.savedDefault).toBe(false);
  });
  it('실패하면 그때 화면을 돌려줘 로그로 남긴다', async () => {
    const t = new FakeTui();
    t.neverOpens = true;
    const r = await runModelPick(t, { model: 'sonnet' }, { sleep: async () => {}, openTries: 2 });
    expect(r).toMatchObject({ ok: false, screen: ['❯ /model', '  ⎿  ready'] });
  });
  it('Esc 한 번에 안 닫히면 또 눌러 닫는다(최대 3번)', async () => {
    const t = new FakeTui('Opus 5.5', 'high');
    const esc = t.raw;
    let escs = 0;
    const api = { raw: (d: string) => { if (d === '\x1b' && ++escs === 1) return; esc(d); }, screen: t.screen };
    const r = await runModelPick(api, { model: 'haiku', effort: 'low' }, fast); // 하이쿠+에포트 → 실패 경로
    expect(r.ok).toBe(false);
    expect(t.open).toBe(false);
    expect(escs).toBeGreaterThanOrEqual(2);
  });
});
