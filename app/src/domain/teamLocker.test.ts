import { describe, expect, it } from 'vitest';
import { CHAT, chips, fmtBytes, inPlace, isTeamCache, opensInSpace, readSort, sortItems, SORTS, usageText, whenText, type LockerItem } from './teamLocker';

const it0 = (o: Partial<LockerItem>): LockerItem => ({ id: 'x', name: 'a.pdf', size: 1, cipher: 17, at: 0, state: 'live', kind: 'file', room: '', folder: '', by: '사용자', byMember: 'm1', mine: false, why: '', deletedAt: null, ...o });

describe('팀 보관함 화면 계산', () => {
  it('크기 글 — 바이트·KB·MB·GB, 소수 한 자리', () => {
    expect([fmtBytes(0), fmtBytes(900), fmtBytes(88 * 1024), fmtBytes(2.1 * 1024 ** 2), fmtBytes(3.6 * 1024 ** 3)]).toEqual(['0B', '900B', '88KB', '2.1MB', '3.6GB']);
  });
  it('사용량 — 쓴 것/한도와 비율(0~1)', () => {
    expect(usageText({ used: 3.6 * 1024 ** 3, reserved: 0, seats: 4, limit: 40 * 1024 ** 3 })).toEqual({ text: '3.6 / 40GB', ratio: 0.09 });
    expect(usageText({ used: 0, reserved: 0, seats: 0, limit: 0 }).ratio).toBe(0);
  });
  it('폴더 칩 — 전체, 폴더(가나다), 대화 파일. 프로필 사진·휴지통은 안 센다', () => {
    const items = [it0({ id: '1', folder: '디자인' }), it0({ id: '2', folder: '견적' }), it0({ id: '3', folder: '견적' }), it0({ id: '4', room: 'r1' }), it0({ id: '5', kind: 'avatar' }), it0({ id: '6', state: 'trash', folder: '견적' })];
    expect(chips(items)).toEqual([{ key: '', n: 4 }, { key: '견적', n: 2 }, { key: '디자인', n: 1 }, { key: CHAT, n: 1 }]);
  });
  it('자리 — 폴더·대화 파일·휴지통으로 거른다(새것 먼저)', () => {
    const items = [it0({ id: '1', folder: '견적', at: 1 }), it0({ id: '2', at: 3 }), it0({ id: '3', room: 'r', at: 2 }), it0({ id: '4', state: 'trash', at: 9 })];
    expect(inPlace(items, '').map((i) => i.id)).toEqual(['2', '3', '1']);
    expect(inPlace(items, '견적').map((i) => i.id)).toEqual(['1']);
    expect(inPlace(items, CHAT).map((i) => i.id)).toEqual(['3']);
    expect(inPlace(items, '', true).map((i) => i.id)).toEqual(['4']);
  });
  it('시각 글 — 오늘은 시:분, 어제, 그 전은 월/일', () => {
    const now = new Date(2026, 9, 26, 9, 0).getTime();
    expect(whenText(new Date(2026, 9, 26, 0, 41).getTime(), now)).toBe('00:41');
    expect(whenText(new Date(2026, 9, 25, 23, 0).getTime(), now)).toBe('어제');
    expect(whenText(new Date(2026, 9, 24, 8, 0).getTime(), now)).toBe('10/24');
  });
});

describe('팀 파일 열기 — 스페이스 아니면 기본 앱(10-26 사용자)', () => {
  it('show 가 그리는 형식(글·그림·PDF·md·영상·소리·워드·엑셀·슬라이드)은 스페이스', () => {
    for (const n of ['회의록.txt', 'a.png', 'b.PDF', 'c.md', 'd.mp4', 'e.mp3', 'f.docx', 'g.xlsx', 'h.pptx', 'i.key', 'Makefile', 'j.html']) expect([n, opensInSpace(n)]).toEqual([n, true]);
  });
  it('못 그리는 형식은 기본 앱', () => {
    for (const n of ['간판.ai', 'a.zip', 'b.sketch', 'c.psd', 'd.exe', 'http://x.com/a']) expect([n, opensInSpace(n)]).toEqual([n, false]);
  });
  it('풀어 둔 자리(데이터 폴더 team-locker-peek) 파일만 팀 파일 — 내려받기 단추가 붙는다', () => {
    expect(isTeamCache('/h/.chammo/team-locker-peek/t1/회의록.txt')).toBe(true);
    expect(isTeamCache('C:\\Users\\a\\.chammo\\team-locker-peek\\t1\\a.png')).toBe(true);
    expect(isTeamCache('/h/Documents/team-locker-peek.txt')).toBe(false);
    expect(isTeamCache('/h/Documents/Chammo/팀/a.txt')).toBe(false);
  });
});

describe('폴더 — 빈 폴더 표시 줄(dir)', () => {
  const items = [it0({ id: '1', folder: '견적' }), it0({ id: 'd1', folder: '빈 폴더', dir: true, name: '', size: 0 }), it0({ id: 'd2', folder: '견적', dir: true, name: '' }), it0({ id: 'd3', folder: '버린', dir: true, state: 'trash' })];
  it('표시 줄은 칩에 폴더로(0개)만 남고 개수엔 안 든다', () => {
    expect(chips(items)).toEqual([{ key: '', n: 1 }, { key: '견적', n: 1 }, { key: '빈 폴더', n: 0 }]);
  });
  it('표시 줄은 목록·휴지통 어디에도 줄로 안 나온다', () => {
    expect(inPlace(items, '').map((i) => i.id)).toEqual(['1']);
    expect(inPlace(items, '빈 폴더')).toEqual([]);
    expect(inPlace(items, '', true)).toEqual([]);
  });
});

describe('정렬 — 이름·올린 날짜·크기·올린 사람, 오름/내림', () => {
  const xs = [it0({ id: 'a', name: '나.txt', at: 2, size: 30, by: '다라' }), it0({ id: 'b', name: '가.txt', at: 3, size: 10, by: '가나' }), it0({ id: 'c', name: '다.txt', at: 1, size: 20, by: '마바' })];
  const ids = (k: (typeof SORTS)[number], desc: boolean) => sortItems(xs, { key: k, desc }).map((i) => i.id).join('');
  it('네 가지 기준, 뒤집기', () => {
    expect([ids('name', false), ids('name', true)]).toEqual(['bac', 'cab']);
    expect([ids('at', true), ids('at', false)]).toEqual(['bac', 'cab']);
    expect([ids('size', false), ids('size', true)]).toEqual(['bca', 'acb']);
    expect([ids('by', false), ids('by', true)]).toEqual(['bac', 'cab']);
  });
  it('이름은 숫자를 숫자로(파일2 < 파일10)', () => {
    const ns = [it0({ id: '10', name: '파일10.txt' }), it0({ id: '2', name: '파일2.txt' })];
    expect(sortItems(ns, { key: 'name', desc: false }).map((i) => i.id)).toEqual(['2', '10']);
  });
  it('기억 — 모르는 값·막힌 저장소면 기본(올린 날짜 새것 먼저)', () => {
    expect(readSort(() => JSON.stringify({ key: 'size', desc: false }))).toEqual({ key: 'size', desc: false });
    expect(readSort(() => '{"key":"rm","desc":1}')).toEqual({ key: 'at', desc: true });
    expect(readSort(() => { throw new Error('blocked'); })).toEqual({ key: 'at', desc: true });
    expect(readSort(() => null)).toEqual({ key: 'at', desc: true });
  });
});
