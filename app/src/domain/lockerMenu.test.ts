import { describe, expect, it } from 'vitest';
import { lockerMenu, moveTargets } from './lockerMenu';

const own = { link: false, gone: false, vers: 1, givenBack: false };
const flat = (g: string[][]) => g.flat();

// 보관함 오른쪽 클릭(2026-10-12 사용자 "우클릭을 습관적으로 하게 된다") — 그 자리에서 되는 것만, 카드 ··· 메뉴와 같은 목록
describe('lockerMenu — 파일(카드·목록 줄·기록 줄)', () => {
  it('집 파일 — 열기·크게·보내기 / 바로가기·이름 / 파인더 / 휴지통', () => {
    expect(lockerMenu({ kind: 'file', entry: own, folders: 2 })).toEqual([
      ['open', 'big', 'send'], ['alias', 'move', 'rename'], ['reveal'], ['trash'],
    ]);
  });
  it('판이 여럿이면 이전 판', () => {
    expect(flat(lockerMenu({ kind: 'file', entry: { ...own, vers: 3 }, folders: 1 }))).toContain('vers');
  });
  it('바로가기 — 지우기는 휴지통이 아니라 바로가기 지우기(원본은 그대로)', () => {
    const m = flat(lockerMenu({ kind: 'file', entry: { ...own, link: true, vers: 4 }, folders: 1 }));
    expect(m).toContain('unlink');
    expect(m).not.toContain('trash');
    expect(m).not.toContain('vers'); // 판은 집 파일만 남긴다
  });
  it('프로젝트로 이사 간 파일을 가리키는 바로가기 — 보관함으로 되돌리기', () => {
    expect(flat(lockerMenu({ kind: 'file', entry: { ...own, link: true, givenBack: true }, folders: 0 }))).toContain('back');
  });
  it('원본이 없는 바로가기 — 열기·보내기·파인더는 없고 다시 찾기·지우기', () => {
    expect(lockerMenu({ kind: 'file', entry: { ...own, link: true, gone: true }, folders: 3 })).toEqual([['find'], ['rename'], ['unlink']]);
  });
  it('보관함 밖 파일(보여 준 것) — 이름·휴지통·파인더 없음, 보관함에 넣기', () => {
    expect(lockerMenu({ kind: 'file', entry: null, folders: 1 })).toEqual([['open', 'big', 'send'], ['alias', 'keep']]);
  });
  it('내 폴더가 하나도 없으면 폴더에 바로가기는 안 보인다', () => {
    expect(flat(lockerMenu({ kind: 'file', entry: own, folders: 0 }))).not.toContain('alias');
    expect(flat(lockerMenu({ kind: 'file', entry: null, folders: 0 }))).not.toContain('alias');
  });
});

describe('lockerMenu — 폴더·빈 곳·탭', () => {
  it('폴더(나무 줄·폴더 카드) — 열기 / 안에 새 폴더·새 문서 / 이름 / 파인더 / 휴지통', () => {
    expect(lockerMenu({ kind: 'folder' })).toEqual([['open'], ['newFolder', 'newDoc'], ['move', 'rename'], ['reveal'], ['trash']]);
  });
  it('빈 곳 — 새로 만들기 넷 + 맥 폴더 연결 / 파인더', () => {
    expect(lockerMenu({ kind: 'blank' })).toEqual([['newFolder', 'newDoc', 'newSheet', 'add', 'connect'], ['reveal']]);
  });
  it('마지막 휴지통 묶음이 있으면 빈 곳 맨 아래 "휴지통 되돌리기"(앱을 다시 켜도, 2026-10-12 사고)', () => {
    expect(lockerMenu({ kind: 'blank', untrash: true })).toEqual([['newFolder', 'newDoc', 'newSheet', 'add', 'connect'], ['reveal'], ['untrash']]);
    expect(lockerMenu({ kind: 'blank', ro: true, untrash: true })).toEqual([['reveal'], ['untrash']]);
  });
  it('연결 폴더 안 빈 곳 — 읽기 전용이라 파인더만', () => {
    expect(lockerMenu({ kind: 'blank', ro: true })).toEqual([['reveal']]);
  });
  it('보관함 안 파일 탭 — 크게·보내기 / 파인더 / 닫기', () => {
    expect(lockerMenu({ kind: 'tab', inLocker: true })).toEqual([['big', 'send'], ['reveal'], ['close']]);
  });
  it('보관함 밖 파일 탭 — 파인더 대신 보관함에 넣기', () => {
    expect(lockerMenu({ kind: 'tab', inLocker: false })).toEqual([['big', 'send'], ['keep'], ['close']]);
  });
});

