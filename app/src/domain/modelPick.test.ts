import { describe, expect, it } from 'vitest';
import { effortChoices, effortMoves, familyOf, MODEL_CHOICES, modelChip, modelMoves, parsePicker } from './modelPick';

describe('familyOf — 모델 이름·id 에서 계열', () => {
  it('id·표시 이름 어느 쪽이든', () => {
    expect(familyOf('claude-opus-5-5')).toBe('opus');
    expect(familyOf('Sonnet 5.5')).toBe('sonnet');
    expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(familyOf('Opus 5.5 (1M context)')).toBe('opus');
  });
  it('모르는 것·빈 값은 other', () => {
    expect(familyOf('gpt-x')).toBe('other');
    expect(familyOf(undefined)).toBe('other');
  });
});

describe('MODEL_CHOICES', () => {
  it('고를 수 있는 모델은 이 셋', () => {
    expect(MODEL_CHOICES.map((m) => m.alias)).toEqual(['opus', 'sonnet', 'haiku']);
  });
});

describe('effortChoices — 모델마다 고를 수 있는 단계', () => {
  it('오퍼스는 전부', () => {
    expect(effortChoices('opus').map((e) => e.level)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortChoices('opus').every((e) => !e.disabled)).toBe(true);
  });
  it('소넷 xhigh 는 막는다(더 비싸고 약했다, 2026-09 실측) — 이유를 같이', () => {
    const x = effortChoices('sonnet').find((e) => e.level === 'xhigh')!;
    expect(x.disabled).toBe(true);
    expect(x.why).toMatch(/소넷|Sonnet/);
    expect(effortChoices('sonnet').find((e) => e.level === 'high')!.disabled).toBe(false);
  });
  it('하이쿠·모르는 모델은 에포트를 안 만진다', () => {
    expect(effortChoices('haiku')).toEqual([]);
    expect(effortChoices('other')).toEqual([]);
  });
});

describe('modelChip — 칩에 쓸 글', () => {
  it('모델 · 에포트', () => {
    expect(modelChip({ model: 'Sonnet 5.5', effort: 'high' })).toBe('Sonnet 5.5 · high');
  });
  it('에포트가 없으면 모델만, 둘 다 없으면 null', () => {
    expect(modelChip({ model: 'Haiku 4.5' })).toBe('Haiku 4.5');
    expect(modelChip({})).toBeNull();
    expect(modelChip(undefined)).toBeNull();
  });
});

// 진짜 세션(Claude Code 2.1.286)의 /model 고르는 창 화면 그대로 — 2026-10-01 실측
const PICKER = [
  '   Select model',
  '   Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with',
  '   --model.',
  '     1.  Default (recommended)  Sonnet 5.5 · Efficient for routine tasks',
  '   ❯ 2.  Opus 5.5               For complex work and everyday tasks',
  '     3.  Fable 5.1              For your toughest challenges',
  '     4.  Sonnet 5.5 ✔           Most efficient for simpler tasks',
  '     5.  Haiku 4.5              Fastest for quick answers',
  '     6.  Sonnet 5               Efficient for routine tasks',
  '     7.  Opus 5                 Best for everyday, complex tasks',
  '     8.  Fable 5                Most capable for your hardest and longest-running tasks',
  '     9.  Opus 4.8               Best for everyday, complex tasks',
  '   ↓ 10. Opus 4.7               Best for everyday, complex tasks',
  '      … +2 models',
  '   ● High effort ←/→ to adjust',
  '   Use /fast to turn on Fast mode (Opus 5.5).',
  '   Enter to set as default · s to use this session only · Esc to cancel',
];

describe('parsePicker — 고르는 창 화면 읽기', () => {
  it('목록·커서·에포트를 읽는다', () => {
    const v = parsePicker(PICKER)!;
    expect(v.rows.map((r) => r.name).slice(0, 5)).toEqual(['Default (recommended)', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5']);
    expect(v.cursor).toBe(1);
    expect(v.effort).toBe('high');
    expect(v.effortOk).toBe(true);
  });
  it('창이 아니면 null (명령이 아직 안 뜬 화면)', () => {
    expect(parsePicker(['❯ /model', '  ⎿  Set model to Opus 5.5 for this session only'])).toBeNull();
    expect(parsePicker([])).toBeNull();
  });
  it('하이쿠는 에포트를 안 받는다', () => {
    const v = parsePicker(PICKER.map((l) => l.replace('● High effort ←/→ to adjust', '○ Effort not supported for Haiku 4.5')))!;
    expect(v.effortOk).toBe(false);
    expect(v.effort).toBeUndefined();
  });
  it('단계 이름 xHigh·Medium (default) 도 읽는다', () => {
    expect(parsePicker(PICKER.map((l) => l.replace('● High effort', '◉ xHigh effort')))!.effort).toBe('xhigh');
    expect(parsePicker(PICKER.map((l) => l.replace('● High effort', '◐ Medium effort (default)')))!.effort).toBe('medium');
  });
});

describe('modelMoves — 커서를 원하는 모델 줄로', () => {
  const v = parsePicker(PICKER)!; // 커서 = Opus 5.5(2번)
  it('아래로 · 위로 · 그대로', () => {
    expect(modelMoves(v, 'sonnet')).toEqual(['DOWN', 'DOWN']); // Sonnet 5.5 = 4번 (Default 줄이 아니라 이름 있는 첫 줄)
    expect(modelMoves(v, 'haiku')).toEqual(['DOWN', 'DOWN', 'DOWN']);
    expect(modelMoves(v, 'opus')).toEqual([]);
  });
  it('위쪽으로 이동', () => {
    const at = parsePicker(PICKER.map((l) => l.replace('❯ 2.', '  2.').replace('  5.  Haiku', '❯ 5.  Haiku')))!;
    expect(modelMoves(at, 'opus')).toEqual(['UP', 'UP', 'UP']);
  });
  it('목록에 없으면 null', () => {
    expect(modelMoves({ ...v, rows: v.rows.filter((r) => !r.name.startsWith('Haiku')) }, 'haiku')).toBeNull();
  });
});

describe('effortMoves — 슬라이더(→ 로 low→medium→high→xhigh→max→low 돈다)', () => {
  it('가까운 쪽으로', () => {
    expect(effortMoves('high', 'xhigh')).toEqual(['RIGHT']);
    expect(effortMoves('high', 'low')).toEqual(['LEFT', 'LEFT']);
    expect(effortMoves('max', 'low')).toEqual(['RIGHT']); // 끝에서 처음으로 돈다
    expect(effortMoves('low', 'max')).toEqual(['LEFT']);
    expect(effortMoves('medium', 'xhigh')).toEqual(['RIGHT', 'RIGHT']);
  });
  it('같으면 그대로, 모르는 단계는 null', () => {
    expect(effortMoves('high', 'high')).toEqual([]);
    expect(effortMoves('high', 'ultra')).toBeNull();
    expect(effortMoves(undefined, 'high')).toBeNull();
  });
});
