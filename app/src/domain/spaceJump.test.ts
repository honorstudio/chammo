import { describe, expect, it } from 'vitest';
import { keepScroll, pickKind, queueShow, restoreTop, SCROLL_PANES, scrollKey, showBatch, showPlace, traceLine } from './spaceJump';
import { OFFICE } from './spaceOffice';

describe('showPlace — 띄운 파일을 지금 화면에 둘지, 그 참모 탭에 넣어 둘지', () => {
  it('지금 보는 참모가(또는 그 참모가 맡긴 세션이) 띄우면 바로 지금 화면에', () => {
    expect(showPlace('orch-a', 'orch-a')).toBe('here');
  });
  it('주인을 모르면 지금 화면에 — 예전 그대로', () => {
    expect(showPlace(null, 'orch-a')).toBe('here');
  });
  it('다른 참모가 띄우면 보던 스페이스는 그대로 — 그 참모 탭에 넣어 두고 알림만(2026-10-06 사용자 "사람이 바꾸기 전엔 안 바뀐다")', () => {
    expect(showPlace('orch-b', 'orch-a')).toBe('queue');
  });
  it('보는 참모가 아직 없으면(앱을 막 켬) 지금 화면에', () => {
    expect(showPlace('orch-b', undefined)).toBe('here');
  });
  it('메뉴로 다른 참모를 보는 중이어도 채팅 탭 참모(지금 대화 상대)가 띄우면 그 참모 화면으로 — 내가 시킨 것', () => {
    expect(showPlace('orch-a', 'orch-b', 'orch-a')).toBe('chat');
  });
  it('보는 참모도 채팅 탭도 아닌 참모면 넣어 두기', () => {
    expect(showPlace('orch-c', 'orch-b', 'orch-a')).toBe('queue');
  });
});

describe('queueShow — 다른 참모가 띄운 파일은 그 참모 탭 줄 새 탭에 넣어 둔다(그 참모로 가면 그 탭이 열려 있다)', () => {
  const f = { path: '/p/doc.md', ts: '2026-10-06T03:00:00Z', by: 'orch-b' };
  const pdf = { path: '/p/제안서.pdf', ts: '2026-10-06T03:00:00Z', by: 'orch-b' };
  it('기억한 화면이 없으면 그 참모 홈에서 새 탭으로 — md 도 탭', () => {
    const r = queueShow(undefined, null, 'orch-b', 'l:orch-b#h', f);
    expect(r.screen).toEqual({ pick: 'd:/p/doc.md', modal: null, sheet: [], focus: undefined, scroll: undefined });
    expect(r.hold).toEqual({ orch: 'orch-b', back: 'l:orch-b', tabs: ['/p/doc.md'] });
  });
  it('PDF·그림도 화면을 덮는 모달이 아니라 탭으로(2026-10-15 사용자 — 고객사D 제안서 PDF 가 창 전체를 덮었다)', () => {
    const r = queueShow({ pick: 'l:orch-b/dev/x', modal: null, scroll: 120 }, { orch: 'orch-b', back: 'l:orch-b', tabs: ['/p/a.md'] }, 'orch-b', 'l:orch-b#h', pdf);
    expect(r.screen.modal).toBeNull();
    expect(r.screen.pick).toBe('d:/p/제안서.pdf');
    expect(r.hold.tabs).toEqual(['/p/a.md', '/p/제안서.pdf']);
    expect(r.hold.back).toBe('l:orch-b/dev/x'); // 보관함 자리에서 넣었으면 보관함 탭은 거기로
  });
  it('사람이 그 참모 화면에 열어 둔 미리보기는 그대로 — 같은 파일이면 탭이 대신한다', () => {
    const big = { path: '/p/shot.png', ts: 't', by: '' };
    expect(queueShow({ pick: 'l:orch-b#h', modal: big }, null, 'orch-b', 'l:orch-b#h', pdf).screen.modal).toEqual(big);
    expect(queueShow({ pick: 'l:orch-b#h', modal: pdf }, null, 'orch-b', 'l:orch-b#h', pdf).screen.modal).toBeNull();
  });
  it('남의 탭 줄(다른 참모 hold)은 건드리지 않고 그 참모 것으로 새로', () => {
    expect(queueShow(undefined, { orch: 'orch-a', back: 'l:orch-a', tabs: ['/x'] }, 'orch-b', 'l:orch-b#h', pdf).hold).toEqual({ orch: 'orch-b', back: 'l:orch-b', tabs: ['/p/제안서.pdf'] });
  });
  it('짚을 곳이 있으면 그 탭에 갔을 때 반짝이게 같이 넣는다', () => {
    const at = { line: 3, lineEnd: 4 };
    expect(queueShow(undefined, null, 'orch-b', 'l:orch-b#h', { ...f, at }).screen.focus).toEqual({ path: '/p/doc.md', at, key: f.ts });
  });
  it('그 탭이 사무실이어도 탭으로 — 지금 화면에 띄울 때(present)와 같은 규칙', () => {
    const r = queueShow({ pick: OFFICE, modal: null, sheet: ['s:abc'] }, null, 'orch-b', 'l:orch-b#h', f);
    expect(r.screen.pick).toBe('d:/p/doc.md');
    expect(r.screen.sheet).toEqual(['s:abc']);
  });
  it('여러 번 띄우면 탭이 쌓이고 마지막 것이 열린다', () => {
    const a = queueShow(undefined, null, 'orch-b', 'l:orch-b#h', f);
    const b = queueShow(a.screen, a.hold, 'orch-b', 'l:orch-b#h', { ...f, path: '/p/two.md' });
    expect(b.screen.pick).toBe('d:/p/two.md');
    expect(b.hold.tabs).toEqual(['/p/doc.md', '/p/two.md']);
  });
});

