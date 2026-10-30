import { describe, expect, it } from 'vitest';
import { allFolders, folderFiles, crumbsOf, dirId, dropPlan, lockerUps, kidFolders, moveTargets, renamedPath, fmtBytes, inPlace, inRoom, thumbKind, isTeamCache, opensInSpace, readSort, sortItems, SORTS, usageText, whenText, type LockerItem, type LockerUpload } from './teamLocker';

const it0 = (o: Partial<LockerItem>): LockerItem => ({ id: 'x', name: 'a.pdf', size: 1, cipher: 17, at: 0, state: 'live', kind: 'file', room: '', folder: '', by: '사용자', byMember: 'm1', mine: false, why: '', deletedAt: null, ...o });

describe('팀 보관함 화면 계산', () => {
  it('크기 글 — 바이트·KB·MB·GB, 소수 한 자리', () => {
    expect([fmtBytes(0), fmtBytes(900), fmtBytes(88 * 1024), fmtBytes(2.1 * 1024 ** 2), fmtBytes(3.6 * 1024 ** 3)]).toEqual(['0B', '900B', '88KB', '2.1MB', '3.6GB']);
  });
  it('사용량 — 쓴 것/한도와 비율(0~1)', () => {
    expect(usageText({ used: 3.6 * 1024 ** 3, reserved: 0, seats: 4, limit: 40 * 1024 ** 3 })).toEqual({ text: '3.6 / 40GB', ratio: 0.09 });
    expect(usageText({ used: 0, reserved: 0, seats: 0, limit: 0 }).ratio).toBe(0);
  });
  it('폴더 타일 — 지금 자리 바로 아래 폴더(가나다), 개수는 안쪽까지 파일 수. 대화 파일(DM·팀챗 첨부)·프로필 사진·휴지통은 안 센다(10-28 사용자 "디엠은 그 사용자랑만")', () => {
    const items = [it0({ id: '1', folder: '디자인' }), it0({ id: '2', folder: '견적' }), it0({ id: '3', folder: '견적/10월' }), it0({ id: '4', room: 'r1', folder: '견적' }), it0({ id: '5', kind: 'avatar', folder: '견적' }), it0({ id: '6', state: 'trash', folder: '견적' })];
    expect(kidFolders(items, '')).toEqual([{ key: '견적', name: '견적', n: 2 }, { key: '디자인', name: '디자인', n: 1 }]);
    expect(kidFolders(items, '견적')).toEqual([{ key: '견적/10월', name: '10월', n: 1 }]);
    expect(kidFolders(items, '디자인')).toEqual([]);
  });
  it('폴더 안 폴더 — 파일이 깊은 곳에만 있어도 위 폴더가 다 보인다(깊이 제한 없음), 옛 앱(0.4.3)의 한 단계 폴더는 맨 위 폴더', () => {
    const items = [it0({ id: '1', folder: 'a/b/c/d' }), it0({ id: '2', folder: '옛 폴더' })];
    expect(allFolders(items)).toEqual(['옛 폴더', 'a', 'a/b', 'a/b/c', 'a/b/c/d']); // 가나다(한글 먼저 — 참모 보관함과 같은 ko 정렬)
    expect(kidFolders(items, 'a/b').map((f) => [f.key, f.n])).toEqual([['a/b/c', 1]]);
    expect(kidFolders(items, '').map((f) => f.key)).toEqual(['옛 폴더', 'a']);
  });
  it('경로 줄 — 맨 위 다음 칸마다 그 자리 경로', () => {
    expect(crumbsOf('')).toEqual([]);
    expect(crumbsOf('견적/10월/초안')).toEqual([{ key: '견적', name: '견적' }, { key: '견적/10월', name: '10월' }, { key: '견적/10월/초안', name: '초안' }]);
  });
  it('폴더 이름 바꾸기는 마지막 칸만 — 위 폴더는 그대로', () => {
    expect([renamedPath('견적/10월', '11월'), renamedPath('견적', '계약')]).toEqual(['견적/11월', '계약']);
  });
  it('옮길 곳 — 맨 위 + 모든 폴더, 지금 자리와 옮기는 폴더 자신·그 안쪽은 뺀다', () => {
    const items = [it0({ id: '1', folder: 'a/b' }), it0({ id: '2', folder: 'c' })];
    expect(moveTargets(items, { from: 'a/b' })).toEqual(['', 'a', 'c']);
    expect(moveTargets(items, { from: '', dirs: ['a'] })).toEqual(['c']);
    expect(moveTargets(items, { from: 'a', dirs: ['a/b'] })).toEqual(['', 'c']);
  });
  it('대화 파일 보기 — 그 방 파일만(새것 먼저), 휴지통은 그 방 것만. 다른 방·팀 파일·빈 방 id 는 안 섞인다', () => {
    const items = [it0({ id: 'a', room: 'r1', at: 1 }), it0({ id: 'b', room: 'r1', at: 5 }), it0({ id: 'c', room: 'r2', at: 3 }), it0({ id: 'd', at: 9 }), it0({ id: 'e', room: 'r1', state: 'trash', at: 2 }), it0({ id: 'f', room: 'r1', kind: 'avatar' })];
    expect(inRoom(items, 'r1').map((i) => i.id)).toEqual(['b', 'a']);
    expect(inRoom(items, 'r1', true).map((i) => i.id)).toEqual(['e']);
    expect(inRoom(items, '')).toEqual([]);
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
  it('표시 줄은 폴더 타일(0개)로만 남고 개수엔 안 든다 — 빈 폴더 안 빈 폴더도', () => {
    expect(kidFolders([...items, it0({ id: 'd4', folder: '빈 폴더/안', dir: true, name: '' })], '')).toEqual([{ key: '견적', name: '견적', n: 1 }, { key: '빈 폴더', name: '빈 폴더', n: 0 }]);
  });
  it('표시 줄은 목록·휴지통 어디에도 줄로 안 나온다', () => {
    expect(inPlace(items, '견적').map((i) => i.id)).toEqual(['1']);
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

describe('폴더 칩에 끌어 놓기 — 옮기기·대화 파일은 복사(10-28 사용자 "주간회의 칩에 놓아도 반응이 없다")', () => {
  const items = [it0({ id: 'a', folder: '' }), it0({ id: 'b', folder: '주간회의' }), it0({ id: 'r1', room: 'room1' }), it0({ id: 'r2', room: 'room1', name: '회의.pdf' }), it0({ id: 'k', room: 'room1', why: '열쇠 없음' }), it0({ id: 'm', mine: false, by: '다른 사람' })];
  const find = (id: string) => items.find((i) => i.id === id);
  it('팀 보관함 파일은 옮긴다 — 이미 그 폴더면 빼고, 남이 올린 것도 옮긴다(서버가 팀원 누구나 meta 를 바꾸게 둔다)', () => {
    expect(dropPlan(['a', 'b', 'm'], '주간회의', find)).toEqual({ move: ['a', 'm'], copy: [], stay: 0, dirs: [], keep: [] });
  });
  it('대화 파일은 옮기지 않고 폴더로 복사한다 — 원본은 대화에 남는다', () => {
    expect(dropPlan(['r1', 'r2'], '주간회의', find)).toEqual({ move: [], copy: ['r1', 'r2'], stay: 0, dirs: [], keep: [] });
  });
  it('대화 파일을 맨 위(빈 폴더 이름)에 놓으면 복사하지 않고 남은 수만 센다 — 화면이 이유를 말한다', () => {
    expect(dropPlan(['r1', 'a'], '', find)).toEqual({ move: [], copy: [], stay: 1, dirs: [], keep: [] });
    expect(dropPlan(['b'], '', find, items)).toEqual({ move: ['b'], copy: [], stay: 0, dirs: [], keep: ['주간회의'] });
  });
  it('못 여는 파일·모르는 id 는 아무것도 안 한다', () => {
    expect(dropPlan(['k', 'zz'], '주간회의', find)).toEqual({ move: [], copy: [], stay: 0, dirs: [], keep: [] });
  });
});

describe('폴더 끌어 옮기기 — 파인더처럼(10-28 사용자 "폴더에 폴더도 가능해야")', () => {
  const items = [it0({ id: 'a', folder: '견적' }), it0({ id: 'b', folder: '견적/10월' }), it0({ id: 'c', folder: '계약' }), it0({ id: 'd', folder: '계약', dir: true, name: '' }), it0({ id: 'e', folder: '빈' , dir: true, name: '' })];
  const find = (id: string) => items.find((i) => i.id === id);
  it('폴더는 놓은 폴더 안으로 — 새 경로 = 놓은 곳/그 이름. 이미 거기·자기 안이면 안 옮긴다', () => {
    expect(dropPlan([dirId('견적/10월')], '계약', find, items).dirs).toEqual([{ from: '견적/10월', to: '계약/10월' }]);
    expect(dropPlan([dirId('견적/10월')], '견적', find, items).dirs).toEqual([]);
    expect(dropPlan([dirId('견적')], '견적/10월', find, items).dirs).toEqual([]);
    expect(dropPlan([dirId('견적')], '', find, items).dirs).toEqual([]);
    expect(dropPlan([dirId('계약')], '', find, items).dirs).toEqual([]);
  });
  it('마지막 것을 꺼내 비는 폴더엔 표시 줄을 남긴다(빈 폴더가 사라지지 않게) — 표시 줄이 이미 있거나 남는 게 있으면 안 남긴다', () => {
    expect(dropPlan(['b'], '', find, items).keep).toEqual(['견적/10월']);
    expect(dropPlan(['a'], '', find, items).keep).toEqual([], ); // 견적 안엔 10월이 남는다
    expect(dropPlan(['c'], '', find, items).keep).toEqual([]); // 계약은 표시 줄이 있다
    expect(dropPlan([dirId('견적/10월'), 'a'], '계약', find, items).keep).toEqual(['견적']);
  });
});

describe('보이는 건 사람이 올린 파일만 — 앱 안쪽 줄(프로필·사진·팀 홈 글·팀 참모 정의)은 안 샌다(10-28 사용자 "profile.json 112B")', () => {
  it('목록·폴더 칩·휴지통·대화 파일 보기 어디에도 kind file 밖은 안 나온다', () => {
    const inner = ['profile', 'avatar', 'post', 'agent'].map((kind, k) => it0({ id: `i${k}`, kind, name: `${kind}.json`, size: 112 }));
    const items = [it0({ id: 'f' }), ...inner, ...inner.map((i) => ({ ...i, id: `${i.id}t`, state: 'trash' as const })), ...inner.map((i) => ({ ...i, id: `${i.id}r`, room: 'r1' }))];
    expect(inPlace(items, '').map((i) => i.id)).toEqual(['f']);
    expect(inPlace(items, '', true)).toEqual([]);
    expect(inRoom(items, 'r1')).toEqual([]);
    expect(kidFolders(items, '')).toEqual([]);
    expect(allFolders(items)).toEqual([]);
  });
  it('올리는 중 줄 — 팀 보관함엔 kind file·방 없는 것만(옛 앱 줄은 kind 가 없으면 파일로), 휴지통·대화 파일 보기에선 안 보인다', () => {
    const up = (o: Partial<LockerUpload>): LockerUpload => ({ local: 'u', team: 't', room: '', name: 'a.pdf', done: 0, total: 1, error: '', ...o });
    const ups = [up({ local: 'a', kind: 'file' }), up({ local: 'b', kind: 'profile', name: 'profile.json', total: 112, error: 'x' }), up({ local: 'c', kind: 'avatar' }), up({ local: 'd', kind: 'post' }), up({ local: 'e', room: 'r1', kind: 'file' }), up({ local: 'f' })];
    expect(lockerUps(ups, {}).map((u) => u.local)).toEqual(['a', 'f']);
    expect(lockerUps(ups, { trash: true })).toEqual([]);
    expect(lockerUps(ups, { room: 'r1' })).toEqual([]);
  });
});

describe('폰 팀 보관함 — 중계 목록 그대로, 대화 파일은 안 보인다(10-28 사용자 "디엠은 그 사용자랑만")', () => {
  it('폰도 데스크톱과 같은 inPlace·kidFolders — 방에 붙인 파일은 팀 보관함 자리·폴더 수에 안 든다', () => {
    const items = [it0({ id: 'a', folder: '견적' }), it0({ id: 'b', folder: '견적', room: 'r1' }), it0({ id: 'c', room: 'r1' })];
    expect(inPlace(items, '').map((i) => i.id)).toEqual([]);
    expect(inPlace(items, '견적').map((i) => i.id)).toEqual(['a']);
    expect(kidFolders(items, '')).toEqual([{ key: '견적', name: '견적', n: 1 }]);
  });
});

describe('썸네일 — 대화 말풍선·대화 파일 보기·팀 보관함 카드가 같이 쓴다(10-28 사용자 "썸네일 없이 빈 네모")', () => {
  it('그림(png·jpg·heic·gif·webp)은 그림, PDF 는 첫 장, 그 밖은 없음', () => {
    for (const n of ['a.png', 'b.JPG', 'c.jpeg', 'd.heic', 'e.gif', 'f.webp']) expect(thumbKind(n, 79 * 1024), n).toBe('image');
    expect(thumbKind('회의.pdf', 2 * 1024 ** 2)).toBe('pdf');
    for (const n of ['logo.ai', 'a.zip', 'b.md', 'noext']) expect(thumbKind(n, 10), n).toBeNull();
  });
  it('큰 파일은 안 받는다 — 그림 20MB·PDF 50MB(맥 peek 상한) 넘으면 없음, 크기 모름(0)은 받는다', () => {
    expect(thumbKind('a.png', 20 * 1024 ** 2)).toBe('image');
    expect(thumbKind('a.png', 20 * 1024 ** 2 + 1)).toBeNull();
    expect(thumbKind('a.pdf', 50 * 1024 ** 2 + 1)).toBeNull();
    expect(thumbKind('a.png', 0)).toBe('image');
  });
});

describe('folderFiles — 팀 폴더째 내 참모에게(2026-10-30)', () => {
  const xs = [
    it0({ id: 'a', folder: '주간회의' }),
    it0({ id: 'b', folder: '주간회의/지난 회의' }),
    it0({ id: 'c', folder: '주간회의 사본' }),
    it0({ id: 'd', folder: '주간회의', state: 'trash' }),
    it0({ id: 'e', folder: '주간회의', room: 'g0' }),
    it0({ id: 'dir:주간회의', folder: '주간회의', dir: true, name: '' }),
    it0({ id: 'f', folder: '' }),
  ];
  it('그 폴더와 안쪽 폴더의 살아 있는 팀 파일만 — 이름이 비슷한 옆 폴더·휴지통·대화 파일·폴더 표시 줄은 뺀다', () => {
    expect(folderFiles(xs, '주간회의').map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('맨 위(빈 글)는 폴더가 아니라 빈 목록', () => {
    expect(folderFiles(xs, '')).toEqual([]);
  });
});