// 2026-10-12 나무 칸을 없앴다(사용자 "이제 필요 없겠다") — 다른 폴더로 옮기는 길: 끌기(폴더 카드·경로 칸) + 우클릭 '옮기기 → 폴더 고르기'
describe('옮기기', () => {
  it('보관함 안 파일(집·바로가기)과 폴더는 옮기기', () => {
    expect(lockerMenu({ kind: 'file', entry: own, folders: 0 }).flat()).toContain('move');
    expect(lockerMenu({ kind: 'file', entry: { ...own, link: true }, folders: 0 }).flat()).toContain('move');
    expect(lockerMenu({ kind: 'folder' }).flat()).toContain('move');
  });
  it('보관함 밖 파일·원본 없는 바로가기는 옮기기 없음', () => {
    expect(lockerMenu({ kind: 'file', entry: null, folders: 2 }).flat()).not.toContain('move');
    expect(lockerMenu({ kind: 'file', entry: { ...own, link: true, gone: true }, folders: 2 }).flat()).not.toContain('move');
  });
});

describe('moveTargets — 옮길 수 있는 폴더', () => {
  const folders = [{ rel: '자료' }, { rel: '자료/10월' }, { rel: '자료/10월/세부' }, { rel: '견적' }];
  it('맨 위(보관함) + 내 폴더, 지금 있는 폴더는 빼고', () => {
    expect(moveTargets('자료/x.md', folders)).toEqual(['', '자료/10월', '자료/10월/세부', '견적']);
    expect(moveTargets('x.md', folders)).toEqual(['자료', '자료/10월', '자료/10월/세부', '견적']);
  });
  it('폴더는 자기 자신·자기 안으로 못 간다', () => {
    expect(moveTargets('자료/10월', folders)).toEqual(['', '견적']);
  });
});

// 맥 폴더 연결(2026-10-12 사용자 "스크린샷을 매번 파인더로 열어서 주는 게 귀찮다") — 원본이 집, 보관함엔 바로가기 폴더만
describe('lockerMenu — 맥 폴더 연결', () => {
  it('연결 폴더 — 열기 / 이름·옮기기 / 파인더 / 연결 풀기(휴지통 아님)', () => {
    expect(lockerMenu({ kind: 'folder', link: 'ok' })).toEqual([['open'], ['move', 'rename'], ['reveal'], ['disconnect']]);
  });
  it('원본 폴더가 없는 연결 — 다시 연결이 뜨고 파인더는 없다', () => {
    expect(lockerMenu({ kind: 'folder', link: 'gone' })).toEqual([['reconnect'], ['rename'], ['disconnect']]);
  });
  // 2026-10-12 사용자 "스크린샷 골라서 지우려는데" — 연결 폴더 안도 맥 휴지통(되살릴 수 있다)만은 열린다
  it('연결 폴더 안쪽 폴더 — 열기·파인더·휴지통(이름·옮기기 없음)', () => {
    expect(lockerMenu({ kind: 'folder', ro: true })).toEqual([['open'], ['reveal'], ['trash']]);
  });
  it('연결 폴더 안 파일 — 열기·보내기 / 바로가기·보관함에 넣기 / 파인더 / 휴지통 (이름·옮기기 없음)', () => {
    expect(lockerMenu({ kind: 'file', entry: { ...own, ro: true }, folders: 2 })).toEqual([['open', 'big', 'send'], ['alias', 'keep'], ['reveal'], ['trash']]);
    expect(flat(lockerMenu({ kind: 'file', entry: { ...own, ro: true }, folders: 2 }))).not.toContain('rename');
    expect(flat(lockerMenu({ kind: 'file', entry: { ...own, ro: true }, folders: 0 }))).not.toContain('alias');
  });
});

describe('팀 보관함에 올리기(10-28 사용자 "참모 보관함 파일을 팀 보관함으로 못 옮긴다")', () => {
  const own = { link: false, gone: false, vers: 1, givenBack: false };
  it('든 팀이 있으면 파일 첫 줄 보내기 다음에 — 바로가기도(원본 내용이 올라간다)', () => {
    expect(lockerMenu({ kind: 'file', entry: own, folders: 0, teams: true })[0]).toEqual(['open', 'big', 'send', 'team']);
    expect(lockerMenu({ kind: 'file', entry: { ...own, link: true }, folders: 0, teams: true })[0]).toEqual(['open', 'big', 'send', 'team']);
    expect(lockerMenu({ kind: 'file', entry: null, folders: 0, teams: true })[0]).toEqual(['open', 'big', 'send', 'team']);
  });
  it('팀이 없거나 원본이 없는 바로가기면 없다', () => {
    expect(lockerMenu({ kind: 'file', entry: own, folders: 0 }).flat()).not.toContain('team');
    expect(lockerMenu({ kind: 'file', entry: { ...own, link: true, gone: true }, folders: 0, teams: true }).flat()).not.toContain('team');
  });
});
