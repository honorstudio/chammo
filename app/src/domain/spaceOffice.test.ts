import { describe, expect, it } from 'vitest';
import { deskTarget, navPick, OFFICE, officePick, rememberSide, sheetBack, sheetOpen, showPick, spaceView, startPick } from './spaceOffice';

describe('officePick — 스페이스 머리 두 아이콘(사무실 / 스페이스)', () => {
  it('사무실을 켜면 보던 화면을 기억해 둔다', () => {
    expect(officePick('d:/a/b.md', 'office', '', 'o:1')).toEqual({ pick: OFFICE, before: 'd:/a/b.md' });
  });
  it('스페이스로 돌아가면 사무실 켜기 전 화면으로', () => {
    expect(officePick(OFFICE, 'space', 'd:/a/b.md', 'o:1')).toEqual({ pick: 'd:/a/b.md', before: '' });
  });
  it('켜기 전 화면을 모르면 그 참모 대시보드로', () => {
    expect(officePick(OFFICE, 'space', '', 'o:1')).toEqual({ pick: 'o:1', before: '' });
  });
  it('이미 그쪽이면 그대로', () => {
    expect(officePick('o:1', 'space', 'x', 'o:1')).toEqual({ pick: 'o:1', before: 'x' });
    expect(officePick(OFFICE, 'office', 'p:/r', 'o:1')).toEqual({ pick: OFFICE, before: 'p:/r' });
  });
  it('toggle(탑바 사무실 아이콘)은 반대쪽으로', () => {
    expect(officePick('o:1', 'toggle', '', 'o:1').pick).toBe(OFFICE);
    expect(officePick(OFFICE, 'toggle', 'p:/r', 'o:1').pick).toBe('p:/r');
  });
});

describe('showPick — 띄운 파일: 사무실이면 사무실을 떠나지 않는다(오피스 A 1단계, 예전엔 대시보드로 튕김)', () => {
  it('사무실 밖이면 md 는 문서 페이지로, 그림·시안은 보던 화면 위 미리보기', () => {
    expect(showPick('o:1', '/a/b.md', true)).toEqual({ pick: 'd:/a/b.md' });
    expect(showPick('p:/r', '/a/v1.html', false)).toEqual({ pick: 'p:/r' });
  });
  it('사무실이면 그림·시안은 사무실 위 미리보기 — 사무실 그대로', () => {
    expect(showPick(OFFICE, '/a/v1.html', false)).toEqual({ pick: OFFICE });
    expect(showPick(OFFICE, '/a/shot.png', false)).toEqual({ pick: OFFICE });
  });
  it('사무실이면 md 도 사무실 위 창으로', () => {
    expect(showPick(OFFICE, '/a/b.md', true)).toEqual({ pick: OFFICE, sheet: 'd:/a/b.md' });
  });
});

describe('사무실 위 창 기록(sheet) — 창 안에서 문서 링크를 타고 가면 뒤로 돌아올 수 있게', () => {
  it('열면 맨 위에 쌓인다', () => {
    expect(sheetOpen([], 's:a')).toEqual(['s:a']);
    expect(sheetOpen(['s:a'], 'd:/x.md')).toEqual(['s:a', 'd:/x.md']);
  });
  it('같은 게 맨 위면 그대로(같은 객체)', () => {
    const a = ['s:a'];
    expect(sheetOpen(a, 's:a')).toBe(a);
  });
  it('이미 아래 있으면 거기까지 줄여 맨 위로(돌고 돌아 쌓이지 않게)', () => {
    expect(sheetOpen(['s:a', 'd:/x.md', 'd:/y.md'], 's:a')).toEqual(['s:a']);
  });
  it('뒤로 = 한 칸 빼기, 하나뿐이면 닫힘(빈 목록)', () => {
    expect(sheetBack(['s:a', 'd:/x.md'])).toEqual(['s:a']);
    expect(sheetBack(['s:a'])).toEqual([]);
    expect(sheetBack([])).toEqual([]);
  });
});

describe('deskTarget — 사무실 책상·현황판 카드를 누르면(예전엔 세션 화면으로 사무실을 떠남)', () => {
  it('하위 세션 책상 = 사무실 위 창에 그 세션', () => {
    expect(deskTarget('w1', ['o1', 'o2'], 'o1')).toEqual({ sheet: 's:w1' });
  });
  it('다른 참모 책상 = 그 참모 채팅 탭', () => {
    expect(deskTarget('o2', ['o1', 'o2'], 'o1')).toEqual({ tab: 'o2' });
  });
  it('지금 탭 참모 책상 = 할 것 없음', () => {
    expect(deskTarget('o1', ['o1', 'o2'], 'o1')).toBeNull();
  });
});