describe('pickKind — 기록에는 화면 종류만(경로·이름 없이)', () => {
  it('접두만 남긴다', () => {
    expect(pickKind('o:c0ffee99')).toBe('o');
    expect(pickKind('d:/Users/me/secret.md')).toBe('d');
    expect(pickKind('rv:12')).toBe('rv');
    expect(pickKind('oh:')).toBe('home');
    expect(pickKind(OFFICE)).toBe('office');
    expect(pickKind('')).toBe('none');
  });
});

describe('traceLine — 스페이스가 바뀔 때마다 한 줄(다음에 또 튀면 이유가 남게)', () => {
  const base = { ts: '2026-10-06T03:53:00Z', why: 'pet', from: 'o:aaa', to: 'o:bbb', viewFrom: 'aaa', viewTo: 'aaa', chat: 'aaa' };
  it('남의 참모 화면(채팅 탭과 다른 참모 대시보드)으로 가면 other — 캡처의 모양', () => {
    const r = JSON.parse(traceLine(base));
    expect(r).toEqual({ ts: base.ts, why: 'pet', from: 'o', to: 'o', other: true });
  });
  it('채팅 탭 참모 자기 화면이면 other 가 없다', () => {
    expect(JSON.parse(traceLine({ ...base, to: 'o:aaa' })).other).toBeUndefined();
  });
  it('보는 참모가 바뀌면 view 표시, 그게 채팅 탭과 다르면 off — 숨은 탭이 스페이스를 끌고 가는 길', () => {
    const r = JSON.parse(traceLine({ ...base, why: 'follow', to: 'o:bbb', viewTo: 'bbb' }));
    expect(r.view).toBe(true);
    expect(r.off).toBe(true);
    expect(r.other).toBeUndefined(); // 보는 참모 자기 대시보드
  });
  it('경로·세션 번호·이름은 줄에 안 남는다', () => {
    const line = traceLine({ ...base, from: 'd:/Users/me/고객/계약.md', to: 's:deadbeef' });
    expect(line).not.toMatch(/Users|계약|deadbeef|aaa|bbb/);
  });
});

