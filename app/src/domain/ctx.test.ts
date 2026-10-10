import { describe, expect, it } from 'vitest';
import { ctxAlerts, ctxLevel, parseCtx } from './ctx';

const f = (sessionId: string, used: number, ts = 100) => JSON.stringify({ sessionId, used, size: 1_000_000, model: 'Opus 5.5', name: 'x', cwd: '/d', ts });

describe('parseCtx — 상태줄이 세션마다 남긴 파일들', () => {
  it('session_id → 사용 %', () => {
    expect(parseCtx([f('a', 56), f('b', 81)])).toEqual({ a: { used: 56, ts: 100, model: 'Opus 5.5', size: 1_000_000 }, b: { used: 81, ts: 100, model: 'Opus 5.5', size: 1_000_000 } });
  });

  it('깨진 파일·숫자 아닌 값은 건너뛴다', () => {
    expect(parseCtx(['{깨짐', JSON.stringify({ sessionId: 'c', used: null }), f('d', 12)])).toEqual({ d: { used: 12, ts: 100, model: 'Opus 5.5', size: 1_000_000 } });
  });
});

describe('parseCtx — 모델·에포트(채팅 칩)', () => {
  it('모델 이름·id·에포트를 같이 읽는다', () => {
    const j = JSON.stringify({ sessionId: 'a', used: 5, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5', effort: 'high', ts: 9 });
    expect(parseCtx([j]).a).toEqual({ used: 5, ts: 9, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5', effort: 'high' });
  });
  it('옛 파일(모델·에포트 없음)은 값 없이 읽힌다', () => {
    expect(parseCtx([JSON.stringify({ sessionId: 'a', used: 5, ts: 9 })]).a).toEqual({ used: 5, ts: 9 });
  });
});

describe('ctxLevel — 색 구분', () => {
  it('60 미만 보통 · 60 이상 주의 · 80 이상 위험', () => {
    expect([10, 59, 60, 79, 80, 99].map(ctxLevel)).toEqual(['ok', 'ok', 'mid', 'mid', 'high', 'high']);
  });
});

describe('ctxAlerts — 80% 를 넘는 순간만 알림 (켜자마자 쏟아지지 않게)', () => {
  it('이전에 80 미만이던 세션이 80 이상이 되면', () => {
    expect(ctxAlerts({ a: 79, b: 85 }, { a: 80, b: 90 })).toEqual(['a']);
  });

  it('처음 보는 세션은 알리지 않는다 (앱 켤 때)', () => {
    expect(ctxAlerts({}, { a: 95 })).toEqual([]);
  });

  it('요약(compact)돼서 내려갔다가 다시 넘으면 또 알린다', () => {
    expect(ctxAlerts({ a: 20 }, { a: 81 })).toEqual(['a']);
  });
});

describe('ctxRing — 사이드바 프사 고리(대화 %), 2026-10-10 B안', () => {
  it('채운 길이 = 둘레 × %, 0~100 밖은 자른다', async () => {
    const { ctxRing } = await import('./ctx');
    const c = 2 * Math.PI * 10;
    expect(ctxRing(50, 10).dash).toBeCloseTo(c / 2, 3);
    expect(ctxRing(50, 10).circ).toBeCloseTo(c, 3);
    expect(ctxRing(-5, 10).dash).toBe(0);
    expect(ctxRing(140, 10).dash).toBeCloseTo(c, 3);
  });
  it('색 단계는 숫자 칸과 같다(60 노랑·80 빨강)', async () => {
    const { ctxRing } = await import('./ctx');
    expect(ctxRing(59, 10).level).toBe('ok');
    expect(ctxRing(60, 10).level).toBe('mid');
    expect(ctxRing(80, 10).level).toBe('high');
  });
});
