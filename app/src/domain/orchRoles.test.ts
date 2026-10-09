import { describe, expect, it } from 'vitest';
import { cleanRole, inferRoles, parseRoles, roleHeir, roleLine, ROLE_MAX, type RoleMap } from './orchRoles';
import { orchestratorLike, parseAgents, type Session } from './session';
import { samePath } from './paths';
import fixture from './orchRoles.fixture.json';
import type { TaskEvent } from './tasks';

const DAY = 24 * 3600_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, name: id, cwd: `/dev/${id}`, kind: 'background', state: 'idle', project: id, workspace: null, startedAt: 0, ...over,
});
const orch = (id: string, name: string) => s(id, { name, cwd: '/hq', project: 'hq' });
const send = (task: string, target: string, from: string, h: number, more: Partial<TaskEvent> = {}): TaskEvent => ({ ts: ago(h), type: 'send', task, target, from, ...more });

describe('cleanRole — 맡은 일 한 줄 다듬기', () => {
  it('줄바꿈·연속 공백은 한 칸, 앞뒤 공백 제거', () => {
    expect(cleanRole('  쇼핑몰\n개발   담당 ')).toBe('쇼핑몰 개발 담당');
  });
  it('비면 빈 글(= 지움)', () => {
    expect(cleanRole('   \n ')).toBe('');
  });
  it(`${ROLE_MAX}자까지(글자 단위 — 한글이 깨지지 않게)`, () => {
    const long = '가'.repeat(ROLE_MAX + 10);
    expect([...cleanRole(long)].length).toBe(ROLE_MAX);
  });
});

describe('parseRoles — orch-roles.json 글 → 이름별 맡은 일', () => {
  it('글이 있는 칸만', () => {
    const t = JSON.stringify({ '참모-3': { role: '예약', at: 1 }, '참모-4': { role: '', at: 2 }, '참모-5': { at: 3 }, '참모-6': '잘못된 칸' });
    expect(parseRoles(t)).toEqual({ '참모-3': { role: '예약', at: 1 } });
  });
  it('맡은 일이 비어도 태어난 때(born)가 있으면 남긴다 — 옛 기록을 안 세려고', () => {
    expect(parseRoles(JSON.stringify({ '참모-4': { role: '', at: 9, born: 9 } }))).toEqual({ '참모-4': { role: '', at: 9, born: 9 } });
  });
  it('깨진 글·배열이면 빈 것', () => {
    expect(parseRoles('{깨짐')).toEqual({});
    expect(parseRoles('[]')).toEqual({});
  });
});

