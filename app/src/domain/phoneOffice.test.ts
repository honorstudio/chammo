import { describe, expect, it } from 'vitest';
import { gachaDeco, officeAlert, officeDot, officeList, officeShape, parseOffice, phoneRoom, phoneSeat, ringOf, safeDoing, talkTargets, tapKind } from './phoneOffice';
import officeSrc from '../ui/mobile/PhoneOffice.tsx?raw';
import appSrc from '../ui/mobile/MobileApp.tsx?raw';
import { EMPTY_GACHA } from './gacha';
import { planRoom } from './office';
import type { Session } from './session';

const sess = (o: Partial<Session> & { id: string }): Session => ({ name: '', project: 'p', cwd: '/d/p', state: 'idle', kind: 'background', ...o }) as Session;

describe('parseOffice — 맥 앱이 쓴 사무실 모양(/api/office)', () => {
  it('아는 칸만, 모양이 틀린 칸은 버린다', () => {
    const s = parseOffice(JSON.stringify({ slots: ['a', null, 3], boss: 'fire_cG', skin: 'neon', furn: ['furn.plant', 1], placed: { 'furn.plant': [1, 2], x: 'bad', y: null }, deco: { hat: 'hat.cap', hasCat: true, palIds: ['friend.dog', 2], evil: { a: 1 } } }));
    expect(s).toEqual({ slots: ['a', null], boss: 'fire_cG', skin: 'neon', furn: ['furn.plant'], placed: { 'furn.plant': [1, 2], y: null }, deco: { hat: 'hat.cap', hasCat: true, palIds: ['friend.dog'] } });
  });
  it('비었거나 깨졌으면 기본 방(나무·곰)', () => {
    expect(parseOffice('{}')).toEqual({ slots: undefined, boss: 'bear', skin: 'wood', furn: [], placed: {}, deco: {} });
    expect(parseOffice('{깨짐').skin).toBe('wood');
  });
  it('맥이 쓰는 모양(officeShape)을 폰이 그대로 읽는다 — 커피 걷기는 첫 판 빼서 안 싣는다', () => {
    const shape = officeShape({ slots: ['a'], boss: 'fire_cG', skin: 'mint', furn: ['furn.plant'], placed: { 'furn.plant': [2, 3] }, deco: { hat: 'hat.cap', coffee: true, dance: false } });
    expect(shape.deco).toEqual({ hat: 'hat.cap', dance: false });
    expect(parseOffice(JSON.stringify(shape))).toEqual({ ...shape, slots: ['a'] });
  });
});

describe('safeDoing — 머리 위 하는 일 한 줄은 거름을 지나 폰에', () => {
  it('도구 이름 + 대상, mcp 앞머리는 뗀다', () => {
    expect(safeDoing('Edit', 'booking.ts')).toBe('Edit booking.ts');
    expect(safeDoing('mcp__playwright__browser_click', 'Submit')).toBe('browser_click Submit');
  });
  it('키·토큰처럼 생긴 대상은 도구 이름만', () => {
    const fake = ['sk', 'ant', 'api03', 'x'.repeat(30)].join('-');
    expect(safeDoing('Bash', `curl -H "x-api-key: ${fake}"`)).toBe('Bash');
    expect(safeDoing('Bash', 'export STRIPE_SECRET=abc')).toBe('Bash');
    expect(safeDoing('Bash', 'echo 비밀번호 1234')).toBe('Bash');
    expect(safeDoing('Bash', `git remote set-url origin https://${['gh', 'p_'].join('')}${'A1b2'.repeat(9)}@github.com/x`)).toBe('Bash');
    expect(safeDoing('Bash', 'pnpm render')).toBe('Bash pnpm render');
  });
});

