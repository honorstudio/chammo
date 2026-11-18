import { describe, expect, it } from 'vitest';
import { effortsFor, fixEffort, modelOptions, effortOptions, followLabel } from './defaultModel';

const view = { model: '', effort: '', models: ['opus', 'sonnet', 'haiku', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], userModel: 'opus', userEffort: 'high' };

describe('새 세션 기본 모델', () => {
  it('첫 칸은 전역 기본값을 보여 주는 "기본"', () => {
    expect(modelOptions(view)[0]).toEqual({ value: '', label: '기본 (Opus 5.5)' });
    expect(effortOptions(view, '')[0]).toEqual({ value: '', label: '기본 (high)' });
    expect(followLabel('', '')).toBe('기본');
  });
  it('깔린 claude 가 아는 별칭만 — 판 이름으로', () => {
    expect(modelOptions({ ...view, models: ['opus', 'sonnet', 'haiku'] }).map((o) => o.label)).toEqual(['기본 (Opus 5.5)', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
    expect(modelOptions(view).map((o) => o.value)).toEqual(['', 'opus', 'sonnet', 'haiku', 'fable']);
  });
  it('전역 값이 전체 id·[1m] 이어도 이름으로', () => {
    expect(followLabel('claude-sonnet-5-5[1m]', '')).toBe('기본 (Sonnet 5.5)');
    expect(followLabel('opus', 'xhigh')).toBe('기본 (Opus 5.5 · xhigh)');
  });
  it('그 모델이 받는 노력값만, 안 받으면 기본으로 되돌린다', () => {
    expect(effortsFor('sonnet')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsFor('')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(fixEffort('opus', 'max')).toBe('max');
    expect(fixEffort('opus', 'ultra')).toBe('');
  });
});
