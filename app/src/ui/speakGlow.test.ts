import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-10-11 perf: 말하는 빛이 문서 맨 위(documentElement)에 --speak-level 을 프레임마다 써서 모든 요소 스타일을 다시 계산했다(웹 13.8→40.2%) —
// 빛나는 자리(말하는 참모의 채팅 탭) 하나에만 쓴다
vi.mock('../data/tauri', () => ({
  speakNowState: vi.fn(async () => ({ id: 1, from: 'sess-a', phase: 'playing', startedMs: 0, hopMs: 25, env: null })),
}));
vi.mock('./attention', () => ({ isAttended: () => true, onAttention: () => () => {} }));

type Fake = { style: { setProperty: ReturnType<typeof vi.fn>; removeProperty: ReturnType<typeof vi.fn> } };
const fakeEl = (): Fake => ({ style: { setProperty: vi.fn(), removeProperty: vi.fn() } });
let rafs: (() => void)[] = [];
let root: Fake;

beforeEach(() => {
  rafs = [];
  root = fakeEl();
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {}, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { rafs.push(f); return rafs.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const flush = () => new Promise((r) => setTimeout(r, 0));
const frames = (n: number) => { for (let i = 0; i < n; i++) { const q = rafs; rafs = []; q.forEach((f) => f()); } };

describe('말하는 빛 — --speak-level 은 빛나는 탭 하나에만', () => {
  it('재생 중 프레임마다 단 요소에만 쓰고 문서 맨 위는 건드리지 않는다', async () => {
    const { speakGlowRef, startSpeakGlow } = await import('./speakGlow');
    const tab = fakeEl();
    speakGlowRef(tab as unknown as HTMLElement);
    const stop = startSpeakGlow();
    await flush();
    frames(3);
    const levels = tab.style.setProperty.mock.calls.filter((c) => c[0] === '--speak-level');
    expect(levels.length).toBeGreaterThanOrEqual(3);
    expect(Number(levels.at(-1)![1])).toBeGreaterThan(0);
    stop();
    expect(root.style.setProperty).not.toHaveBeenCalled();
    expect(tab.style.setProperty.mock.calls.at(-1)).toEqual(['--speak-level', '0.000']); // 끄면 그 자리에서 0
  });

  it('빛나는 탭이 바뀌면 옛 탭에서 지우고 새 탭엔 바로 지금 세기를 쓴다', async () => {
    const { speakGlowRef, startSpeakGlow } = await import('./speakGlow');
    const a = fakeEl(), b = fakeEl();
    speakGlowRef(a as unknown as HTMLElement);
    const stop = startSpeakGlow();
    await flush();
    frames(1);
    const now = a.style.setProperty.mock.calls.at(-1)![1];
    speakGlowRef(null);
    expect(a.style.removeProperty).toHaveBeenCalledWith('--speak-level');
    speakGlowRef(b as unknown as HTMLElement);
    expect(b.style.setProperty).toHaveBeenCalledWith('--speak-level', now);
    stop();
    expect(root.style.setProperty).not.toHaveBeenCalled();
  });
});
