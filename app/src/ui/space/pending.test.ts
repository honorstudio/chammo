import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 스페이스 md 를 고칠 때 키 하나마다 열어 본 문서 전부(실측 107개·180만 자)의 줄 차이를 다시 세고 통째로 localStorage 에 써서
// 글자가 늦게 찍혔다(2026-10-11 사용자, 하네스 키당 146ms) — 고친 문서만 다시 세고, 기억 쓰기는 모아서, 안 고친 문서는 안 남긴다
const spy = vi.hoisted(() => ({ diffs: 0 }));
vi.mock('../../domain/space', async (orig) => {
  const real = await orig<typeof import('../../domain/space')>();
  return { ...real, mdDiff: (a: string, b: string) => { spy.diffs++; return real.mdDiff(a, b); } };
});

let store: Map<string, string>;
let sets: string[];
let handlers: Record<string, () => void>;
const fakeStorage = () => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { sets.push(k); store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
const load = async () => { vi.resetModules(); return import('./pending'); };
const saved = () => JSON.parse(store.get('spacePending') ?? '{}') as Record<string, { baseline: string; current: string }>;
const doc = (i: number) => `/x/p${i}/문서${i}.md`;
const body = (i: number) => `# 문서 ${i}\n\n` + Array.from({ length: 40 }, (_, k) => `줄 ${k} 가나다`).join('\n');

describe('pending — 고친 것 모아 두기는 키 하나에 가볍게', () => {
  beforeEach(() => {
    store = new Map(); sets = []; handlers = {}; spy.diffs = 0;
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', fakeStorage());
    vi.stubGlobal('window', { addEventListener: (n: string, f: () => void) => { handlers[n] = f; } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('열어 본 문서가 많아도 한 문서를 고치면 그 문서 차이만 다시 센다', async () => {
    const p = await load();
    for (let i = 0; i < 50; i++) p.setBaseline(doc(i), body(i));
    spy.diffs = 0;
    p.setCurrent(doc(7), body(7) + '\n새 줄');
    expect(spy.diffs).toBeLessThanOrEqual(1);
    expect(p.pendingNow().docs).toEqual([{ path: doc(7), diff: { added: ['새 줄'], removed: [] } }]);
  });

  it('처음 고친 순간은 바로 기억한다(앱이 곧 꺼져도 보낼 것에 남게)', async () => {
    const p = await load();
    p.setBaseline(doc(1), body(1));
    p.setCurrent(doc(1), body(1) + '\n첫 글자');
    expect(saved()[doc(1)]!.current).toBe(body(1) + '\n첫 글자');
  });

  it('연달아 치면 기억(localStorage) 쓰기는 모아서 한 번', async () => {
    const p = await load();
    p.setBaseline(doc(1), body(1));
    p.setCurrent(doc(1), body(1) + 'a');
    vi.advanceTimersByTime(2000);
    sets.length = 0;
    for (let k = 0; k < 100; k++) p.setCurrent(doc(1), body(1) + 'a'.repeat(k + 1));
    expect(sets.filter((k) => k === 'spacePending').length).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(sets.filter((k) => k === 'spacePending').length).toBe(1);
    expect(saved()[doc(1)]!.current).toBe(body(1) + 'a'.repeat(100));
  });

  it('안 고친 문서는 기억에 안 남긴다 — 고친 문서만', async () => {
    const p = await load();
    for (let i = 0; i < 5; i++) p.setBaseline(doc(i), body(i));
    p.setCurrent(doc(2), body(2) + '\n고침');
    vi.advanceTimersByTime(2000);
    expect(Object.keys(saved())).toEqual([doc(2)]);
  });

  it('예전에 쌓인 안 고친 문서는 켤 때 한 번 정리된다', async () => {
    const old: Record<string, { baseline: string; current: string }> = {};
    for (let i = 0; i < 20; i++) old[doc(i)] = { baseline: body(i), current: i === 3 ? body(i) + '\n고침' : body(i) };
    store.set('spacePending', JSON.stringify(old));
    const p = await load();
    expect(p.pendingNow().docs.map((d) => d.path)).toEqual([doc(3)]);
    vi.advanceTimersByTime(2000);
    expect(Object.keys(saved())).toEqual([doc(3)]);
  });

  it('고친 것·코멘트는 다시 켜도 남는다(창을 닫을 때 바로 쓴다)', async () => {
    let p = await load();
    p.setBaseline(doc(1), body(1));
    p.setCurrent(doc(1), body(1) + '\n고침');
    p.addComment({ path: doc(1), quote: '줄 3', text: '여기 다시' });
    handlers.pagehide?.(); // 타이머 전에 창이 닫힘
    p = await load();
    expect(p.pendingNow().docs).toEqual([{ path: doc(1), diff: { added: ['고침'], removed: [] } }]);
    expect(p.pendingNow().comments.map((c) => c.text)).toEqual(['여기 다시']);
  });

  it('열린 채 원래대로 되돌렸다 다시 고쳐도 계속 따라간다', async () => {
    const p = await load();
    p.setBaseline(doc(1), body(1));
    p.setCurrent(doc(1), body(1) + '\nx');
    p.setCurrent(doc(1), body(1));
    vi.advanceTimersByTime(2000);
    expect(p.pendingNow().docs).toEqual([]);
    p.setCurrent(doc(1), body(1) + '\ny');
    expect(p.pendingNow().docs).toEqual([{ path: doc(1), diff: { added: ['y'], removed: [] } }]);
  });

  it('안 고친 채 닫았다 다시 켜서 열면 그때 글이 새 기준 — 그사이 밖에서 바뀐 줄을 사용자가 고친 것으로 안 센다', async () => {
    let p = await load();
    p.setBaseline(doc(1), body(1));
    vi.advanceTimersByTime(2000);
    p = await load();
    p.setBaseline(doc(1), body(1) + '\n참모가 더한 줄');
    p.setCurrent(doc(1), body(1) + '\n참모가 더한 줄\n사용자 줄');
    expect(p.pendingNow().docs).toEqual([{ path: doc(1), diff: { added: ['사용자 줄'], removed: [] } }]);
  });

  it('다시 열 때 — 안 보낸 고친 게 있으면 그 기준을 지키고, 안 고친 채면 지금 글이 새 기준', async () => {
    const p = await load();
    p.setBaseline(doc(1), 'a');
    p.setCurrent(doc(1), 'a\n사용자');
    p.setBaseline(doc(1), 'a\n사용자\n밖');
    expect(p.pendingNow().docs).toEqual([{ path: doc(1), diff: { added: ['사용자'], removed: [] } }]);
    p.setBaseline(doc(2), 'b');
    p.setBaseline(doc(2), 'b\n밖');
    p.setCurrent(doc(2), 'b\n밖\n사용자');
    expect(p.pendingNow().docs.find((d) => d.path === doc(2))?.diff).toEqual({ added: ['사용자'], removed: [] });
  });

  it('보냈다 — 새 기준으로 바로 쓰고 기억엔 남는 게 없다', async () => {
    const p = await load();
    p.setBaseline(doc(1), body(1));
    p.setCurrent(doc(1), body(1) + '\n고침');
    vi.advanceTimersByTime(2000);
    p.markSent();
    expect(saved()).toEqual({});
    expect(p.pendingNow().docs).toEqual([]);
  });

  it('밖에서 들어온 변경은 기준에도 옮겨 사용자 줄만 남는다(차이도 새로 센다)', async () => {
    const p = await load();
    p.setBaseline(doc(1), 'a\nb\nc');
    p.setCurrent(doc(1), 'a\nb2\nc');
    p.absorbOutside(doc(1), 'a\nb2\nc', 'a\nb2\nc\n밖');
    expect(p.pendingNow().docs).toEqual([{ path: doc(1), diff: { added: ['b2'], removed: ['b'] } }]);
  });
});
