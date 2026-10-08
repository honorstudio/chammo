import { describe, expect, it } from 'vitest';
import { pickKind, queueShow, showPlace, traceLine } from './spaceJump';
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

describe('queueShow — 다른 참모 탭에 넣어 둔 화면(그 탭으로 가면 거기 떠 있다)', () => {
  const f = { path: '/p/doc.md', ts: '2026-10-06T03:00:00Z', by: 'orch-b' };
  const img = { path: '/p/shot.png', ts: '2026-10-06T03:00:00Z', by: 'orch-b' };
  it('기억한 화면이 없으면 그 참모 대시보드 위에 — md 는 문서 페이지로', () => {
    expect(queueShow(undefined, 'o:orch-b', f, true)).toEqual({ pick: 'd:/p/doc.md', modal: null, sheet: [] });
  });
  it('짚을 곳이 있으면 그 탭에 갔을 때 반짝이게 같이 넣는다', () => {
    const at = { line: 3, lineEnd: 4 };
    expect(queueShow(undefined, 'o:orch-b', { ...f, at }, true).focus).toEqual({ path: '/p/doc.md', at, key: f.ts });
  });
  it('그림·시안은 보던 그 탭 화면 위 미리보기로', () => {
    const r = queueShow({ pick: 'p:/dev/x', modal: null, scroll: 120 }, 'o:orch-b', img, false);
    expect(r.pick).toBe('p:/dev/x');
    expect(r.modal).toEqual(img);
    expect(r.scroll).toBe(120);
  });
  it('그 탭이 사무실이면 사무실을 떠나지 않는다 — md 는 사무실 위 창에 쌓는다', () => {
    const r = queueShow({ pick: OFFICE, modal: null, sheet: ['s:abc'] }, 'o:orch-b', f, true);
    expect(r.pick).toBe(OFFICE);
    expect(r.sheet).toEqual(['s:abc', 'd:/p/doc.md']);
  });
  it('여러 번 띄우면 마지막 것이 남는다', () => {
    const a = queueShow(undefined, 'o:orch-b', f, true);
    const b = queueShow(a, 'o:orch-b', { ...f, path: '/p/two.md' }, true);
    expect(b.pick).toBe('d:/p/two.md');
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
