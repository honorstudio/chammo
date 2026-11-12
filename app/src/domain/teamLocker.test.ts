import { describe, expect, it } from 'vitest';
import roomBitsSrc from '../ui/team/RoomBits.tsx?raw';
import { keyWaitNote, lockedFiles, allFolders, canPurge, othersOf, folderFiles, crumbsOf, dirId, dropPlan, lockerUps, upNote, kidFolders, moveTargets, renamedPath, fmtBytes, inPlace, inRoom, thumbKind, phoneView, isTeamCache, opensInSpace, runAskName, readSort, sortItems, SORTS, usageText, whenText, type LockerItem, type LockerUpload } from './teamLocker';

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
    const items = [it0({ id: 'a', room: 'r1', at: 1 }), it0({ id: 'b', room: 'r1', name: 'b.pdf', at: 5 }), it0({ id: 'c', room: 'r2', at: 3 }), it0({ id: 'd', at: 9 }), it0({ id: 'e', room: 'r1', state: 'trash', at: 2 }), it0({ id: 'f', room: 'r1', kind: 'avatar' })];
    expect(inRoom(items, 'r1').map((i) => i.id)).toEqual(['b', 'a']);
    expect(inRoom(items, 'r1', true).map((i) => i.id)).toEqual(['e']);
    expect(inRoom(items, '')).toEqual([]);
  });
  // 11-08 사용자 "DM 에서 파일 중복으로 오는거" — 팀 DM 보관함에 같은 사진·md 가 2~3벌(내용 해시 같음, 말에 붙은 건 한 벌).
  // 옛 판(0.4.8 이하)이 못 보낸 첨부 칩을 결과 전에 비워, 다시 넣을 때마다 새로 올린 사본이다
  it('대화 파일 보기 — 같은 사람이 하루 안에 올린 같은 이름·같은 크기 사본(옛 판 다시 올리기)은 최신 하나로 접고 숨은 것을 twins 로', () => {
    const H = 3600 * 1000;
    const items = [
      it0({ id: 'p1', room: 'r1', name: '떡 정면.png', size: 1100, at: 1 * H }),
      it0({ id: 'p2', room: 'r1', name: '떡 정면.png', size: 1100, at: 1 * H + 300_000 }),
      it0({ id: 'p3', room: 'r1', name: '떡 정면.png', size: 1100, at: 1 * H + 420_000 }),
      it0({ id: 'm1', room: 'r1', name: '후보.md', size: 269, at: 2 * H }),
      it0({ id: 'm2', room: 'r1', name: '후보.md', size: 269, at: 2 * H + 60_000 }),
    ];
    const shown = inRoom(items, 'r1');
    expect(shown.map((i) => i.id)).toEqual(['m2', 'p3']);
    expect(shown.find((i) => i.id === 'p3')?.twins?.sort()).toEqual(['p1', 'p2']);
    expect(shown.find((i) => i.id === 'm2')?.twins).toEqual(['m1']);
  });
  it('대화 파일 보기 — 다른 사람·다른 크기·다른 이름·하루 넘게 떨어진 것·다른 방·다른 상태는 안 접는다', () => {
    const D = 24 * 3600 * 1000;
    const base = { room: 'r1', name: 'a.jpg', size: 10 };
    const items = [
      it0({ ...base, id: 'k', at: 3 * D }),
      it0({ ...base, id: 'other-person', byMember: 'm2', by: '다른 사람', at: 3 * D - 1 }),
      it0({ ...base, id: 'other-size', size: 11, at: 3 * D - 2 }),
      it0({ ...base, id: 'other-name', name: 'b.jpg', at: 3 * D - 3 }),
      it0({ ...base, id: 'day-later', at: 3 * D - D - 1 }),
      it0({ ...base, id: 'other-room', room: 'r2', at: 3 * D - 4 }),
      it0({ ...base, id: 'in-trash', state: 'trash', at: 3 * D - 5 }),
    ];
    expect(inRoom(items, 'r1').map((i) => i.id)).toEqual(['k', 'other-person', 'other-size', 'other-name', 'day-later']);
    expect(inRoom(items, 'r1').every((i) => !i.twins?.length)).toBe(true);
    expect(inRoom(items, 'r1', true).map((i) => i.id)).toEqual(['in-trash']);
  });
  it('대화 파일 보기 — 남길 하나는 열 수 있는 것(잠긴 줄 why 는 뒤로), 휴지통 안 쌍둥이도 접는다', () => {
    const items = [
      it0({ id: 'locked-new', room: 'r1', why: '열쇠 기다림', at: 9 }),
      it0({ id: 'open-old', room: 'r1', at: 5 }),
      it0({ id: 't1', room: 'r1', state: 'trash', at: 3 }),
      it0({ id: 't2', room: 'r1', state: 'trash', at: 4 }),
    ];
    expect(inRoom(items, 'r1').map((i) => [i.id, i.twins])).toEqual([['open-old', ['locked-new']]]);
    expect(inRoom(items, 'r1', true).map((i) => [i.id, i.twins])).toEqual([['t2', ['t1']]]);
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
    for (const n of ['간판.ai', 'a.zip', 'b.sketch', 'c.psd', 'http://x.com/a']) expect([n, opensInSpace(n)]).toEqual([n, false]);
  });
  // d.exe 를 '기본 앱'으로 못 박아 두던 자리(보안 점검 H-1) — 스페이스 밖이어도 바로 안 간다, Rust 가 needs-run-ok 로 막고 글자 확인 뒤에만(openTeamFile.test)
  it('실행될 수 있는 형식은 Rust 관문의 답에서 진짜 이름을 읽어 묻는다', () => {
    expect(runAskName('needs-run-ok:계약서.exe')).toBe('계약서.exe');
    expect(runAskName('Error: needs-run-ok:a.pkg')).toBe('a.pkg');
    expect(runAskName(new Error('needs-run-ok:a.pkg'))).toBe('a.pkg');
    expect(runAskName('못 받았어')).toBeNull();
    expect(runAskName(undefined)).toBeNull();
  });
  it('이름의 보이지 않는 글자를 빼고 보여 준다 — 오른쪽→왼쪽 표시로 .exe 를 .pdf 처럼 꾸미지 못하게', () => {
    expect(runAskName(`needs-run-ok:계약서${String.fromCharCode(0x202e)}fdp.exe`)).toBe('계약서fdp.exe');
  });
  it('풀어 둔 자리(데이터 폴더 team-locker-peek) 파일만 팀 파일 — 내려받기 단추가 붙는다', () => {
    expect(isTeamCache('/h/.chammo/team-locker-peek/t1/회의록.txt')).toBe(true);
    expect(isTeamCache('C:\\Users\\a\\.chammo\\team-locker-peek\\t1\\a.png')).toBe(true);
    expect(isTeamCache('/h/Documents/team-locker-peek.txt')).toBe(false);
    expect(isTeamCache('/h/Documents/Chammo/팀/a.txt')).toBe(false);
  });
});

