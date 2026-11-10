// 공개 이슈 #19 — 윈도우 사용자 일 파일이 D:\Desktop(홈 밖)에 있다. 첨부·붙여넣기·열어도 되는 폴더 판단
import { describe, expect, it } from 'vitest';
import { chipPastes, isAttachCopy, originNote, quotePath, splitGiven } from './drop';
import { staleRefs, termRest, type ChatItem } from './chat';
import { addOpenFolder } from './setup';

describe('chipPastes 윈도우 — 그림도 이름표 + 따옴표 경로', () => {
  it('윈도우 Claude 는 그림 경로를 [Image #n] 으로 안 바꿔서(2.1.319 실측) 이름표를 붙여 참모가 어느 그림인지 안다', () => {
    const items = [{ path: 'C:\\Users\\Me\\.chammo\\attach\\17-pasted.png', label: '#img1' }, { path: 'D:\\Desktop\\매출 11월.xlsx', label: '#file1' }];
    expect(chipPastes(items, true)).toEqual(['#img1 "C:\\\\Users\\\\Me\\\\.chammo\\\\attach\\\\17-pasted.png" #file1 "D:\\\\Desktop\\\\매출 11월.xlsx" ']);
  });
  it('맥은 그대로 — 그림은 이스케이프 경로 앞 조각(Claude 가 [Image #n] 으로 바꾼다)', () => {
    const items = [{ path: '/Users/me/Desktop/스크린샷 1.png', label: '#img1' }, { path: '/Users/me/a.pdf', label: '#file1' }];
    expect(chipPastes(items)).toEqual(['/Users/me/Desktop/스크린샷\\ 1.png ', '#file1 "/Users/me/a.pdf" ']);
    expect(chipPastes(items, false)).toEqual(chipPastes(items));
  });
});

describe('splitGiven — 홈 밖 파일 사본 결과', () => {
  const asked = ['D:\\Desktop\\a.xlsx', 'C:\\Users\\Me\\b.md', 'D:\\없음.pdf'];
  it('사본·그대로는 붙이고 못 한 것은 이유와 함께 뺀다', () => {
    const got = [
      { from: asked[0], path: 'C:\\Users\\Me\\.chammo\\attach\\1-a.xlsx', copied: true },
      { from: asked[1], path: asked[1], copied: false },
      { from: asked[2], error: '파일을 못 찾았어요: D:\\없음.pdf' },
    ];
    expect(splitGiven(asked, got)).toEqual({ ok: ['C:\\Users\\Me\\.chammo\\attach\\1-a.xlsx', asked[1]], bad: [{ from: asked[2], error: '파일을 못 찾았어요: D:\\없음.pdf' }] });
  });
  it('답이 이상하면(옛 앱·명령 실패·개수 다름) 원래 경로 그대로 — 붙이기를 막지 않는다', () => {
    expect(splitGiven(asked, undefined)).toEqual({ ok: asked, bad: [] });
    expect(splitGiven(asked, 'ERR')).toEqual({ ok: asked, bad: [] });
    expect(splitGiven(asked, [{ from: asked[0], path: 'x' }])).toEqual({ ok: asked, bad: [] });
    expect(splitGiven(asked, [null, {}, { path: '' }])).toEqual({ ok: asked, bad: [] });
  });
  it('빈 목록', () => expect(splitGiven([], [])).toEqual({ ok: [], bad: [] }));
});

describe('isAttachCopy — 채팅 첨부 사본만 참모 보관함에', () => {
  it('맥·윈도우 경로 둘 다', () => {
    expect(isAttachCopy('/Users/me/.chammo/attach/1730000000000-phone.jpg')).toBe(true);
    expect(isAttachCopy('C:\\Users\\Me\\.chammo\\attach\\1730000000000-매출_11월.xlsx')).toBe(true); // 전엔 / 만 봐서 윈도우 사본이 보관함에 안 갔다
    expect(isAttachCopy('C:/wod-qa/data/attach/12-a.png')).toBe(true);
  });
  it('사본이 아닌 것', () => {
    expect(isAttachCopy('D:\\Desktop\\attach\\보고.pdf')).toBe(false); // 숫자- 머리가 없다
    expect(isAttachCopy('/Users/me/attach/')).toBe(false);
    expect(isAttachCopy('/Users/me/Desktop/1-a.png')).toBe(false);
    expect(isAttachCopy('/x/attach/12-a/b.png')).toBe(false);
  });
});