describe('inferRoles — 최근 7일 기록으로 참모마다 주로 맡긴 프로젝트', () => {
  const orchs = [orch('aa11', '참모'), orch('bb22', '참모-2 · 뽀삐'), orch('cc33', '참모-3')];
  const sessions = [s('p1', { name: 'alpha-shop', project: 'alpha-shop' }), s('p2', { name: 'gamma-app', project: 'gamma-app' }), s('p3', { name: 'fix-login', project: 'beta-blog', workspace: 'fix-login' }), ...orchs];

  it('건수 많은 순 → 최근 순, 위 3개', () => {
    const ev = [
      send('t1', 'alpha-shop', 'aa11', 50), send('t2', 'alpha-shop', 'aa11', 30), send('t3', 'gamma-app', 'aa11', 5),
      send('t4', 'fix-login', 'aa11', 10), send('t5', 'delta-api', 'aa11', 2, { project: 'delta-api' }), send('t6', 'epsilon', 'aa11', 1, { project: 'epsilon' }),
    ];
    expect(inferRoles(ev, orchs, sessions, NOW)['참모']).toEqual(['alpha-shop', 'epsilon', 'delta-api']);
  });

  it('7일 넘은 기록은 안 센다', () => {
    const ev = [send('t1', 'alpha-shop', 'aa11', 8 * 24), send('t2', 'gamma-app', 'aa11', 1)];
    expect(inferRoles(ev, orchs, sessions, NOW)['참모']).toEqual(['gamma-app']);
  });

  it('기록에 적힌 project 가 먼저, 없으면 대상 세션의 프로젝트(워크트리면 본체), 못 찾으면 버린다', () => {
    const ev = [send('t1', 'fix-login', 'bb22', 3), send('t2', '사라진-세션', 'bb22', 2), send('t3', '사라진-세션', 'bb22', 1, { project: 'alpha-shop' })];
    expect(inferRoles(ev, orchs, sessions, NOW)['참모-2']).toEqual(['alpha-shop', 'beta-blog']);
  });

  it('참모끼리 넘긴 일(대상이 참모)·주인 모르는 일은 뺀다', () => {
    const ev = [send('t1', '참모-3', 'aa11', 3, { project: 'hq' }), send('t2', '참모-2 · 뽀삐', 'aa11', 2), { ts: ago(1), type: 'send', task: 't3', target: 'alpha-shop' } as TaskEvent];
    expect(inferRoles(ev, orchs, sessions, NOW)).toEqual({});
  });

  it('handoff(own) 로 넘겨받은 일은 새 주인 몫', () => {
    const ev = [send('t1', 'alpha-shop', 'aa11', 5), { ts: ago(4), type: 'own', task: 't1', from: 'cc33' } as TaskEvent];
    const r = inferRoles(ev, orchs, sessions, NOW);
    expect(r['참모-3']).toEqual(['alpha-shop']);
    expect(r['참모']).toBeUndefined();
  });

  it('fromName(기본 이름)이 있으면 id 가 바뀐 참모(되살리기 복사본)도 같은 사람으로', () => {
    const ev = [send('t1', 'alpha-shop', 'dead99', 5, { fromName: '참모-3' }), send('t2', 'gamma-app', 'cc33', 4)];
    expect(inferRoles(ev, orchs, sessions, NOW)['참모-3']).toEqual(['gamma-app', 'alpha-shop']); // 한 건씩이면 최근 순
  });

  it('번호를 다시 쓴 새 참모는 태어나기 전 기록(옛 참모 것)을 안 센다(2026-10-04 리뷰)', () => {
    const ev = [send('t1', 'alpha-shop', 'old44', 30, { fromName: '참모-3' }), send('t2', 'gamma-app', 'cc33', 2)];
    const roles: RoleMap = { '참모-3': { role: '', at: 0, born: Date.parse(ago(10)) } };
    expect(inferRoles(ev, orchs, sessions, NOW, { roles })['참모-3']).toEqual(['gamma-app']);
  });

  it('HQ 폴더 세션(도우미)에 보낸 일은 프로젝트로 안 센다 — HQ 가 dev 안에 있어도', () => {
    const helper = s('h1', { name: 'sns-post', cwd: '/dev/hq', project: 'hq' });
    const ev = [send('t1', 'sns-post', 'aa11', 2), send('t2', 'alpha-shop', 'aa11', 1)];
    expect(inferRoles(ev, orchs, [...sessions, helper], NOW, { hq: '/dev/hq/' })['참모']).toEqual(['alpha-shop']);
  });

  it('윈도우 HQ 가 섞인 구분자·대소문자로 와도 HQ 도우미에게 보낸 일은 뺀다', () => {
    const ev = [send('t1', 'alpha-shop', 'aa11', 3), send('t2', 'sns-post', 'aa11', 2)];
    const helper = s('h1', { name: 'sns-post', cwd: 'C:/Users/Me/.chammo/hq', project: 'hq' });
    expect(inferRoles(ev, orchs, [...sessions, helper], NOW, { hq: 'c:\\Users\\Me/.chammo/hq' })['참모']).toEqual(['alpha-shop']);
  });

  it('꺼진 참모도 id 로 맞춘다(known 에 있으면)', () => {
    const ev = [send('t1', 'alpha-shop', 'off77', 5)];
    expect(inferRoles(ev, [...orchs, { id: 'off77', name: '참모-9 · 두부' }], sessions, NOW)['참모-9']).toEqual(['alpha-shop']);
  });
});

