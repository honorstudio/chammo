import { describe, expect, it, vi } from 'vitest';
import { installNote, nextPhase, runInstall, type Phase, type Step } from './appInstall';

describe('nextPhase — 받기 단계', () => {
  it('받기 시작 → 조각을 더해 간다 → 설치', () => {
    let p: Phase = { kind: 'get', got: 0, total: null };
    p = nextPhase(p, { kind: 'started', total: 1000 });
    expect(p).toEqual({ kind: 'get', got: 0, total: 1000 });
    p = nextPhase(p, { kind: 'progress', got: 300 });
    p = nextPhase(p, { kind: 'progress', got: 200 });
    expect(p).toEqual({ kind: 'get', got: 500, total: 1000 });
    expect(nextPhase(p, { kind: 'installing' })).toEqual({ kind: 'install' });
  });
});

describe('installNote — 띠 문구 [한글, 영어]', () => {
  it('받는 중엔 퍼센트와 끄지 말라는 한 줄', () => {
    expect(installNote({ kind: 'get', got: 250, total: 1000 }, '9.8.7')[0]).toBe('Chammo 9.8.7 받는 중 25% — 끝나면 저절로 다시 켜져요. 그동안 앱을 끄지 마세요.');
  });
  it('크기를 모르면 퍼센트 없이', () => {
    expect(installNote({ kind: 'get', got: 5, total: null }, '9.8.7')[0]).toBe('Chammo 9.8.7 받는 중 — 끝나면 저절로 다시 켜져요. 그동안 앱을 끄지 마세요.');
  });
  it('설치 중', () => {
    expect(installNote({ kind: 'install' }, '9.8.7')[1]).toBe('Installing Chammo 9.8.7 — it restarts by itself. Please keep the app open.');
  });
});

describe('runInstall — 버튼 하나로 받기·설치·다시 켜기, 안 되면 내려받기 링크로', () => {
  const setup = (install: (on: (s: Step) => void) => Promise<void>) => {
    const phases: Phase[] = [];
    const open = vi.fn(async () => {});
    return { phases, open, run: () => runInstall(install, (p) => phases.push(p), open) };
  };

  it('다 되면 링크를 열지 않는다(앱이 다시 켜진다)', async () => {
    const t = setup(async (on) => { on({ kind: 'started', total: 10 }); on({ kind: 'progress', got: 10 }); on({ kind: 'installing' }); });
    expect(await t.run()).toBe(true);
    expect(t.open).not.toHaveBeenCalled();
    expect(t.phases.at(-1)).toEqual({ kind: 'install' });
  });

  it('서명이 안 맞으면 내려받기 링크를 열고 실패로', async () => {
    const t = setup(async (on) => { on({ kind: 'started', total: 10 }); throw 'signature verification failed'; });
    expect(await t.run()).toBe(false);
    expect(t.open).toHaveBeenCalledOnce();
    expect(t.phases.at(-1)).toEqual({ kind: 'failed', why: 'signature verification failed' });
  });

  it('업데이터가 꺼진 판(개인 앱)은 조용히 링크로 — 실패 문구 없음', async () => {
    const t = setup(async () => { throw 'off'; });
    expect(await t.run()).toBe(false);
    expect(t.open).toHaveBeenCalledOnce();
    expect(t.phases.at(-1)).toEqual({ kind: 'idle' });
  });

  it('latest.json 이 아직 없거나 새 판이 아니면(none) 링크로', async () => {
    const t = setup(async () => { throw 'none'; });
    expect(await t.run()).toBe(false);
    expect(t.open).toHaveBeenCalledOnce();
  });

  it('링크 열기가 실패해도 터지지 않는다', async () => {
    const phases: Phase[] = [];
    expect(await runInstall(async () => { throw new Error('net'); }, (p) => phases.push(p), async () => { throw new Error('x'); })).toBe(false);
    expect(phases.at(-1)).toEqual({ kind: 'failed', why: 'net' });
  });
});