describe('파일 풍선 이름 — 보이지 않는 글자(H-1)', () => {
  it('화면 이름은 plainText 를 지난다 — 대화 파일 이름은 보낸 사람이 봉한 글 그대로라서', () => {
    expect(roomBitsSrc).toMatch(/const name = plainText\(f\.name\)/);
    expect(roomBitsSrc).not.toMatch(/\{f\.name\}|\$\{f\.name\}/);
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
  it('기다리는 까닭 글 — 평소엔 빈 글', () => {
    expect(upNote({})).toBe('');
    expect(upNote({ note: '' })).toBe('');
    expect(upNote({ note: 'net' })).not.toBe('');
    expect(upNote({ note: 'busy' })).not.toBe(upNote({ note: 'net' }));
  });
  it('올리는 중 줄은 그 파일이 들어갈 폴더에서만 — 11-04 사용자: 올리는 중 카드가 폴더 안·맨 위 모든 화면에', () => {
    const up = (local: string, folder?: string): LockerUpload => ({ local, team: 't', room: '', name: 'a', done: 0, total: 1, error: '', kind: 'file', folder });
    const ups = [up('top', ''), up('old'), up('in', '영상'), up('deep', '영상/원본')];
    expect(lockerUps(ups, { folder: '' }).map((u) => u.local)).toEqual(['top', 'old']);
    expect(lockerUps(ups, { folder: '영상' }).map((u) => u.local)).toEqual(['in']);
    expect(lockerUps(ups, { folder: '영상/원본' }).map((u) => u.local)).toEqual(['deep']);
    expect(lockerUps(ups, {}).map((u) => u.local)).toEqual(['top', 'old', 'in', 'deep']);
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
    expect(thumbKind('회의.pdf', 2 * 1024 ** 2)).toBe('page');
    // 11-01: 워드·엑셀·PPT·영상·.ai·.psd 도 첫 장(맥 QuickLook)
    for (const n of ['제안서.docx', '단가.xlsx', '발표.pptx', 'c.mov', 'logo.ai', '표지.psd', '신청서.hwpx']) expect(thumbKind(n, 10), n).toBe('page');
    // 남이 올린 html 은 QuickLook 이 바깥 주소를 부를 수 있어 안 그린다 — zip·md·확장자 없음도 없음
    for (const n of ['시안.html', 'a.zip', 'b.md', 'noext', 'bgm.mp3', '옛.hwp']) expect(thumbKind(n, 10), n).toBeNull();
  });
  it('큰 파일은 안 받는다 — 그림 20MB·PDF 50MB(맥 peek 상한) 넘으면 없음, 크기 모름(0)은 받는다', () => {
    expect(thumbKind('a.png', 20 * 1024 ** 2)).toBe('image');
    expect(thumbKind('a.png', 20 * 1024 ** 2 + 1)).toBeNull();
    expect(thumbKind('a.pdf', 50 * 1024 ** 2 + 1)).toBeNull();
    expect(thumbKind('a.mp4', 20 * 1024 ** 2)).toBe('page');
    expect(thumbKind('a.mp4', 20 * 1024 ** 2 + 1)).toBeNull(); // 영상은 첫 프레임 하나에 통째로 풀어 20MB 까지
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

describe('남의 파일(11-01 QA M3)', () => {
  it('영구 지우기는 내 파일이거나 파일 정리 권한일 때만 보인다 — 서버 purgeFile 과 같은 판단', () => {
    expect(canPurge(it0({ mine: true }), false)).toBe(true);
    expect(canPurge(it0({ mine: false }), false)).toBe(false);
    expect(canPurge(it0({ mine: false }), true)).toBe(true);
  });
  it('휴지통·이름 바꾸기 전에 물을 남의 파일 — 올린 사람 이름과 함께', () => {
    const xs = [it0({ id: 'a', mine: true }), it0({ id: 'b', by: '민아' }), it0({ id: 'c', by: '준호' })];
    expect(othersOf(xs).map((i) => i.id)).toEqual(['b', 'c']);
    expect(othersOf([xs[0]!])).toEqual([]);
  });
});

describe('폰에서 누르면 보는 팀 파일(11-01 사용자 "팀 홈 최근 파일을 눌러도 안 열린다")', () => {
  const MB = 1024 ** 2;
  it('맥이 풀어 주는 그림(/api/team-file-image 가 받는 것) = image', () => {
    for (const n of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'IMG_1.HEIC', 'f.heif']) expect(phoneView({ name: n, size: MB }), n).toBe('image');
  });
  it('문서·글·엑셀·PPT 는 doc — 폰 파일 보기로 연다(11-06 사용자 "디엠 온 거 파일 볼 수가 없음")', () => {
    for (const n of ['오늘청소_커리큘럼.md', '메모.txt', '표.csv', '계약서.docx', '정산.xlsx', '주간회의.pptx', 'a.JSON']) expect(phoneView({ name: n, size: MB }), n).toBe('doc');
  });
  it('PDF 는 폰 보기가 받는 크기(10MB)까지 doc(모든 쪽), 넘으면 pdf(첫 장)', () => {
    expect(phoneView({ name: '견적서.pdf', size: 10 * MB })).toBe('doc');
    expect(phoneView({ name: '견적서.pdf', size: 10 * MB + 1 })).toBe('pdf');
  });
  it('볼 길이 없는 것 — null: 맥이 그림으로 안 주는 것(svg·tiff)·폰이 못 트는 영상·남이 올린 html(스크립트)·폰 서버가 이름으로 막는 키노트', () => {
    for (const n of ['a.svg', 'b.tiff', '이름없음', 'a.webm', 'b.mkv', 'c.avi', '시안.html', 'b.HTM', '발표.key', '묶음.zip']) expect(phoneView({ name: n, size: MB }), n).toBeNull();
  });
  it('영상(mp4·mov·m4v)은 크기 상관없이 video — 맥이 받아 풀고 영상 검토 길로(11-04 사용자 920MB mp4)', () => {
    for (const n of ['영상.mp4', 'b.MOV', 'c.m4v']) expect(phoneView({ name: n, size: MB }), n).toBe('video');
    expect(phoneView({ name: '현장 영상.mp4', size: 920 * MB })).toBe('video');
    expect(phoneView({ name: 'huge.mov', size: 30 * 1024 * MB })).toBe('video');
    expect(phoneView(it0({ name: 'a.mp4', size: 920 * MB, why: '열쇠 없음' }))).toBeNull();
  });
  it('50MB 넘으면 맥이 안 푼다(peek) — null', () => {
    expect(phoneView({ name: 'big.png', size: 50 * MB })).toBe('image');
    expect(phoneView({ name: 'big.png', size: 50 * MB + 1 })).toBeNull();
    expect(phoneView({ name: 'big.pdf', size: 51 * MB })).toBeNull();
  });
  it('못 여는 줄(why — 열쇠 없음 등)은 null', () => {
    expect(phoneView(it0({ name: 'a.png', why: '열쇠 없음' }))).toBeNull();
  });
});

// 11-02 새 팀원: 열쇠를 기다리는 게 '없음·빈 칸'처럼 보였다 — 홈·보관함·캘린더 같은 문구
describe('열쇠 기다림 안내', () => {
  it('0 이면 없음, 있으면 몇 개가 무엇을 기다리는지', () => {
    expect(keyWaitNote(0, 'post')).toBe('');
    expect(keyWaitNote(3, 'post')).toContain('글 3개');
    expect(keyWaitNote(3, 'post')).toContain('팀원 앱');
    expect(keyWaitNote(12, 'file')).toContain('파일 12개');
    expect(keyWaitNote(2, 'event')).toContain('일정 2개');
  });
  it('잠긴 파일 수 — 지운 것·휴지통·폴더 표시 줄·파일 아닌 줄(글·열쇠·프로필)은 빼고', () => {
    const f = (id: string, why = '', o: Partial<LockerItem> = {}) => ({ id, name: id, folder: '', size: 1, at: 1, kind: 'file', state: 'live', by: 'a', byMember: 'm', mine: false, why, deletedAt: null, ...o }) as LockerItem;
    expect(lockedFiles([f('a'), f('b', '열쇠 없음'), f('c', '열쇠 없음', { deletedAt: 5 }), f('d', '열쇠 없음', { dir: true }), f('e', '열쇠 없음', { kind: 'post' }), f('g', '열쇠 없음', { state: 'trash' })])).toBe(1);
  });
});

// 11-12 폰 팀 파일 받기·공유 — 길게 누르기 메뉴·보기 머리에 단추를 둘 파일
import { phoneSaveable } from './teamLocker';
describe('폰 팀 파일 받기 — 받을 수 있는 줄(11-12)', () => {
  const it0 = { id: 'A', name: '묶음.zip', size: 1000, cipher: 1000, at: 1, state: 'live' as const, kind: 'file', room: '', folder: '', by: '', byMember: '', mine: false, why: '', deletedAt: null };
  it('형식은 가리지 않는다 — zip·hwp·영상도', () => {
    expect(phoneSaveable(it0, false)).toBe(true);
    expect(phoneSaveable({ ...it0, name: '계약.hwp' }, false)).toBe(true);
    expect(phoneSaveable({ ...it0, name: '행사.mov', size: 150e6 }, false)).toBe(true);
  });
  it('못 여는(잠긴) 파일·휴지통·폴더 표시 줄은 아니다', () => {
    expect(phoneSaveable({ ...it0, why: '열쇠 기다림' }, false)).toBe(false);
    expect(phoneSaveable(it0, true)).toBe(false);
    expect(phoneSaveable({ ...it0, state: 'trash' }, false)).toBe(false);
    expect(phoneSaveable({ ...it0, dir: true }, false)).toBe(false);
  });
  it('200MB 넘으면 단추는 두되 판단은 맥 413 이 한다 — 여기선 크기로 막지 않는다', () => {
    expect(phoneSaveable({ ...it0, size: 900e6 }, false)).toBe(true);
  });
});
