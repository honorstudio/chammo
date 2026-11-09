import { describe, expect, it } from 'vitest';
import { gachaDeco, officeAlert, officeDot, officeList, officeShape, parseOffice, phoneRooms, phoneSeat, ringOf, safeDoing, talkTargets, tapKind } from './phoneOffice';
import officeSrc from '../ui/mobile/PhoneOffice.tsx?raw';
import appSrc from '../ui/mobile/MobileApp.tsx?raw';
import { EMPTY_GACHA } from './gacha';
import { planOffice, speciesFor, type OrchIn, type Seat } from './office';
import { newRoom } from './officeRoom';
import type { Session } from './session';

const sess = (o: Partial<Session> & { id: string }): Session => ({ name: '', project: 'p', cwd: '/d/p', state: 'idle', kind: 'background', ...o }) as Session;

describe('parseOffice — 맥 앱이 쓴 사무실 모양(/api/office)', () => {
  it('아는 칸만, 모양이 틀린 칸은 버린다', () => {
    const r = parseOffice(JSON.stringify({ offices: [{ lv: 1, furn: { 'furn.a': [1, 2], x: 'bad' } }], slots: [['a', null, 3]], skins: ['neon'], seats: { o: { office: 0, x: 1, y: 2, w: 2.4 }, bad: { x: 1 } }, assign: { p: 1, q: 'x' }, sprs: { o: 'a_bunny', z: 1 }, off: [{ id: 'i', name: 'n', label: 'l' }, { id: 1 }], deco: { hat: 'hat.cap', dance: 'no', palIds: ['friend.a', 1] }, coins: 99 }));
    expect(r.offices[0]).toMatchObject({ lv: 1, furn: { 'furn.a': [1, 2] } });
    expect(r.slots).toEqual([['a', null]]);
    expect(r.skins).toEqual(['neon']);
    expect(r.seats).toEqual({ o: { office: 0, x: 1, y: 2, w: 2.4 } });
    expect(r.assign).toEqual({ p: 1 });
    expect(r.sprs).toEqual({ o: 'a_bunny' });
    expect(r.off).toEqual([{ id: 'i', name: 'n', label: 'l' }]);
    expect(r.deco).toEqual({ hat: 'hat.cap', palIds: ['friend.a'] });
    expect(r).not.toHaveProperty('coins');
  });
  it('비었거나 깨졌으면 기본 방 하나', () => {
    for (const raw of ['{}', '{깨짐']) {
      const r = parseOffice(raw);
      expect(r.offices).toEqual([newRoom()]);
      expect(r.skins).toEqual(['wood']);
      expect(r.slots).toEqual([]);
    }
  });
  it('맥이 쓰는 모양(officeShape)을 폰이 그대로 읽는다 — 커피 걷기는 첫 판 빼서 안 싣는다', () => {
    const shape = officeShape({ offices: [newRoom()], slots: [['a']], skins: ['mint'], seats: {}, assign: {}, sprs: {}, off: [], deco: { hat: 'hat.cap', coffee: true, dance: false } });
    expect(shape.deco).toEqual({ hat: 'hat.cap', dance: false });
    expect(parseOffice(JSON.stringify(shape))).toEqual(shape);
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

const testRoom = (orchs: Seat[], workers: Seat[]) => planOffice({ room: { ...newRoom(), lv: 3 }, index: 0, orchs: orchs.map((o): OrchIn => ({ ...o, name: o.id })), workers });

describe('officeList — 방 아래 세션 줄', () => {
  const room = testRoom(
    [{ id: 'o', label: '참모', project: 'hq', status: 'working', startedAt: 0 }],
    [
      { id: 'w', label: 'acme-shop', project: 'acme-shop', status: 'working', startedAt: 1 },
      { id: 'q', label: 'pet-diary', project: 'pet-diary', status: 'asks', startedAt: 2 },
      { id: 'd', label: 'ops', project: 'ops', status: 'done', startedAt: 3 },
      { id: 'h', label: 'pixel-blog', project: 'pixel-blog', status: 'idle', startedAt: 4, human: '' },
    ],
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

describe('phoneRooms — 폰 재료로 데스크톱과 같은 방', () => {
  const hq = '/hq';
  const sessions = [
    sess({ id: 'o1', name: '참모', project: 'hq', cwd: hq, startedAt: 1 } as Partial<Session> & { id: string }),
    sess({ id: 'w1', name: 'acme-shop', project: 'acme-shop', cwd: '/d/acme-shop', state: 'working', startedAt: 2 } as Partial<Session> & { id: string }),
    sess({ id: 'w2', name: 'pet-diary', project: 'pet-diary', cwd: '/d/pet-diary', startedAt: 3 } as Partial<Session> & { id: string }),
  ];
  const base = { sessions, hqDir: hq, statusOf: () => 'idle' as const, actOf: () => undefined, humanOf: () => undefined, labelOf: (s: Session) => s.name };
  const front = (r: { desks: { boss?: boolean; gy: number }[] }) => r.desks.filter((d) => !d.boss && d.gy >= 3);
  it('참모는 고른 캐릭터로 반장 자리, 하위 세션은 직원 자리', () => {
    const r = phoneRooms({ ...base, shape: parseOffice(JSON.stringify({ sprs: { 참모: 'fire_cG' } })) })[0]!;
    const boss = r.desks.find((d) => d.boss)!;
    expect([boss.id, boss.spr, boss.label]).toEqual(['o1', 'fire_cG', '참모']);
    expect(r.desks.filter((d) => !d.empty && !d.boss).map((d) => d.id).sort()).toEqual(['w1', 'w2']);
  });
  it('맥 자리표대로 앉는다 — 빈 자리(null)는 빈 책상', () => {
    const r = phoneRooms({ ...base, shape: parseOffice(JSON.stringify({ slots: [['w2', null, 'w1']] })) })[0]!;
    expect(front(r).map((d) => ((d as { empty?: boolean }).empty ? '-' : (d as unknown as { id: string }).id))).toEqual(['w2', '-', 'w1', '-']);
  });
  it('사람 필요·상태가 책상에 실린다', () => {
    const r = phoneRooms({ ...base, statusOf: (s) => (s.id === 'w2' ? 'asks' : 'idle'), humanOf: (s) => (s.id === 'w1' ? '로그인 코드' : undefined), shape: parseOffice('{}') })[0]!;
    expect(r.desks.find((d) => d.id === 'w2')!.st).toBe('asks');
    expect(r.desks.find((d) => d.id === 'w1')!.human).toBe('로그인 코드');
  });
  it('사무실마다 — 정해진 사무실로 출근, 꺼진 참모 자리는 비어 있다', () => {
    const shape = parseOffice(JSON.stringify({ offices: [{}, {}], assign: { 'pet-diary': 1 }, off: [{ id: 'off1', name: '참모-2', label: '디자인' }], seats: { '참모-2': { office: 1, x: 2.2, y: 1.1 } } }));
    const [a, b] = phoneRooms({ ...base, shape });
    expect(a!.desks.some((d) => d.id === 'w2')).toBe(false);
    expect(b!.desks.some((d) => d.id === 'w2')).toBe(true);
    expect(b!.desks.find((d) => d.id === 'off1')).toMatchObject({ empty: true, off: true, label: '디자인' });
    expect(a!.desks.some((d) => d.id === 'off1')).toBe(false);
    expect(speciesFor('x')).toBeTruthy();
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
  const room = testRoom(
    [
      { id: 'o1', label: '참모', project: 'hq', status: 'working', startedAt: 0 },
      { id: 'o2', label: '디자인', project: 'hq', status: 'idle', startedAt: 1 },
      { id: 'o3', label: '기획', project: 'hq', status: 'asks', startedAt: 2 },
    ],
    [
      { id: 'w', label: 'acme-shop', project: 'acme-shop', status: 'working', startedAt: 3 },
      { id: 'd', label: 'ops', project: 'ops', status: 'done', startedAt: 4 },
    ],
  );
  const orchIds = ['o1', 'o2', 'o3'];
  it('talkTargets — 참모 자리(반장 포함)를 방 순서대로, 프로젝트 세션은 빼고', () => {
    expect(talkTargets(room.desks, orchIds).map((d) => d.id)).toEqual(['o1', 'o2', 'o3']);
  });
  it('officeList 에 참모를 빼면 참모는 줄·접힌 줄 어디에도 없다(위 참모 줄에서 고른다)', () => {
    const { rows, rest } = officeList(room.desks, new Set(orchIds));
    expect([...rows, ...rest].map((d) => d.id).sort()).toEqual(['d', 'w']);
  });
  it('tapKind — 참모면 캐릭터 고르기, 나머지는 세션', () => {
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
