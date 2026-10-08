import { describe, expect, it } from 'vitest';
import { loadChip, readPhoneLoad, slotLine } from './phoneLoad';

// 맥이 /api/load 로 주는 모양 — load = 앱이 적는 <데이터>/load.json(domain/load summarize), slots = scripts/slot 자리 파일, now = 맥 시각(초)
const NOW = 1_791_210_000;
const loadJson = (over: Record<string, unknown> = {}) => ({
  at: new Date((NOW - 5) * 1000).toISOString(),
  cores: 10,
  load1: 191.4,
  load5: 159.8,
  swapUsedGb: 11.2,
  level: 'high',
  sessions: [
    { name: '앱 기기 점검', project: 'hello-docs', cpu: 87, mem: '2.2GB', top: ['Claude Code 20% 261MB', 'Gradle 16% 196MB', 'Gradle 10% 144MB'] },
    { name: '참모-2 · 참모 업데이트', project: 'honor-orchestrator', cpu: 65, mem: '904MB', top: ['honor-orchestrator 22% 70MB'] },
    { name: 'a', project: 'p', cpu: 5, mem: '1MB', top: [] },
    { name: 'b', project: 'p', cpu: 4, mem: '1MB', top: [] },
    { name: 'c', project: 'p', cpu: 3, mem: '1MB', top: [] },
    { name: 'd', project: 'p', cpu: 2, mem: '1MB', top: [] },
  ],
  orphans: [],
  outside: { cpu: 3, mem: '200MB' },
  rest: { cpu: 40, mem: '6.0GB', top: ['WindowServer 20% 300MB'] },
  ...over,
});
const raw = (over: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) => JSON.stringify({
  now: NOW,
  load: loadJson(over),
  slots: { build: { owner: 'hello-docs', ts: NOW - 12 * 60 }, ios: null, galaxy: { owner: 'hello-docs', ts: NOW - 40 * 60 }, ...slots },
  ttl: { build: 2700, ios: 3600, galaxy: 1800 },
});