// 같은 탭 안에서 문서 X 를 내려 읽다 Y 를 띄우고 ⌘[ 로 돌아오면 X 가 맨 위였다 — 탭마다 하나만 기억해서(2026-10-11 하네스 재현, 불편 순위 14번)
describe('keepScroll·scrollKey — 문서 스크롤 자리는 참모 탭 + 화면마다', () => {
  it('같은 탭의 다른 문서, 다른 탭의 같은 문서는 따로', () => {
    const m = new Map<string, number>();
    keepScroll(m, scrollKey('orch-a', 'd:/x/X.md'), 1500);
    keepScroll(m, scrollKey('orch-a', 'd:/x/Y.md'), 600);
    keepScroll(m, scrollKey('orch-b', 'd:/x/X.md'), 300);
    expect(m.get(scrollKey('orch-a', 'd:/x/X.md'))).toBe(1500);
    expect(m.get(scrollKey('orch-a', 'd:/x/Y.md'))).toBe(600);
    expect(m.get(scrollKey('orch-b', 'd:/x/X.md'))).toBe(300);
  });
  it('맨 위(0)로 올려 두고 떠나면 기억을 지운다 — 옛 자리로 되살리지 않게', () => {
    const m = new Map<string, number>();
    keepScroll(m, scrollKey('orch-a', 'd:/x/X.md'), 1500);
    keepScroll(m, scrollKey('orch-a', 'd:/x/X.md'), 0);
    expect(m.has(scrollKey('orch-a', 'd:/x/X.md'))).toBe(false);
  });
  it('끝없이 늘지 않는다 — 오래된 것부터 빠진다', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 250; i++) keepScroll(m, scrollKey('orch-a', `d:/x/${i}.md`), 10 + i);
    expect(m.size).toBe(200);
    expect(m.has(scrollKey('orch-a', 'd:/x/0.md'))).toBe(false);
    expect(m.get(scrollKey('orch-a', 'd:/x/249.md'))).toBe(259);
  });
});

// 3초마다 읽는 show 기록에 두 참모 줄이 같이 오면 마지막 것만 봐서 앞 참모 문서가 그 탭에 안 들어갔다(2026-10-11 하네스, 불편 순위 4번 '문서가 엉뚱한 탭')
describe('showBatch — 한 번에 읽은 띄운 파일 여럿', () => {
  const own = (by: string) => (by.startsWith('orch-') ? by : by === 'sub-1' ? 'orch-a' : null);
  it('재현: 다른 참모 둘이 같이 띄우면 둘 다 각자 탭에 넣는다', () => {
    const r = showBatch([{ by: 'orch-a', path: 'A.md' }, { by: 'orch-b', path: 'B.md' }], own, 'orch-c', 'orch-c');
    expect(r.queue.map((q) => [q.owner, q.show.path])).toEqual([['orch-a', 'A.md'], ['orch-b', 'B.md']]);
    expect(r.here).toBeNull();
  });
  it('지금 보는 참모 것과 다른 참모 것이 섞이면 — 내 것은 지금 화면에, 남의 것은 그 탭에', () => {
    const r = showBatch([{ by: 'orch-a', path: 'A.md' }, { by: 'orch-c', path: 'C.md' }], own, 'orch-c', 'orch-c');
    expect(r.queue.map((q) => q.show.path)).toEqual(['A.md']);
    expect(r.here?.show.path).toBe('C.md');
    expect(r.here?.place).toBe('here');
  });
  it('지금 화면에 띄울 게 여럿이면 마지막 것 — 하위 세션 것은 잡은 참모 것으로', () => {
    const r = showBatch([{ by: 'orch-c', path: 'C1.md' }, { by: '', path: 'X.md' }, { by: 'sub-1', path: 'S.md' }], own, 'orch-c', 'orch-c');
    expect(r.queue.map((q) => q.show.path)).toEqual(['S.md']);
    expect(r.here?.show.path).toBe('X.md');
  });
  it('채팅 탭 참모 것은 그 탭으로 옮겨 띄운다(chat)', () => {
    const r = showBatch([{ by: 'orch-a', path: 'A.md' }], own, 'orch-c', 'orch-a');
    expect(r.here).toEqual({ show: { by: 'orch-a', path: 'A.md' }, place: 'chat', owner: 'orch-a' });
  });
});

// 2026-10-12 사용자: 보관함에서 파일 탭을 열어 보다 돌아오면 맨 위로 — 떠날 때 재는 칸이 문서 칸뿐이었다
describe('SCROLL_PANES·restoreTop — 탭을 바꿨다 오면 그 화면 스크롤 자리', () => {
  it('문서·보관함(기록 목록·폴더, 카드·목록 보기 같은 칸)·홈·세션 탭 옆칸을 잰다', () => {
    expect(SCROLL_PANES).toEqual(['.cv-doc-scroll', '.lk-page-wrap', '.hm-modes', '.sp-side']);
  });
  it('적어 둔 자리가 있으면 그 자리', () => expect(restoreTop(600, true)).toBe(600));
  it('없을 때 — 칸을 다시 쓰는 화면(보관함: 폴더를 바꿔도 같은 칸)은 맨 위로, 새로 그리는 화면은 손대지 않음', () => {
    expect(restoreTop(undefined, true)).toBe(0);
    expect(restoreTop(0, true)).toBe(0);
    expect(restoreTop(undefined, false)).toBeNull();
  });
});
