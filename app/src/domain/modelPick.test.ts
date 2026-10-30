import { describe, expect, it } from 'vitest';
import { effortChoices, effortMoves, familyOf, isModel, MODEL_CHOICES, modelChip, modelChipShort, modelMoves, OTHER_MODELS, parsePicker, switchConfirm, commandResult, modelCommand } from './modelPick';

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

describe('MODEL_CHOICES — 계열마다 가장 새 판, 전체 id 로(2026-10-29 Claude Code 2.1.312 /model 창 실측)', () => {
  it('오퍼스·소넷·하이쿠 5.5 — 칩 글에 판 번호', () => {
    expect(MODEL_CHOICES.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(MODEL_CHOICES.map((m) => m.label)).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
  });
  it("'그 밖' 은 /model 창의 나머지 줄 — Fable 5.1 이 맨 앞, 셋과 겹치지 않는다", () => {
    expect(OTHER_MODELS[0]).toEqual({ id: 'claude-fable-5-1', label: 'Fable 5.1' });
    expect(OTHER_MODELS.map((m) => m.label)).toEqual(['Fable 5.1', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Sonnet 4.6']);
    const main = new Set(MODEL_CHOICES.map((m) => m.id));
    expect(OTHER_MODELS.some((m) => main.has(m.id))).toBe(false);
  });
});

describe('isModel — 지금 모델이 그 칸인가(판까지 같아야)', () => {
  it('세션이 Opus 4.8 로 떨어져 있으면 Opus 5.5 칸이 아니다 — 계열만 보고 "이미 Opus" 라며 안 바꿨다(2026-10-29 사용자 402, 안전 분류기 폴백)', () => {
    const fell = { model: 'Opus 4.8', modelId: 'claude-opus-4-8' };
    expect(isModel(fell, 'claude-opus-5-5')).toBe(false);
    expect(isModel(fell, 'claude-opus-4-8')).toBe(true);
  });
  it('id 의 날짜 꼬리·[1m] 은 같은 모델, 판이 짧은 id 는 다른 모델', () => {
    expect(isModel({ modelId: 'claude-haiku-4-5-20251001' }, 'claude-haiku-4-5')).toBe(true);
    expect(isModel({ modelId: 'claude-opus-5-5[1m]' }, 'claude-opus-5-5')).toBe(true);
    expect(isModel({ modelId: 'claude-opus-5-5' }, 'claude-opus-5')).toBe(false);
    expect(isModel({ modelId: 'claude-opus-5' }, 'claude-opus-5-5')).toBe(false);
  });
  it('id 가 없으면 표시 이름으로 — 괄호 꼬리는 뗀다', () => {
    expect(isModel({ model: 'Opus 5.5 (1M context)' }, 'claude-opus-5-5')).toBe(true);
    expect(isModel({ model: 'Opus 5' }, 'claude-opus-5-5')).toBe(false);
    expect(isModel(undefined, 'claude-opus-5-5')).toBe(false);
  });
});

describe('effortChoices — 모델마다 고를 수 있는 단계(2026-10-29 실측: Haiku 4.5 만 "Effort not supported")', () => {
  it('오퍼스는 전부', () => {
    expect(effortChoices({ modelId: 'claude-opus-5-5' }).map((e) => e.level)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortChoices({ modelId: 'claude-opus-5-5' }).every((e) => !e.disabled)).toBe(true);
  });
  it('소넷 xhigh 도 고를 수 있다 — 막지 않고 안내만(공개판 사용자에겐 제약이었다, 2026-10-01 사용자)', () => {
    const x = effortChoices({ model: 'Sonnet 5.5' }).find((e) => e.level === 'xhigh')!;
    expect(x.disabled).toBe(false);
    expect(x.why).toMatch(/소넷|Sonnet/);
  });
  it('Haiku 5.5·Fable 은 에포트를 받는다', () => {
    expect(effortChoices({ modelId: 'claude-haiku-5-5' })).toHaveLength(5);
    expect(effortChoices({ model: 'Fable 5.1', modelId: 'claude-fable-5-1' })).toHaveLength(5);
  });
  it('Haiku 4.5·모르는 모델은 에포트를 안 만진다', () => {
    expect(effortChoices({ model: 'Haiku 4.5', modelId: 'claude-haiku-4-5-20251001' })).toEqual([]);
    expect(effortChoices({ model: 'Mystery 9' })).toEqual([]);
    expect(effortChoices(undefined)).toEqual([]);
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

describe('modelChipShort — 폰 입력창 칩(2026-10-11 사용자 "이렇게 클 필요 없어"): 가장 새 판이면 판 번호 없이', () => {
  it('가장 새 판 = 계열 이름 · 에포트', () => {
    expect(modelChipShort({ model: 'Opus 5.5', effort: 'high' })).toBe('Opus · high');
    expect(modelChipShort({ model: 'Opus 5.5 (1M context)', modelId: 'claude-opus-5-5', effort: 'xhigh' })).toBe('Opus · xhigh');
    expect(modelChipShort({ model: 'Haiku 5.5' })).toBe('Haiku');
  });
  it('옛 판·그 밖 모델은 판 번호까지 — "Opus" 로만 보이면 4.8 로 떨어진 걸 못 알아본다', () => {
    expect(modelChipShort({ model: 'Opus 4.8', modelId: 'claude-opus-4-8', effort: 'high' })).toBe('Opus 4.8 · high');
    expect(modelChipShort({ model: 'Haiku 4.5' })).toBe('Haiku 4.5');
    expect(modelChipShort({ model: 'Fable 5.1', effort: 'max' })).toBe('Fable 5.1 · max');
  });
  it('모르는 모델은 첫 낱말, 값이 없으면 null', () => {
    expect(modelChipShort({ model: 'Mystery 9 big', effort: 'low' })).toBe('Mystery · low');
    expect(modelChipShort({})).toBeNull();
  });
});

describe('모델·에포트 말은 영어(시트 고르기 목록·칩)', () => {
  it('모델 이름·에포트 단계에 한글이 없다', () => {
    for (const m of [...MODEL_CHOICES, ...OTHER_MODELS]) expect(m.label).toMatch(/^[A-Z][a-z]+ [0-9.]+$/);
    const all = effortChoices({ modelId: 'claude-opus-5-5' });
    for (const e of all) expect(e.level).toMatch(/^[a-z]+$/);
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

describe('switchConfirm — 대화가 길면 /model 뒤에 "Switch model?" 확인 창이 뜬다(2026-10-01 실측)', () => {
  const dialog = ['▔▔▔▔', '   Switch model?', '   Your next response will be slower and use more', '   ❯ 1. Yes, switch to Sonnet 5.5', '     2. No, go back'];
  it('확인 창이면 true', () => { expect(switchConfirm(dialog)).toBe(true); });
  it('보통 화면이면 false', () => { expect(switchConfirm(['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5'])).toBe(false); });
});

describe('commandResult — 친 명령(/model sonnet·/effort high) 바로 아래 결과 줄', () => {
  it('바꿨다', () => {
    const l = ['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5 and saved as your default for', '     new sessions'];
    expect(commandResult(l, '/model sonnet')).toEqual({ ok: true, text: 'Set model to Sonnet 5.5 and saved as your default for' });
  });
  it('이미 그 모델', () => {
    expect(commandResult(['❯ /model opus', '  ⎿  Kept model as Opus 5.5'], '/model opus')?.ok).toBe(true);
  });
  it('에포트', () => {
    expect(commandResult(['❯ /effort high', '  ⎿  Set effort level to high (saved as your default for'], '/effort high')?.ok).toBe(true);
  });
  it('예전에 친 같은 명령의 결과는 안 본다 — 마지막으로 친 줄 아래만', () => {
    const l = ['❯ /model sonnet', '  ⎿  Set model to Sonnet 5.5', '⏺ 준비됐어', '❯ /model sonnet'];
    expect(commandResult(l, '/model sonnet')).toBeNull();
  });
  it('아직 결과가 없으면 null', () => { expect(commandResult(['❯ /effort low'], '/effort low')).toBeNull(); });
  it('명령 줄이 안 보이면 null', () => { expect(commandResult(['아무것도'], '/effort low')).toBeNull(); });
  it('안 되는 결과면 ok:false 와 그 글', () => {
    expect(commandResult(['❯ /effort high', '  ⎿  Effort not supported for Haiku 4.5'], '/effort high')).toEqual({ ok: false, text: 'Effort not supported for Haiku 4.5' });
  });
});

describe('modelCommand — 채팅에서 친 /model·/effort 를 칩으로 돌린다(터미널 고르는 창은 Enter 가 바로 골라 버려 기본값이 저장됐다, 2026-10-01 시험)', () => {
  it('/model 만 — 칩 메뉴를 연다', () => { expect(modelCommand('/model')).toEqual({ open: true }); expect(modelCommand(' /model  ')).toEqual({ open: true }); });
  it('/model 별칭 — 칩 칸의 전체 id 로(별칭은 Claude Code 판마다 풀리는 곳이 다르다)', () => {
    expect(modelCommand('/model sonnet')).toEqual({ want: { model: 'claude-sonnet-5-5' } });
    expect(modelCommand('/model Opus')).toEqual({ want: { model: 'claude-opus-5-5' } });
    expect(modelCommand('/model fable')).toEqual({ want: { model: 'claude-fable-5-1' } });
  });
  it('/model 전체 id — 목록에 있는 것만', () => {
    expect(modelCommand('/model claude-opus-4-8')).toEqual({ want: { model: 'claude-opus-4-8' } });
    expect(modelCommand('/model claude-opus-9-9')).toBeNull();
  });
  it('/effort 단계', () => { expect(modelCommand('/effort high')).toEqual({ want: { effort: 'high' } }); expect(modelCommand('/effort')).toEqual({ open: true }); });
  it('모르는 이름·다른 글은 그대로 보낸다', () => {
    expect(modelCommand('/effort turbo')).toBeNull();
    expect(modelCommand('/model sonnet\n그리고 이것도')).toBeNull();
    expect(modelCommand('모델 바꿔줘')).toBeNull();
  });
});