describe('폰 맥 부하', () => {
  it('맥이 적은 부하·스왑·세션 상위 5개를 읽는다', () => {
    const v = readPhoneLoad(raw())!;
    expect([v.level, v.label, v.load1, v.cores, v.swapGb]).toEqual(['high', '과부하', 191.4, 10, 11.2]);
    expect(v.sessions.map((s) => s.name)).toEqual(['앱 기기 점검', '참모-2 · 참모 업데이트', 'a', 'b', 'c']);
    expect(v.sessions[0]).toMatchObject({ project: 'hello-docs', cpu: 87, mem: '2.2GB', what: 'Gradle' });
  });

  it('왜 느린지 — CPU 가장 큰 세션과 그 안의 무거운 것(Claude Code 자신은 건너뜀)', () => {
    expect(readPhoneLoad(raw())!.why).toBe('앱 기기 점검 · Gradle — CPU 87%');
  });

  it('무거운 것 이름이 프로젝트와 같으면 안 겹쳐 쓴다(참모 앱 자신)', () => {
    expect(readPhoneLoad(raw())!.sessions[1]!.what).toBe('');
  });

  it('세션 밖 프로그램이 더 크면 그걸 원인으로', () => {
    const v = readPhoneLoad(raw({ rest: { cpu: 300, mem: '9GB', top: ['Xcode build 250% 3GB', 'Safari 20% 1GB'] } }))!;
    expect(v.why).toBe('세션 밖 Xcode build — CPU 300%');
  });

  it('여유 있으면 원인을 안 찾는다', () => {
    expect(readPhoneLoad(raw({ level: 'ok', load1: 2.1, swapUsedGb: 0 }))!.why).toBe('여유 있어요');
    expect(readPhoneLoad(raw({ level: 'warn' }))!.label).toBe('바쁨');
    expect(readPhoneLoad(raw({ level: 'ok' }))!.label).toBe('보통');
  });

  it('CPU 는 한가한데 스왑 때문에 높으면 스왑을 말한다', () => {
    const v = readPhoneLoad(raw({ level: 'high', load1: 3, sessions: [], rest: { cpu: 5, mem: '1GB', top: [] } }))!;
    expect(v.why).toBe('스왑 11.2G — 메모리가 모자라요');
  });

  it('자리 — 누가 몇 분째, TTL 넘으면 넘겨받을 수 있음 표시', () => {
    const v = readPhoneLoad(raw())!;
    expect(v.slots).toEqual([
      { name: 'build', owner: 'hello-docs', min: 12, over: false, state: null, who: null },
      { name: 'ios', owner: null, min: 0, over: false, state: null, who: null },
      { name: 'galaxy', owner: 'hello-docs', min: 40, over: true, state: null, who: null },
    ]);
  });

  // 2026-10-05 — 확인 창에 멈춘 세션이 build 자리를 30분 쥐었는데 폰에선 '누가·멈췄나'가 안 보였다
  it('자리 — 쥔 세션 이름·바쁜지, 몇 분째는 처음 잡은 때부터(slot run 이 늘려도)', () => {
    const v = readPhoneLoad(raw({}, {
      build: { owner: 'hello-docs', ts: NOW - 60, since: NOW - 25 * 60, state: 'idle', who: '앱 기기 점검' },
      ios: { owner: 'project-x-app', ts: NOW - 60, state: 'gone' },
      galaxy: { owner: 'x', ts: NOW, state: 'weird', who: 3 },
    }))!;
    expect(v.slots[0]).toEqual({ name: 'build', owner: 'hello-docs', min: 25, over: false, state: 'idle', who: '앱 기기 점검' });
    expect([v.slots[1]!.state, v.slots[1]!.who]).toEqual(['gone', null]);
    expect([v.slots[2]!.state, v.slots[2]!.who]).toEqual([null, null]);
  });

  it('자리 글 — 주인 · 상태 · 몇 분 · 세션(좁아서 잘리면 세션 이름만 잘리게)', () => {
    expect(slotLine({ name: 'build', owner: 'hello-docs', min: 25, over: false, state: 'idle', who: '앱 기기 점검' })).toBe('hello-docs · 쉬는 중 · 25분 · 앱 기기 점검');
    expect(slotLine({ name: 'ios', owner: 'project-x-app', min: 3, over: false, state: 'busy', who: null })).toBe('project-x-app · 바쁨 · 3분');
    expect(slotLine({ name: 'ios', owner: 'project-x-app', min: 70, over: true, state: 'gone', who: null })).toBe('project-x-app · 세션 없음 · 70분 · 시간 넘음');
    expect(slotLine({ name: 'galaxy', owner: null, min: 0, over: false, state: null, who: null })).toBe('비어 있음');
  });

  it('맥 시각으로 나이를 잰다 — 앱이 안 적은 지 오래면 낡음', () => {
    expect(readPhoneLoad(raw())!.ageSec).toBe(5);
    const old = readPhoneLoad(raw({ at: new Date((NOW - 600) * 1000).toISOString() }))!;
    expect([old.ageSec, old.stale]).toEqual([600, true]);
  });

  it('load.json 이 없으면(앱이 아직 안 잼) 자리만', () => {
    const v = readPhoneLoad(JSON.stringify({ now: NOW, load: null, slots: { build: null, ios: null, galaxy: null }, ttl: {} }))!;
    expect([v.level, v.sessions, v.why]).toEqual(['unknown', [], '맥 앱이 아직 부하를 안 쟀어요']);
    expect(v.slots.map((s) => s.owner)).toEqual([null, null, null]);
  });

  it('못 읽는 글은 null', () => {
    expect(readPhoneLoad('')).toBeNull();
    expect(readPhoneLoad('<html>')).toBeNull();
    expect(readPhoneLoad('{"now":"x"}')).toBeNull();
  });

  it('머리줄 칩 — 점 색 등급과 1분 부하 숫자(10 넘으면 정수)', () => {
    expect(loadChip(readPhoneLoad(raw())!)).toEqual({ cls: 'ld-high', text: '191', aria: '맥 부하 과부하 — 191, 코어 10개' });
    expect(loadChip(readPhoneLoad(raw({ level: 'ok', load1: 3.46 }))!)!.text).toBe('3.5');
    expect(loadChip(readPhoneLoad(raw({ at: new Date((NOW - 600) * 1000).toISOString() }))!)!.cls).toBe('ld-unknown');
    expect(loadChip(null)).toBeNull();
  });
});