describe('roleLine — 이름 밑 회색 한 줄', () => {
  const roles: RoleMap = { '참모-3': { role: '쇼핑몰 개발', at: 1 } };
  it('사람이 적은 게 먼저 — 추론이 있어도', () => {
    expect(roleLine('참모-3 · 뽀삐', roles, { '참모-3': ['gamma-app'] })).toEqual({ text: '쇼핑몰 개발', auto: false });
  });
  it('없으면 "주로 a·b"', () => {
    expect(roleLine('참모-4', roles, { '참모-4': ['alpha-shop', 'gamma-app'] })).toEqual({ text: '주로 alpha-shop·gamma-app', auto: true });
  });
  it('둘 다 없으면 없음(지어내지 않음)', () => {
    expect(roleLine('참모-5', roles, {})).toBeNull();
    expect(roleLine('참모-5', roles, { '참모-5': [] })).toBeNull();
  });
});

describe('roleHeir — 멈춘 세션 물음을 받을 참모(앞 단계로 못 정했을 때 보조)', () => {
  const live = [orch('aa11', '참모'), orch('kk88', '참모-8 · 콩이'), orch('dd44', '참모-4 · 예약 담당')];
  const known = [...live, { id: 'bb22', name: '참모-2' }];
  const gamma = s('g1', { name: 'gamma-app', project: 'gamma-app' });
  const ev = [send('t1', 'gamma-app', 'bb22', 3)];

  it('맡던 참모(꺼짐)와 맡은 일이 같은 살아 있는 참모 — 대신 맡으라고 새로 만든 경우', () => {
    const roles: RoleMap = { '참모-2': { role: '스토어 제출', at: 1 }, '참모-8': { role: ' 스토어  제출', at: 2 } };
    expect(roleHeir(gamma, ev, live, known, [gamma, ...live], roles)?.id).toBe('kk88');
  });

  it('맡은 일 글에 그 프로젝트 이름이 든 참모', () => {
    const roles: RoleMap = { '참모-4': { role: 'Gamma-App이랑 예약', at: 1 } }; // 한글 조사가 붙어도
    expect(roleHeir(gamma, ev, live, known, [gamma, ...live], roles)?.id).toBe('dd44');
  });

  it('짧은 프로젝트 이름은 단어로만 맞춘다(ui 가 build 에 걸리지 않게)', () => {
    const ui = s('u1', { name: 'ui', project: 'ui' });
    const roles: RoleMap = { '참모-4': { role: 'build 관리', at: 1 }, '참모-8': { role: 'ui·문서', at: 1 } };
    expect(roleHeir(ui, [], live, known, [ui, ...live], roles)?.id).toBe('kk88');
    expect(roleHeir(ui, [], live, known, [ui, ...live], { '참모-4': { role: 'build 관리', at: 1 } })).toBeUndefined();
  });

  it('맞는 게 없으면 없음(맨 앞으로 가는 건 부르는 쪽)', () => {
    expect(roleHeir(gamma, ev, live, known, [gamma, ...live], {})).toBeUndefined();
  });

  it('역할이 같아도 맡던 그 참모 자신은 빼고, 둘이 같으면 앞의 것', () => {
    const roles: RoleMap = { '참모-2': { role: '개발', at: 1 }, '참모': { role: '개발', at: 2 }, '참모-8': { role: '개발', at: 3 } };
    expect(roleHeir(gamma, ev, live, known, [gamma, ...live], roles)?.id).toBe('aa11');
  });
});

describe('inferRoles — 훅(orch-roster infer)과 같은 표(orchRoles.fixture.json, feature/orch-roles ① 두 벌 어긋남 막기)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const { devRoot, hqDir, extraProjects } = c.config;
    const sessions = parseAgents(JSON.stringify(c.agents), devRoot, extraProjects);
    const known = sessions.filter((x) => samePath(x.cwd, hqDir) && orchestratorLike(x.name));
    const roles = 'roles' in c ? (c.roles as RoleMap) : undefined;
    expect(inferRoles(c.events as TaskEvent[], known, sessions, Date.parse(fixture.now), { roles, hq: hqDir })).toEqual(c.want);
  });
});
