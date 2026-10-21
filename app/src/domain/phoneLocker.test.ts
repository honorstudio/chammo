import { describe, expect, it } from 'vitest';
import { dotClass, openPathOf, peekLines, phoneChips, phoneTree, shownBy } from './phoneLocker';
import type { LockerView } from './locker';
import type { Session } from './session';

const D = '/Users/me/Documents/Chammo/운영';
const view: LockerView = {
  items: [
    { owner: '운영', path: `${D}/자료/10월-매출.xlsx`, rel: '자료/10월-매출.xlsx', copy: true, by: 'me', ts: '2026-10-11T00:15:00Z', folder: '자료', mtime: 1760141700000 },
    { owner: '운영', path: '/Users/me/dev/shop-landing/hero-b.html', rel: '자료/hero-b.html', copy: false, by: 'me', ts: '2026-10-11T01:42:00Z', folder: '자료', mtime: 1760146920000 },
    { owner: '운영', path: '/Users/me/dev/photo-book/cover.png', rel: 'cover.png', copy: false, by: 'me', ts: '2026-10-11T01:20:00Z', folder: null, mtime: 1760145600000 },
    { owner: '디자인', path: '/Users/me/Documents/Chammo/디자인/x.md', rel: 'x.md', copy: true, by: 'me', ts: '2026-10-11T01:00:00Z', folder: null },
  ],
  hidden: [],
  folders: [{ owner: '운영', name: '자료' }, { owner: '운영', name: '자료/세금' }, { owner: '디자인', name: '자료' }],
  dirs: { 운영: D, 디자인: '/Users/me/Documents/Chammo/디자인' },
};

describe('phoneTree — 폰 서버 phone_view 를 데스크톱 나무 모양으로', () => {
  it('그 참모 것만, 폴더 먼저, 별칭은 가리키는 진짜 파일이 link', () => {
    const t = phoneTree(view, '운영');
    expect(t.dir).toBe(D);
    expect(t.entries.map((e) => e.rel)).toEqual(['자료', '자료/세금', '자료/10월-매출.xlsx', '자료/hero-b.html', 'cover.png']);
    expect(t.entries[1]).toMatchObject({ name: '세금', dir: true });
    expect(t.entries.find((e) => e.rel === '자료/hero-b.html')?.link).toBe('/Users/me/dev/shop-landing/hero-b.html');
    expect(t.entries.find((e) => e.rel === '자료/10월-매출.xlsx')?.link).toBeNull();
  });
  it('rel 이 없는 옛 맥(앱이 아직 옛 판)이면 빈 나무 — 지어내지 않는다', () => {
    const old: LockerView = { items: [{ owner: '운영', path: `${D}/a.md`, copy: true, by: 'me', ts: '' }], hidden: [], folders: [] };
    expect(phoneTree(old, '운영')).toEqual({ dir: '', entries: [] });
  });
});

describe('phoneTree — 맥 폴더 연결(읽기 전용)', () => {
  const real = '/Users/me/Desktop/스크린샷';
  const lv: LockerView = {
    items: [{ owner: '운영', path: `${real}/a.png`, rel: '스크린샷/a.png', copy: true, by: 'me', ts: '2026-10-12T00:00:00Z', folder: '스크린샷', mtime: 1, ro: true }],
    hidden: [],
    folders: [{ owner: '운영', name: '스크린샷', linked: true }, { owner: '운영', name: '스크린샷/지난달', ro: true }],
    dirs: { 운영: D },
  };
  it('폴더에 linked·ro 가 실리고, 안쪽 파일은 진짜 경로(link)로 열린다 — 링크 경로는 문지기가 막는다', () => {
    const t = phoneTree(lv, '운영');
    expect(t.entries.find((e) => e.rel === '스크린샷')).toMatchObject({ dir: true, linked: true });
    expect(t.entries.find((e) => e.rel === '스크린샷/지난달')).toMatchObject({ dir: true, ro: true });
    const f = t.entries.find((e) => e.rel === '스크린샷/a.png');
    expect(f).toMatchObject({ ro: true, link: `${real}/a.png` });
    expect(openPathOf(`${D}/스크린샷/a.png`, t)).toBe(`${real}/a.png`);
  });
});

