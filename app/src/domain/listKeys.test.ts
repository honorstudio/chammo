import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { listKeyAct } from './listKeys';

const b = { key: 'Backspace' as const, composing: false, selectionEmpty: true, type: 'numberedListItem', atStart: true, empty: false, nested: false };

describe('listKeyAct — 목록 맨 앞 Backspace·빈 항목 Enter 는 노션처럼 빠져나간다', () => {
  it('맨 바깥 항목 맨 앞 Backspace = 목록 표시만 빼기(윗줄에 안 붙는다) — 글 있어도 비어도', () => {
    expect(listKeyAct(b)).toBe('toParagraph');
    expect(listKeyAct({ ...b, empty: true })).toBe('toParagraph');
  });
  it('하위 항목 맨 앞 Backspace = 한 단계 바깥', () => {
    expect(listKeyAct({ ...b, nested: true })).toBe('unnest');
    expect(listKeyAct({ ...b, nested: true, empty: true })).toBe('unnest');
  });
  it('빈 항목 Enter = 하위면 한 단계 바깥, 맨 바깥이면 보통 글', () => {
    expect(listKeyAct({ ...b, key: 'Enter', empty: true, nested: true })).toBe('unnest');
    expect(listKeyAct({ ...b, key: 'Enter', empty: true })).toBe('toParagraph');
  });
  it('번호·점·체크·토글 다 같고, 보통 글·제목은 기본에 맡긴다', () => {
    for (const type of ['bulletListItem', 'checkListItem', 'toggleListItem']) expect(listKeyAct({ ...b, type })).toBe('toParagraph');
    for (const type of ['paragraph', 'heading', 'quote']) expect(listKeyAct({ ...b, type })).toBe(null);
  });
  it('한글 조합 중·범위 선택·글 가운데 Backspace·글 있는 줄 Enter 는 안 끼어든다', () => {
    expect(listKeyAct({ ...b, composing: true })).toBe(null);
    expect(listKeyAct({ ...b, key: 'Enter', empty: true, composing: true })).toBe(null);
    expect(listKeyAct({ ...b, selectionEmpty: false })).toBe(null);
    expect(listKeyAct({ ...b, atStart: false })).toBe(null);
    expect(listKeyAct({ ...b, key: 'Enter', empty: false })).toBe(null);
  });
  it('편집기에 걸려 있고, 옛 "빈 줄 지우고 윗줄 끝으로" 확장은 없다', () => {
    const editor = fs.readFileSync(new URL('../ui/space/SpaceEditor.tsx', import.meta.url), 'utf8');
    expect(editor).toMatch(/extensions: \[ListKeys, NotionKeys, ImeListGuard\(\)\]/);
    expect(editor).not.toMatch(/CanvasListBackspace/);
  });
});