describe('addOpenFolder — 열어도 되는 폴더 더하기', () => {
  const home = 'C:\\Users\\Me';
  it('다른 드라이브·그 안 폴더는 받는다(고른 모양 그대로)', () => {
    expect(addOpenFolder([], 'D:\\Desktop', home)).toEqual({ list: ['D:\\Desktop'] });
    expect(addOpenFolder(['D:\\Desktop'], 'D:\\', home)).toEqual({ list: ['D:\\Desktop', 'D:\\'] });
    expect(addOpenFolder([], 'C:\\Work\\2026', home)).toEqual({ list: ['C:\\Work\\2026'] });
  });
  it('홈을 품은 곳은 안 받는다 — 디스크 통째', () => {
    for (const p of ['C:\\', 'C:/', 'c:\\users', 'C:\\Users\\Me', 'C:\\Users\\Me\\']) expect(addOpenFolder([], p, home).note).toBe('holds-home');
    expect(addOpenFolder([], '/', '/Users/me').note).toBe('holds-home');
    expect(addOpenFolder([], '/Users', '/Users/me').note).toBe('holds-home');
  });
  it('홈 안은 이미 열려 있다', () => {
    expect(addOpenFolder([], 'C:\\Users\\Me\\Desktop', home).note).toBe('inside');
    expect(addOpenFolder([], 'c:/users/me/Downloads', home).note).toBe('inside'); // 윈도우는 대소문자를 안 가린다
    expect(addOpenFolder([], '/Users/me/Documents', '/Users/me').note).toBe('inside');
  });
  it('이름이 비슷한 이웃 폴더는 홈 안이 아니다', () => {
    expect(addOpenFolder([], 'C:\\Users\\Me2', home)).toEqual({ list: ['C:\\Users\\Me2'] });
    expect(addOpenFolder([], '/Users/meeting', '/Users/me')).toEqual({ list: ['/Users/meeting'] });
  });
  it('겹침·빈 값', () => {
    expect(addOpenFolder(['D:\\Desktop'], 'd:/desktop/', home)).toEqual({ list: ['D:\\Desktop'], note: 'dup' });
    expect(addOpenFolder(['D:\\Desktop'], '  ', home)).toEqual({ list: ['D:\\Desktop'] });
  });
});

describe('사본엔 원본 표시 — 참모가 사본만 고치고 끝내지 않게(리뷰)', () => {
  it('윈도우 파일 칩: #file1 "사본" (원본 "D:\\…")', () => {
    const t = chipPastes([{ path: 'C:\\U\\.chammo\\attach\\1-매출_11월.xlsx', label: '#file1', from: 'D:\\Desktop\\매출 11월.xlsx' }], true);
    expect(t).toEqual(['#file1 "C:\\\\U\\\\.chammo\\\\attach\\\\1-매출_11월.xlsx" (원본 "D:\\\\Desktop\\\\매출 11월.xlsx") ']);
  });
  it('사본이 아니면(원본 그대로·같은 경로) 표시 없음', () => {
    expect(chipPastes([{ path: 'D:\\a.pdf', label: '#file1', from: 'D:\\a.pdf' }], true)).toEqual(['#file1 "D:\\\\a.pdf" ']);
    expect(chipPastes([{ path: 'D:\\a.pdf', label: '#file1' }], true)).toEqual(['#file1 "D:\\\\a.pdf" ']);
  });
  it('첨부 줄 남은 글·낡은 이름표 판단이 원본 표시를 안다', () => {
    const copy = 'C:\\U\\.chammo\\attach\\1-a.xlsx';
    const term = `#file1 ${quotePath(copy)} ${originNote('D:\\Desktop\\a.xlsx')} 고쳐 줘`;
    expect(termRest(term, [copy])).toBe('고쳐 줘');
    const said = [{ kind: 'user', id: 'u1', ts: '2026-11-10T00:00:00Z', text: term } as ChatItem];
    expect(staleRefs(`#file1 ${quotePath(copy)} ${originNote('D:\\Desktop\\a.xlsx')}`, said)).toBe(true);
  });
});
