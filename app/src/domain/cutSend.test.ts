// 끊고 보내기 순서 — Esc 먼저, 기록에 끊김이 붙은 걸 본 뒤에 글(2026-11-17 참모 채팅 '이렇게 보냈음'이 끊긴 턴에 묻힘)
import { describe, expect, it } from 'vitest';
import { afterCut, cutTurn, escWhy, type CutDeps } from './cutSend';
import chatView from '../ui/chat/ChatView.tsx?raw';
import grid from '../ui/SessionGrid.tsx?raw';
import bubble from '../ui/space/DeskBubble.tsx?raw';

const deps = (over: Partial<CutDeps> = {}, seen: string[] = []): CutDeps => ({
  mark: async () => { seen.push('mark'); return 100; },
  esc: async () => { seen.push('esc'); return 'sent'; },
  wait: async (from) => { seen.push(`wait:${from}`); return { via: 'interrupt', ms: 300, lost: [] }; },
  sleep: async (ms) => { seen.push(`sleep:${ms}`); },
  log: (s) => seen.push(`log:${s}`),
  ...over,
});

describe('cutTurn', () => {
  it('기록 끝을 잰 뒤 Esc, 끊김을 본 뒤에야 끝난다 — 글은 그 다음에 친다', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let done = false;
    const p = cutTurn(deps({ wait: async (from) => { seen.push(`wait:${from}`); await gate; return { via: 'interrupt', ms: 410, lost: [] }; } }, seen)).then((r) => { done = true; return r; });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.slice(0, 3)).toEqual(['mark', 'esc', 'log:cut esc=sent']);
    expect(done).toBe(false); // 끊김이 기록에 붙기 전엔 안 끝난다(예전엔 0.7초 뒤 무조건 쳤다)
    release();
    const r = await p;
    expect(r).toEqual({ cut: true, via: 'interrupt', lost: [] });
    expect(seen).toContain('wait:100');
  });

  it('Esc 를 못 넣었으면(앞 글을 치는 중) 끊지 않는다 — 기다리지도 않는다', async () => {
    const seen: string[] = [];
    const r = await cutTurn(deps({ esc: async () => { seen.push('esc'); return 'typing'; } }, seen));
    expect(r.cut).toBe(false);
    expect(seen.some((s) => s.startsWith('wait'))).toBe(false);
    expect(seen).toContain('log:cut esc=typing');
  });

  it('기록을 못 찾으면 예전처럼 0.7초 쉬고 친다', async () => {
    const seen: string[] = [];
    const r = await cutTurn(deps({ mark: async () => null }, seen));
    expect(r).toEqual({ cut: true, via: 'blind', lost: [] });
    expect(seen).toContain('sleep:700');
  });

  it('끊긴 턴에 묻힌 사람 말을 돌려준다', async () => {
    const r = await cutTurn(deps({ wait: async () => ({ via: 'interrupt', ms: 500, lost: ['이렇게 보냈음'] }) }));
    expect(r.lost).toEqual(['이렇게 보냈음']);
  });

  it('기다리다 실패해도 멈추지 않는다', async () => {
    const r = await cutTurn(deps({ wait: async () => { throw new Error('x'); } }));
    expect(r).toEqual({ cut: true, via: 'error', lost: [] });
  });

  it('바로 앞 Esc 가 이미 끊는 중이면(gap) 그 끊김을 기다린다', async () => {
    const seen: string[] = [];
    const r = await cutTurn(deps({ esc: async () => 'gap' }, seen));
    expect(r.cut).toBe(true);
    expect(seen).toContain('wait:100');
  });
});

describe('afterCut — 칠 차례', () => {
  it('묻힌 말 먼저(들어간 순서), 새 글은 끝에', () => {
    expect(afterCut(['a', 'b'], '새 말')).toEqual(['a', 'b', '새 말']);
  });
  it('같은 말은 한 번만 — 새 글과 같은 묻힌 말도 뺀다', () => {
    expect(afterCut(['a', ' a ', '새  말'], '새 말')).toEqual(['a', '새 말']);
  });
  it('새 글 없이(지금 보내기) 묻힌 말만', () => {
    expect(afterCut(['a'])).toEqual(['a']);
    expect(afterCut([])).toEqual([]);
  });
});

describe('escWhy', () => {
  it('간격·치는 중을 가린다', () => {
    expect(escWhy(10_000, 0, 0)).toBe('ok');
    expect(escWhy(10_000, 9_000, 0)).toBe('gap');
    expect(escWhy(10_000, 0, Infinity)).toBe('typing');
  });
});

describe('배선', () => {
  it('채팅 끊고 보내기는 cutTurn 을 기다린 뒤 친다 — Esc 뒤 0.7초 고정 대기로 치지 않는다', () => {
    expect(chatView).not.toMatch(/interrupt\(\);\s*window\.setTimeout\(/);
    expect(chatView).toContain('cutTurn');
    expect(chatView).toContain('afterCut(');
  });
  it('빈 칸 ⌘Enter 도 끊은 뒤 묻힌 말을 다시 넣는다 — 화면의 지금 보내기 단추는 없다(숨은 기능, 2026-11-17 사용자)', () => {
    expect(chatView).toContain('const queuedNow =');
    expect(chatView).toContain('waiting.length) { queuedNow(); return; }'); // 빈 칸 ⌘Enter
    expect(chatView).not.toMatch(/label=\{tr\('지금 보내기'/);
    expect(chatView.match(/sendQueuedNow\(\)/g)?.length).toBe(1); // 남은 하나는 cutTurn 이 없는 칸(원격)의 옛 길
  });
  it('메인 채팅 칸·바탕 대화창 모두 cutTurn 을 준다', () => {
    expect(grid).toContain('cutTurn={');
    expect(bubble).toContain('cutTurn={');
  });
  it('Esc 는 다 기록에 남는다', () => {
    expect(grid).toMatch(/esc=\$\{/);
  });
});