describe('phoneSeat — 폰 세션 → 사무실 자리(데스크톱 seat 와 같은 판단)', () => {
  const s = sess({ id: 'a1', name: 'acme-shop', project: 'acme-shop', startedAt: 5 } as Partial<Session> & { id: string });
  it('일하는 중이면 지시 뒤에 부른 도구로 행동·한 줄', () => {
    const seat = phoneSeat(s, 'working', { prompt: { ts: '2026-10-23T01:00:00Z', text: '' }, tool: { name: 'Edit', target: 'booking.ts', ts: '2026-10-23T01:00:05Z' } });
    expect(seat).toMatchObject({ id: 'a1', label: 'acme-shop', project: 'acme-shop', status: 'working', act: 'type', doing: 'Edit booking.ts' });
  });
  it('옛 도구(지시보다 앞)·일 안 하는 중엔 한 줄 없음', () => {
    expect(phoneSeat(s, 'working', { prompt: { ts: '2026-10-23T02:00:00Z', text: '' }, tool: { name: 'Edit', target: 'x', ts: '2026-10-23T01:00:00Z' } }).doing).toBeUndefined();
    expect(phoneSeat(s, 'done', { tool: { name: 'Edit', target: 'x', ts: '2026-10-23T01:00:00Z' } })).not.toHaveProperty('act');
  });
  it('세션 브라우저가 사람을 부르면 human, 이름표는 따로 줄 수 있다(참모 별명)', () => {
    expect(phoneSeat(s, 'idle', undefined, { human: '로그인 코드', label: '참모-2' })).toMatchObject({ human: '로그인 코드', label: '참모-2' });
  });
});

describe('officeList — 방 아래 세션 줄', () => {
  const room = planRoom(
    [{ id: 'o', label: '참모', project: 'hq', status: 'working', startedAt: 0 }],
    [
      { id: 'w', label: 'acme-shop', project: 'acme-shop', status: 'working', startedAt: 1 },
      { id: 'q', label: 'pet-diary', project: 'pet-diary', status: 'asks', startedAt: 2 },
      { id: 'd', label: 'ops', project: 'ops', status: 'done', startedAt: 3 },
      { id: 'h', label: 'pixel-blog', project: 'pixel-blog', status: 'idle', startedAt: 4, human: '' },
    ],
    'bear',
  );
  it('사람 필요 → 물어봄 → 일하는 중만 줄로, 나머지는 접는다(반장은 빼고)', () => {
    const { rows, rest } = officeList(room.desks);
    expect(rows.map((d) => d.id)).toEqual(['h', 'q', 'w']);
    expect(rest.map((d) => d.id)).toEqual(['d']);
  });
  it('머리 아이콘 점 — 사람 필요·물어봄이 있을 때만', () => {
    expect(officeAlert(room.desks)).toBe(true);
    expect(officeAlert(room.desks.filter((d) => d.id !== 'q' && d.id !== 'h'))).toBe(false);
  });
});

describe('phoneRoom — 폰 재료로 데스크톱과 같은 방', () => {
  const hq = '/hq';
  const sessions = [
    sess({ id: 'o1', name: '참모', project: 'hq', cwd: hq, startedAt: 1 } as Partial<Session> & { id: string }),
    sess({ id: 'w1', name: 'acme-shop', project: 'acme-shop', cwd: '/d/acme-shop', state: 'working', startedAt: 2 } as Partial<Session> & { id: string }),
    sess({ id: 'w2', name: 'pet-diary', project: 'pet-diary', cwd: '/d/pet-diary', startedAt: 3 } as Partial<Session> & { id: string }),
  ];
  const base = { sessions, hqDir: hq, statusOf: () => 'idle' as const, actOf: () => undefined, humanOf: () => undefined, labelOf: (s: Session) => s.name };
  it('참모는 반장 자리(맥이 준 반장 그림), 하위 세션은 앞줄', () => {
    const r = phoneRoom({ ...base, shape: parseOffice(JSON.stringify({ boss: 'fire_cG' })) });
    const boss = r.desks.find((d) => d.boss)!;
    expect([boss.id, boss.spr, boss.label]).toEqual(['o1', 'fire_cG', '참모']);
    expect(r.desks.filter((d) => !d.boss).map((d) => d.id).sort()).toEqual(['w1', 'w2']);
  });
  it('맥 자리표대로 앉는다 — 빈 자리(null)는 빈 책상', () => {
    const r = phoneRoom({ ...base, shape: parseOffice(JSON.stringify({ slots: ['w2', null, 'w1'] })) });
    const front = r.desks.filter((d) => !d.boss);
    expect(front.map((d) => (d.empty ? '-' : d.id))).toEqual(['w2', '-', 'w1']);
  });
  it('사람 필요·상태가 책상에 실린다', () => {
    const r = phoneRoom({ ...base, statusOf: (s) => (s.id === 'w2' ? 'asks' : 'idle'), humanOf: (s) => (s.id === 'w1' ? '로그인 코드' : undefined), shape: parseOffice('{}') });
    expect(r.desks.find((d) => d.id === 'w2')!.st).toBe('asks');
    expect(r.desks.find((d) => d.id === 'w1')!.human).toBe('로그인 코드');
  });
});

