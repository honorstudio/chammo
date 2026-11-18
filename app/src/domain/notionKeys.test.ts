import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { SHORTCUTS, TYPE_KEYS, cmdEnterAct } from './notionKeys';

const hit = (s: string) => SHORTCUTS.find((r) => r.find.test(s))?.type ?? null;

describe('노션 단축키 맞추기', () => {
  it("'a. '·'i. ' = 번호 목록, '> ' = 토글 — 다른 글자는 안 건드린다", () => {
    expect(hit('a. ')).toBe('numberedListItem');
    expect(hit('i. ')).toBe('numberedListItem');
    expect(hit('> ')).toBe('toggleListItem');
    for (const s of ['b. ', 'ab. ', 'a.', '>> ', '" ']) expect(hit(s)).toBe(null);
  });
  it('⌘⌥4~8 = 할 일·점·번호·토글·코드', () => {
    expect(TYPE_KEYS).toEqual({ '4': 'checkListItem', '5': 'bulletListItem', '6': 'numberedListItem', '7': 'toggleListItem', '8': 'codeBlock' });
  });
  it('⌘Enter = 할 일 체크, 토글·접는 제목 열고 닫기, 그 밖은 기본', () => {
    expect(cmdEnterAct('checkListItem', false)).toBe('check');
    expect(cmdEnterAct('toggleListItem', false)).toBe('fold');
    expect(cmdEnterAct('heading', true)).toBe('fold');
    expect(cmdEnterAct('heading', false)).toBe(null);
    expect(cmdEnterAct('paragraph', false)).toBe(null);
  });
  it('편집기에 걸려 있다', () => {
    expect(fs.readFileSync(new URL('../ui/space/SpaceEditor.tsx', import.meta.url), 'utf8')).toMatch(/extensions: \[ListKeys, NotionKeys, ImeListGuard\(\)\]/);
  });
});