describe('openPathOf — 폰이 여는 경로(링크 경로는 문지기가 막는다)', () => {
  it('보관함 맨 위 별칭은 가리키는 진짜 파일로, 집 파일·보여 준 파일은 그대로', () => {
    const t = phoneTree(view, '운영');
    expect(openPathOf(`${D}/cover.png`, t)).toBe('/Users/me/dev/photo-book/cover.png');
    expect(openPathOf(`${D}/자료/10월-매출.xlsx`, t)).toBe(`${D}/자료/10월-매출.xlsx`);
    expect(openPathOf('/Users/me/dev/x/y.pdf', t)).toBe('/Users/me/dev/x/y.pdf');
  });
});

const s = (id: string, cwd: string, state: Session['state'] = 'idle'): Session => ({ id, name: id, cwd, kind: 'background', state, project: '', workspace: null, startedAt: 0 });

describe('phoneChips — 진행 중 칩(맡긴 프로젝트 중 일하는·기다리는 것) · 모든 프로젝트', () => {
  it('맡긴 것 중 일함·기다림만 진행 중, 모든 프로젝트엔 쉼·꺼짐까지', () => {
    const sessions = [s('a', '/Users/me/dev/shop-landing', 'working'), s('b', '/Users/me/dev/tax-memo/.claude/worktrees/w1'), s('c', '/Users/me/dev/cafe-menu'), s('d', '/Users/me/dev/other', 'working')];
    const st = (x: Session) => (x.id === 'b' ? 'asks' : x.state === 'working' ? 'working' : 'idle') as never;
    const r = phoneChips(sessions, ['a', 'b', 'c'], '/Users/me/hq', st);
    expect(r.active.map((c) => [c.name, c.dot])).toEqual([['tax-memo', 'ask'], ['shop-landing', 'run']]);
    expect(r.all.map((c) => [c.name, c.dot])).toEqual([['tax-memo', 'ask'], ['shop-landing', 'run'], ['other', 'run'], ['cafe-menu', 'rest']]);
    expect(r.active[0]!.root).toBe('/Users/me/dev/tax-memo');
  });
});

describe('dotClass — 폰 점 넷(모양은 mobile.css)', () => {
  it('일함·기다림·쉼·꺼짐', () => {
    expect(['run', 'ask', 'rest', 'off'].map((k) => dotClass(k as never))).toEqual(['st-work', 'st-wait', 'st-done', 'st-off']);
  });
});

describe('peekLines — 세션 줄 그 자리 펼침(마지막 세 줄)', () => {
  it('시킨 말 · 하는 일(도구) · 답 첫마디, 길면 자른다', () => {
    const lines = peekLines({ prompt: { ts: '1', text: '히어로 B 색 두 가지로' }, tool: { name: 'Edit', target: 'hero.css', ts: '2' }, reply: { ts: '3', text: `배경을 바꿨어. ${'가'.repeat(120)}` } });
    expect(lines).toEqual([{ who: 'me', text: '히어로 B 색 두 가지로' }, { who: 'tool', text: 'Edit · hero.css' }, { who: 'ai', text: `배경을 바꿨어. ${'가'.repeat(51)}…` }]);
  });
  it('없는 칸은 빼고, 아무것도 없으면 빈 목록', () => {
    expect(peekLines({ reply: { ts: '1', text: '끝났어' } })).toEqual([{ who: 'ai', text: '끝났어' }]);
    expect(peekLines({})).toEqual([]);
  });
});

describe('shownBy — 보관함 줄 \'누가 보여 줌\' 조사(QA 2차 \'참모이 보여 줌\')', () => {
  it('받침 없으면 가, 있으면 이, 세션은 그대로', () => {
    expect(shownBy('참모')).toBe('참모가 보여 줌');
    expect(shownBy('두목')).toBe('두목이 보여 줌');
    expect(shownBy('todo-web 세션')).toBe('todo-web 세션 보여 줌');
  });
});
