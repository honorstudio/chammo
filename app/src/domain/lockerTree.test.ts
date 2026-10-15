import { describe, expect, it } from 'vitest';
import { activityOrder, BASE_FOLDER, crumbsOf, givenBack, homeMark, kidsOf, linkState, lkPick, parseLkPick, readOnlyAt, userFolders, type LkEntry } from './lockerTree';

const f = (rel: string, x: Partial<LkEntry> = {}): LkEntry => ({ rel, name: rel.split('/').pop() ?? rel, dir: false, link: null, gone: false, size: 1, mtime: 1, vers: 0, ...x });
const d = (rel: string): LkEntry => f(rel, { dir: true, size: null });
const projects = [{ name: 'shop-video', root: '/H/Desktop/dev/shop-video' }, { name: 'shop', root: '/H/Desktop/dev/shop' }];

describe('보관함 나무(진짜 폴더)', () => {
  const entries = [d(BASE_FOLDER), d('10월 보고'), d('10월 보고/세부'), f('10월 보고/세부/b.md'), f('10월 보고/c.xlsx'), d('견적'), f('a.png')];
  it('kidsOf — 바로 아래만, 폴더 먼저', () => {
    expect(kidsOf(entries, '10월 보고').map((e) => e.rel)).toEqual(['10월 보고/세부', '10월 보고/c.xlsx']);
    expect(kidsOf(entries, '').map((e) => e.name)).toEqual([BASE_FOLDER, '10월 보고', '견적', 'a.png']);
  });
  it('userFolders — 기본 폴더(자료)도 보통 폴더, 여러 층(깊이)', () => {
    expect(userFolders(entries)).toEqual([{ rel: BASE_FOLDER, name: BASE_FOLDER, depth: 0 }, { rel: '10월 보고', name: '10월 보고', depth: 0 }, { rel: '10월 보고/세부', name: '세부', depth: 1 }, { rel: '견적', name: '견적', depth: 0 }]);
  });
  it('crumbsOf — 경로 칩', () => {
    expect(crumbsOf('10월 보고/세부')).toEqual([{ rel: '10월 보고', name: '10월 보고' }, { rel: '10월 보고/세부', name: '세부' }]);
    expect(crumbsOf('')).toEqual([]);
  });
});

describe('집 표시', () => {
  it('별칭이면 가리키는 프로젝트(가장 긴 뿌리), 프로젝트 밖이면 바깥, 집 파일·끊긴 건 없음', () => {
    expect(homeMark(f('a', { link: '/H/Desktop/dev/shop-video/assets/보관함/a.png' }), projects)).toBe('shop-video');
    expect(homeMark(f('a', { link: '/H/Desktop/dev/shop/x.png' }), projects)).toBe('shop');
    expect(homeMark(f('a', { link: '/H/Documents/계약/a.pdf' }), projects)).toBe('outside');
    expect(homeMark(f('a'), projects)).toBeNull();
    expect(homeMark(f('a', { link: '/H/x', gone: true }), projects)).toBeNull();
  });
  it('givenBack — 이사 간 파일(assets/보관함 안)만 되돌리기', () => {
    expect(givenBack(f('a', { link: '/H/Desktop/dev/shop-video/assets/보관함/a.png' }))).toBe(true);
    expect(givenBack(f('a', { link: '/H/Desktop/dev/shop-video/a.png' }))).toBe(false);
    expect(givenBack(f('a'))).toBe(false);
  });
});

describe('화면 자리(pick)', () => {
  it('l:<참모> 맨 위(전체 기록) · #p:<뿌리> 진행 중 칩(그 프로젝트 기록) · #d:<자리> 내 폴더', () => {
    expect(lkPick('o1')).toBe('l:o1');
    expect(lkPick('o1', { kind: 'root' })).toBe('l:o1');
    expect(lkPick('o1', { kind: 'dir', rel: '10월 보고/세부' })).toBe('l:o1#d:10월 보고/세부');
    expect(lkPick('o1', { kind: 'root', project: '/H/p' })).toBe('l:o1#p:/H/p');
    expect(parseLkPick('l:o1')).toEqual({ orch: 'o1', place: { kind: 'root' } });
    expect(parseLkPick('l:o1#d:10월 보고')).toEqual({ orch: 'o1', place: { kind: 'dir', rel: '10월 보고' } });
    expect(parseLkPick('l:o1#p:/H/p')).toEqual({ orch: 'o1', place: { kind: 'root', project: '/H/p' } });
    expect(parseLkPick('o:o1')).toBeNull();
    // 옛 자리(v1 폴더 열쇠)는 맨 위로
    expect(parseLkPick('l:o1#u:견적')).toEqual({ orch: 'o1', place: { kind: 'root' } });
  });
});

describe('활동 줄 순서', () => {
  it('사람 필요가 맨 앞, 그다음 일하는 중, 쉬는 것은 뒤 — 같은 무리는 원래 순서', () => {
    const lines: { id: string; status: 'run' | 'ask' | 'wait'; st?: 'blocked' }[] = [{ id: 'a', status: 'wait' }, { id: 'b', status: 'run' }, { id: 'c', status: 'ask' }, { id: 'd', status: 'run', st: 'blocked' }, { id: 'e', status: 'run' }];
    expect(activityOrder(lines).map((x) => x.id)).toEqual(['c', 'd', 'b', 'e', 'a']);
  });
});

// 맥 폴더 연결 — 원본이 집, 보관함엔 바로가기 폴더. 안쪽은 읽기 전용
describe('연결 폴더', () => {
  const entries = [
    d('자료'),
    f('스크린샷', { dir: true, link: '/H/Desktop/스크린샷', linked: true, size: null }),
    f('스크린샷/new.png', { ro: true, link: null }),
    f('스크린샷/old', { dir: true, ro: true, size: null }),
    f('스크린샷/old/a.png', { ro: true }),
  ];
  it('userFolders — 연결 폴더와 안쪽 폴더는 바로가기·옮기기 목적지에서 뺀다', () => {
    expect(userFolders(entries).map((x) => x.rel)).toEqual(['자료']);
  });
  it('kidsOf — 연결 폴더 안 파일은 바로 아래에 보인다', () => {
    expect(kidsOf(entries, '스크린샷').map((e) => e.name)).toEqual(['new.png', 'old']);
    expect(kidsOf(entries, '').map((e) => e.name)).toEqual(['자료', '스크린샷']);
  });
  it('readOnlyAt — 연결 폴더 자체와 안쪽은 읽기 전용, 보통 폴더는 아니다', () => {
    expect(readOnlyAt(entries, '스크린샷')).toBe(true);
    expect(readOnlyAt(entries, '스크린샷/old')).toBe(true);
    expect(readOnlyAt(entries, '자료')).toBe(false);
    expect(readOnlyAt(entries, '')).toBe(false);
    expect(readOnlyAt(entries, '없음')).toBe(false);
  });
  it('linkState — 끊기면 gone, 연결 아니면 없음', () => {
    const root = entries[1]!;
    expect(linkState(root)).toBe('ok');
    expect(linkState({ ...root, gone: true })).toBe('gone');
    expect(linkState(entries[0]!)).toBeUndefined();
  });
});
