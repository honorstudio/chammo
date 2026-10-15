import { describe, expect, it } from 'vitest';
import { cellChanges, inputOf, plan, skipOf, typed } from './sheetPlay';

describe('참모 칸 쓰기 재생 계획', () => {
  it('칸 몇 개면 칸마다 넉넉히(최대 600ms), 많으면 빨리 감기(최소 120ms)', () => {
    const few = plan([{ r: 13, c: 9, v: 12 }], '월별합계', false);
    expect(few[0]).toMatchObject({ label: '월별합계!J14', text: '12' });
    expect(few[0]!.move + few[0]!.type + few[0]!.hold).toBe(600);
    const many = plan(Array.from({ length: 200 }, (_, i) => ({ r: i, c: 0, v: i })), 's', false);
    expect(many[0]!.move + many[0]!.type + many[0]!.hold).toBe(120);
  });
  it('안 보이면 움직임 없이 바로', () => {
    const s = plan([{ sheet: '데이터', r: 0, c: 0, f: 'SUM(B1:B9)' }], '월별합계', true)[0]!;
    expect([s.label, s.text, s.move, s.type, s.hold]).toEqual(['데이터!A1', '=SUM(B1:B9)', 0, 0, 0]);
  });
  it('넣을 값·타자 모양', () => {
    expect(inputOf({ r: 0, c: 0, v: null })).toBeNull();
    expect(inputOf({ r: 0, c: 0, v: '한글', f: null })).toBe('한글');
    expect(typed('한글입력', 0.5)).toBe('한글');
    expect(typed('한글입력', 0.01)).toBe('한');
    expect(typed('한글입력', 1)).toBe('한글입력');
  });
  it('사용자가 안 저장한 칸·편집 중인 칸은 건너뛴다', () => {
    const steps = plan([{ r: 0, c: 0, v: 1 }, { r: 1, c: 0, v: 2 }, { r: 2, c: 0, v: 3 }], 's', true);
    const key = (p: { r: number; c: number }) => `p!${p.r}!${p.c}`;
    expect([...skipOf(steps, key, new Set(['p!0!0']), 'p!2!0')]).toEqual(['s!A1', 's!A3']);
  });
});

describe('밖이 고친 판 — 바뀐 칸만', () => {
  const model = new Map<string, { v?: unknown; f?: string | null }>([['0!13!9', { v: 1 }], ['0!1!4', { f: 'SUM(B2:D2)' }], ['0!5!0', { v: '지울 칸' }], ['1!0!0', { v: 3944666.6666666665 }]]);
  const next = (cells0: { r: number; c: number; v?: unknown; f?: string }[]) => ({ sheets: [{ name: '월별합계', cells: cells0 }, { name: '데이터', cells: [{ r: 0, c: 0, v: 3944666.66666667 }] }] });
  it('값이 바뀐 칸·새 칸·지운 칸만, 수식 칸은 수식이 같으면 그대로', () => {
    const r = cellChanges(model, ['월별합계', '데이터'], next([{ r: 13, c: 9, v: 2 }, { r: 1, c: 4, v: 999, f: 'SUM(B2:D2)' }, { r: 27, c: 22, v: '새 칸' }]));
    expect(r.whole).toBe(false);
    expect(r.changes).toEqual([{ sheet: 0, r: 13, c: 9, v: 2, f: null }, { sheet: 0, r: 27, c: 22, v: '새 칸', f: null }, { sheet: 0, r: 5, c: 0, v: null, f: null }]);
  });
  it('시트 이름이 다르거나 바뀐 칸이 너무 많으면 통째로', () => {
    expect(cellChanges(model, ['월별합계', '시트2'], next([])).whole).toBe(true);
    expect(cellChanges(new Map(), ['월별합계', '데이터'], next(Array.from({ length: 5 }, (_, i) => ({ r: i, c: 0, v: i }))), 3).whole).toBe(true);
  });
});