describe('gachaDeco — 장착한 것 → 방 장식(데스크톱·폰 같은 것)', () => {
  it('장착·가진 펫 친구', () => {
    const g = { ...EMPTY_GACHA, owned: { 'friend.cat': 1 }, equip: { hat: 'hat.cap', action: 'action.dance' } };
    expect(gachaDeco(g)).toMatchObject({ hat: 'hat.cap', dance: true, coffee: false, action: 'action.dance', hasCat: true, palIds: [] });
  });
});

describe('officeDot — 홈 머리 사무실 아이콘 점(꼬리 없이 목록만)', () => {
  const live = (pid: number, ask: boolean) => ({ profile: 'p', pid: 1, sessionPid: pid, url: '', title: '', tabs: [], tool: '', toolAt: 0, busy: false, ts: 0, ask: ask ? { reason: '로그인', at: 1 } : null });
  const w = sess({ id: 'w', project: 'acme-shop', cwd: '/d/acme-shop', state: 'working', procPid: 7 } as Partial<Session> & { id: string });
  it('확인창에 멈췄거나 세션 브라우저가 사람을 부르면', () => {
    expect(officeDot([w], '/hq', [])).toBe(false);
    expect(officeDot([{ ...w, state: 'blocked' }], '/hq', [])).toBe(true);
    expect(officeDot([w], '/hq', [live(7, true)])).toBe(true);
    expect(officeDot([w], '/hq', [live(7, false)])).toBe(false);
  });
});

describe('사무실에서 참모 바꿔 말하기(10-23 사용자 "바로바로 참모 바꿔가면서 채팅")', () => {
  const room = planRoom(
    [
      { id: 'o1', label: '참모', project: 'hq', status: 'working', startedAt: 0 },
      { id: 'o2', label: '디자인', project: 'hq', status: 'idle', startedAt: 1 },
      { id: 'o3', label: '기획', project: 'hq', status: 'asks', startedAt: 2 },
    ],
    [
      { id: 'w', label: 'acme-shop', project: 'acme-shop', status: 'working', startedAt: 3 },
      { id: 'd', label: 'ops', project: 'ops', status: 'done', startedAt: 4 },
    ],
    'bear',
  );
  const orchIds = ['o1', 'o2', 'o3'];
  it('talkTargets — 참모 자리(반장 포함)를 방 순서대로, 프로젝트 세션은 빼고', () => {
    expect(talkTargets(room.desks, orchIds).map((d) => d.id)).toEqual(['o1', 'o2', 'o3']);
  });
  it('officeList 에 참모를 빼면 참모는 줄·접힌 줄 어디에도 없다(위 참모 줄에서 고른다)', () => {
    const { rows, rest } = officeList(room.desks, new Set(orchIds));
    expect([...rows, ...rest].map((d) => d.id).sort()).toEqual(['d', 'w']);
  });
  it('tapKind — 참모면 말 상대 바꾸기, 나머지는 세션(엿보기)', () => {
    expect(tapKind('o2', orchIds)).toBe('orch');
    expect(tapKind('w', orchIds)).toBe('session');
  });
  it('ringOf — 고른 프로젝트 세션이 있으면 그것, 없으면 지금 말하는 참모에 고리', () => {
    expect(ringOf(null, 'o2', orchIds)).toBe('o2');
    expect(ringOf('w', 'o2', orchIds)).toBe('w');
    expect(ringOf('o3', 'o2', orchIds)).toBe('o2'); // 참모 고르기는 곧 말 상대 바꾸기라 고리는 지금 참모
  });
});

describe('사무실 화면 연결(소스)', () => {
  it('사무실은 참모를 누르면 사무실을 안 떠나고 말 상대만 바꾼다', () => {
    expect(officeSrc).toMatch(/onTalk\(/);
    expect(officeSrc).not.toMatch(/onOrch/);
    // MobileApp: 사무실 onTalk 는 화면(view)·시트(snap)를 안 건드린다
    const m = /onTalk=\{\(id\) => \{([^}]*)\}\}/.exec(appSrc);
    expect(m, 'MobileApp 에 onTalk').toBeTruthy();
    expect(m![1]).not.toMatch(/setView|setSnap/);
    expect(m![1]).toMatch(/talkTo\(id\)/);
  });
  it('폰 전체 지금 참모를 바꾼다(사무실을 나가도 그 참모) — 고르기와 같은 기억(remember)', () => {
    expect(appSrc).toMatch(/const talkTo = \(id: string\) => \{ remember\(id\); setPick\(id\); \}/);
  });
});