describe('참모마다 마지막 고른 쪽 — 앱을 다시 켜도', () => {
  it('사무실을 고르면 office, 다른 화면이면 space 로 적는다', () => {
    const a = rememberSide({}, '참모-2', OFFICE);
    expect(a).toEqual({ '참모-2': 'office' });
    expect(rememberSide(a, '참모-2', 'd:/x.md')).toEqual({ '참모-2': 'space' });
  });
  it('시안 검토(c:)·하니터(h:)는 잠깐 덮는 화면이라 기억을 안 바꾼다 — 닫으면 사무실로 돌아오게', () => {
    const a = { '참모-2': 'office' as const };
    expect(rememberSide(a, '참모-2', 'c:/a/v1.html')).toBe(a);
    expect(rememberSide(a, '참모-2', 'h:')).toBe(a);
  });
  it('안 바뀌면 같은 객체(저장 안 하게)', () => {
    const a = { '참모-2': 'office' as const };
    expect(rememberSide(a, '참모-2', OFFICE)).toBe(a);
  });
  it('참모마다 따로', () => {
    const a = rememberSide(rememberSide({}, '참모-2', OFFICE), '참모-5', 'o:5');
    expect(a).toEqual({ '참모-2': 'office', '참모-5': 'space' });
  });
  it('처음 화면 — 사무실로 둔 참모는 사무실, 아니면 대시보드', () => {
    expect(startPick({ '참모-2': 'office' }, '참모-2', 'o:1')).toBe(OFFICE);
    expect(startPick({ '참모-2': 'office' }, '참모-5', 'o:5')).toBe('o:5');
    expect(startPick({}, '참모-2', 'o:1')).toBe('o:1');
  });
});

describe('spaceView — 머리 오른쪽 끝 세 칸(대시보드 · 펫 · 사무실), 한 자리에 고정', () => {
  it('사무실이면 office, 그 참모 대시보드에 펫 탭이 열렸으면 pet, 아니면 dash', () => {
    expect(spaceView(OFFICE, 'o1', 'o1')).toBe('office');
    expect(spaceView('o:o1', 'o1', 'o1')).toBe('pet');
    expect(spaceView('o:o1', null, 'o1')).toBe('dash');
    expect(spaceView('o:o1', 'o2', 'o1')).toBe('dash');
  });
  it('세 칸은 그 참모 대시보드·사무실에서만 — 문서·세션 화면엔 없음', () => {
    expect(spaceView('d:/a.md', null, 'o1')).toBeNull();
    expect(spaceView('s:x', null, 'o1')).toBeNull();
    expect(spaceView('o:o2', null, 'o1')).toBeNull();
  });
});

describe('기억 키를 세션 번호로 — 이름을 바꾸면 기억이 사라졌다(2026-10-03 QA 8번)', () => {
  it('키 여러 개면 앞에서부터 — 세션 번호 기억이 없으면 옛 이름 키', () => {
    expect(startPick({ '참모-3 · 셋째': 'office' }, ['f00d0006', '참모-3 · 셋째바뀜', '참모-3 · 셋째'], 'o:f00d0006')).toBe(OFFICE);
    expect(startPick({ 'f00d0006': 'space', '참모-3 · 셋째': 'office' }, ['f00d0006', '참모-3 · 셋째'], 'o:f00d0006')).toBe('o:f00d0006');
  });
});

describe('navPick — 왼쪽 목록에서 참모 이름을 눌렀을 때(2026-10-03 QA 7번: 누르면 사무실 기억이 대시보드로 덮였다)', () => {
  it('다른 참모를 누르면 그 참모가 마지막에 보던 쪽으로', () => expect(navPick('o:b', 'b', 'a', OFFICE)).toBe(OFFICE));
  it('지금 보는 참모 이름을 다시 누르면 대시보드(분명히 고른 것)', () => expect(navPick('o:a', 'a', 'a', OFFICE)).toBe('o:a'));
  it('참모 이름이 아닌 줄(문서·세션)은 누른 그대로', () => {
    expect(navPick('d:/x.md', 'b', 'a', OFFICE)).toBe('d:/x.md');
    expect(navPick('s:p1', undefined, 'a', 'o:p1')).toBe('s:p1');
  });
});
