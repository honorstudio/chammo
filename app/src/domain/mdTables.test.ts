import { describe, expect, it } from 'vitest';
import { keepTables } from './mdTables';

// BlockNote 가 문서를 저장할 때 표를 통째로 다시 쓴다 — 칸 맞춤 공백이 붙고 정렬(---:)이 사라졌다(2026-10-03 QA 10번)
const orig = ['# 표', '', '| 이름 | 수량 | 메모 |', '|---|---:|---|', '| 사과 | 3 | 빨강 |', '| 바나나 | 12 | 노랑, 길쭉 |', '', '본문 한 줄.'].join('\n');
const blocknote = (body: string, rows = [['사과', '3', '빨강'], ['바나나', '12', '노랑, 길쭉']]) => ['# 표', '', '| 이름            | 수량         | 메모          |', '| ------------- | ---------- | ----------- |', ...rows.map((r) => `| ${r.join(' | ')} |`), '', body].join('\n');

describe('keepTables — 안 고친 표는 원래 글 그대로, 고친 표는 정렬 줄만 원래 것으로', () => {
  it('본문만 고쳤으면 표는 원래 글자 그대로(git diff 에 표가 안 뜨게)', () => {
    expect(keepTables(orig, blocknote('본문 한 X줄.'))).toBe(orig.replace('본문 한 줄.', '본문 한 X줄.'));
  });
  it('표 칸을 고쳤으면 새 표를 쓰되 정렬 줄은 원래 것', () => {
    const out = keepTables(orig, blocknote('본문 한 줄.', [['사과', '4', '빨강'], ['바나나', '12', '노랑, 길쭉']]));
    expect(out).toContain('|---|---:|---|');
    expect(out).toContain('| 사과 | 4 | 빨강 |');
  });
  it('칸 수가 달라졌으면(열을 더함) 정렬 줄을 안 덮는다', () => {
    const next = ['# 표', '', '| 이름 | 수량 | 메모 | 값 |', '| --- | --- | --- | --- |', '| 사과 | 3 | 빨강 | 1 |', '', '본문 한 줄.'].join('\n');
    expect(keepTables(orig, next)).toBe(next);
  });
  it('표가 늘거나 줄면 순서로 짝짓지 않는다 — 같은 내용인 표만 원래 글로', () => {
    const next = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '', blocknote('본문 한 줄.')].join('\n');
    const out = keepTables(orig, next);
    expect(out).toContain('| a | b |\n| --- | --- |');
    expect(out).toContain('|---|---:|---|');
  });
  it('표가 없으면 그대로', () => expect(keepTables('가\n나', '가\n다')).toBe('가\n다'));
  it('코드 블록 안의 | 줄은 표로 안 본다', () => {
    const o = ['```', '| a | b |', '|---|---|', '```'].join('\n');
    const n = ['```', '| a | b |', '| --- | --- |', '```'].join('\n');
    expect(keepTables(o, n)).toBe(n);
  });
});

// 표 한 칸만 고쳐도 편집기가 칸 맞춤 공백으로 표 전체를 다시 썼다(2026-10-04 실측) — 안 바뀐 행은 원래 줄, 바뀐 행은 원래 표처럼 칸 맞춤 없이
describe('keepTables — 고친 표도 고친 행만', () => {
  it('재현: 칸 하나를 고치면 그 행만 바뀐다', () => {
    const out = keepTables(orig, blocknote('본문 한 줄.', [['사과', '4', '빨강'], ['바나나', '12', '노랑, 길쭉']]));
    expect(out).toBe(orig.replace('| 사과 | 3 | 빨강 |', '| 사과 | 4 | 빨강 |'));
  });
  it('원래 칸 맞춤으로 쓴 표는 고친 행도 편집기 모양 그대로', () => {
    const o = '| 이름   | 수 |\n|--------|----|\n| 사과   | 3  |';
    const n = '| 이름     | 수   |\n| ------ | --- |\n| 사과     | 4   |';
    expect(keepTables(o, n)).toBe('| 이름   | 수 |\n|--------|----|\n| 사과     | 4   |');
  });
  it('행을 더하면 새 행만 새로', () => {
    const out = keepTables(orig, blocknote('본문 한 줄.', [['사과', '3', '빨강'], ['바나나', '12', '노랑, 길쭉'], ['배', '1', '노랑']]));
    expect(out).toContain('| 바나나 | 12 | 노랑, 길쭉 |\n| 배 | 1 | 노랑 |');
    expect(out).toContain('|---|---:|---|');
  });
});

describe('검토 지적 — 새 표는 상관없는 원래 표의 정렬을 물려받지 않는다', () => {
  it('겹치는 행이 없으면 짝을 안 짓는다', () => {
    const o = '| a | b |\n|:---:|---:|\n| 1 | 2 |';
    const n = '| x | y |\n| --- | --- |\n| 3 | 4 |';
    expect(keepTables(o, n)).toBe(n);
  });
});
