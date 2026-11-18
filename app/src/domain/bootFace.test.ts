import { describe, expect, it } from 'vitest';
import { BOOT_CAP_MS, bootFace, bootGate, bootPlace, faceLook, keepLost, LOST_HOLD_MS, lostAsStopped, memoRows, parseBootMemo, restGuess, splitOff, type BootMemo } from './bootFace';
import type { SnapSession } from './revive';
import type { StoppedSession } from './stopped';

// 켤 때 점호 — 시안 docs/design-drafts/boot-loading v3 확정(2026-11-17 사용자 "다 좋다"). README '실제 값 → 얼굴'·'자리' 표 그대로
const stopped = (name: string, reason: StoppedSession['reason'] = 'stopped', sid = `sid-${name}`): StoppedSession =>
  ({ id: sid.slice(0, 8), sessionId: sid, name, cwd: '/hq', project: 'hq', workspace: null, reason, startedAt: 1 });
const lost = (name: string, sid = `sid-${name}`): SnapSession => ({ sessionId: sid, name, cwd: '/hq', id: sid.slice(0, 8) });

describe('bootFace — 실제 값 → 얼굴', () => {
  it('살아 있는 참모 — working·blocked·done(쉼)은 일함·물음·쉼', () => {
    expect(bootFace({ live: { state: 'working' } })).toBe('work');
    expect(bootFace({ live: { state: 'blocked' } })).toBe('ask');
    expect(bootFace({ live: { state: 'idle' } })).toBe('rest');
    expect(bootFace({ live: { state: 'idle', awaiting: true } })).toBe('rest');
  });
  it('재부팅으로 꺼짐(lost) = 깨울 차례, 이어서 켜는 중 = 깨는 중, 켜기 실패 = 못 깸', () => {
    expect(bootFace({ lost: true })).toBe('queue');
    expect(bootFace({ lost: true, waking: true })).toBe('waking');
    expect(bootFace({ waking: true })).toBe('waking');
    expect(bootFace({ lost: true, failed: true })).toBe('failed');
  });
  it('사람이 재운 것(stopped)·일 끝내고 꺼진 것(done, pid 없음)은 쉬는 칸, 비정상 종료(failed)는 못 깸', () => {
    expect(bootFace({ stopped: 'stopped' })).toBe('resting');
    expect(bootFace({ stopped: 'done' })).toBe('resting');
    expect(bootFace({ stopped: 'failed' })).toBe('failed');
  });
  it('살아 있으면 다른 표시보다 먼저 — 켜는 중이던 참모가 살아나면 바로 그 얼굴', () => {
    expect(bootFace({ live: { state: 'working' }, waking: true, lost: true })).toBe('work');
  });
  it('lost 가 stopped 보다 먼저 — 재부팅으로 꺼진 참모는 꺼진 목록(done·failed)에도 걸리지만 쉬는 칸으로 안 내려간다', () => {
    expect(bootFace({ lost: true, stopped: 'done' })).toBe('queue');
    expect(bootFace({ lost: true, stopped: 'stopped' })).toBe('queue');
  });
});

describe('bootPlace — 자리', () => {
  it('쉬는 칸은 재워 둔 참모만, 나머지(깨울 차례·깨는 중·못 깸 포함)는 위 띠 제자리', () => {
    expect(bootPlace('resting')).toBe('rest');
    for (const f of ['work', 'ask', 'rest', 'queue', 'waking', 'failed'] as const) expect(bootPlace(f)).toBe('top');
  });
});

describe('splitOff — 재부팅으로 꺼진 참모를 먼저 가른다', () => {
  const now = 1_000_000_000;
  it('lost 이고 아직 안 살아난 참모는 위 띠(깨울 차례), 꺼진 목록에서 같은 대화는 쉬는 칸에서 뺀다', () => {
    const r = splitOff({ stopped: [stopped('참모-2', 'done'), stopped('참모-4', 'stopped')], lost: [lost('참모-2')], live: [], now, daemonAt: now - 60_000 });
    expect(r.lostTop.map((x) => x.name)).toEqual(['참모-2']);
    expect(r.resting.map((x) => x.name)).toEqual(['참모-4']);
  });
  it('되살린 대화 id 가 달라도 이름이 같으면 같은 참모 — 쉬는 칸에 같은 이름이 남지 않는다', () => {
    const r = splitOff({ stopped: [stopped('참모-8', 'done', 'old-8')], lost: [lost('참모-8', 'new-8')], live: [], now, daemonAt: now - 1000 });
    expect(r.resting).toEqual([]);
  });
  it('이미 살아난 참모는 lost 에서 빠진다', () => {
    const r = splitOff({ stopped: [], lost: [lost('참모-2')], live: [{ name: '참모-2 · 참모 업데이트', sessionId: 'sid-참모-2' }], now, daemonAt: now - 1000 });
    expect(r.lostTop).toEqual([]);
  });
  it(`데몬이 뜬 뒤 ${LOST_HOLD_MS / 60_000}분이 지나도 안 깨운 참모는 쉬는 칸으로(영원히 깨울 차례로 남지 않게)`, () => {
    const r = splitOff({ stopped: [stopped('참모-3', 'done')], lost: [lost('참모-3')], live: [], now, daemonAt: now - LOST_HOLD_MS - 1 });
    expect(r.lostTop).toEqual([]);
    expect(r.resting.map((x) => x.name)).toEqual(['참모-3']);
  });
});

describe('keepLost — 재시작 정리가 참모를 기록에서 빼도 깰 때까지 위 띠에', () => {
  // 자동 되살리기가 꺼진 맥에선 triageLost 가 lost 참모를 바로 기록에서 뺀다(깨우기는 useOrchRevive 몫) — 그때 쉬는 칸으로 내려가면 안 된다(아이맥 실측 11-17)
  it('한 번 본 꺼진 참모는 lost 목록에서 빠져도 남는다', () => {
    const a = keepLost([], [lost('참모-2'), lost('참모-3')], []);
    expect(keepLost(a, [], []).map((x) => x.name)).toEqual(['참모-2', '참모-3']);
  });
  it('살아나면(대화 id 나 이름) 빠지고, 기록에 없으면 다시 안 들어온다', () => {
    const a = keepLost([], [lost('참모-2'), lost('참모-3')], []);
    const b = keepLost(a, [], [{ name: '참모-2 · 참모 업데이트', sessionId: 'other' }]);
    expect(b.map((x) => x.name)).toEqual(['참모-3']);
    expect(keepLost(b, [], []).map((x) => x.name)).toEqual(['참모-3']);
    expect(keepLost(b, [], [{ sessionId: 'sid-참모-3' }])).toEqual([]);
  });
  it('이름 없는 세션이 살아 있어도 이름 없는 꺼진 참모를 산 것으로 치지 않는다', () => {
    expect(keepLost([], [lost('', 'sid-x')], [{ sessionId: 'sid-y' }]).map((x) => x.sessionId)).toEqual(['sid-x']);
  });
  it('바뀐 게 없으면 같은 배열을 돌려준다(다시 그리지 않게)', () => {
    const a = keepLost([], [lost('참모-2')], []);
    expect(keepLost(a, [lost('참모-2')], [])).toBe(a);
  });
});

describe('lostAsStopped — 깨울 차례를 누르면 같은 번호·같은 대화로 깨운다', () => {
  it('짧은 번호·대화 id·폴더를 그대로', () => {
    expect(lostAsStopped({ sessionId: 'abcdef12-3456', name: '참모-2', cwd: '/hq', id: 'abcdef12' })).toMatchObject({ id: 'abcdef12', sessionId: 'abcdef12-3456', name: '참모-2', cwd: '/hq' });
    expect(lostAsStopped({ sessionId: 'abcdef12-3456', name: '참모-2', cwd: '/hq' }).id).toBe('abcdef12');
  });
});

describe('bootGate — 다 준비됨과 3초 상한', () => {
  const data = { sessions: true, roles: true, avatars: true, all: true, chat: true };
  it('데이터가 다 오고 깨울 참모가 없으면 바로 넘어간다', () => {
    expect(bootGate({ elapsed: 900, data, faces: ['work', 'rest', 'resting'] })).toEqual({ done: true, why: 'ready' });
  });
  it('다 재워 뒀으면(쉬는 칸만) 기다릴 게 없어 데이터만 오면 넘어간다 — 채팅 칸이 없으니 대화도 안 기다린다', () => {
    expect(bootGate({ elapsed: 700, data: { ...data, chat: false }, faces: ['resting', 'resting'], noChat: true })).toEqual({ done: true, why: 'ready' });
  });
  it('깨울 차례·깨는 중이 하나라도 있으면 3초 상한까지 기다린다', () => {
    expect(bootGate({ elapsed: 1200, data, faces: ['work', 'queue'] })).toEqual({ done: false, why: null });
    expect(bootGate({ elapsed: 1200, data, faces: ['waking'] })).toEqual({ done: false, why: null });
    expect(bootGate({ elapsed: BOOT_CAP_MS, data, faces: ['work', 'queue'] })).toEqual({ done: true, why: 'cap' });
  });
  it('데이터가 늦어도 3초면 있는 것부터 보여 준다(영원히 안 끝나지 않게)', () => {
    expect(bootGate({ elapsed: BOOT_CAP_MS - 1, data: { ...data, sessions: false }, faces: [] })).toEqual({ done: false, why: null });
    expect(bootGate({ elapsed: BOOT_CAP_MS, data: { ...data, sessions: false }, faces: [] })).toEqual({ done: true, why: 'cap' });
  });
  it('못 깸은 기다리지 않는다(사람이 깨울 일) — 상한 전에 넘어간다', () => {
    expect(bootGate({ elapsed: 900, data, faces: ['work', 'failed'] })).toEqual({ done: true, why: 'ready' });
  });
});

describe('parseBootMemo — 지난번 기억(localStorage)', () => {
  const memo: BootMemo = { v: 1, at: 5, chiefs: [{ key: 'sid-a', name: '참모-2 · 참모 업데이트', label: '참모 업데이트', color: '#2f74e0', shape: 'mochi', eyes: 'pill', face: 'work' }, { key: 'sid-b', name: '참모-4', label: '개인질문 담당', color: '#9b51e0', shape: 'cloud', eyes: 'pill', face: 'resting' }] };
  it('없거나 깨졌으면 null — 첫 장면은 대표 캐릭터 하나', () => {
    expect(parseBootMemo(null)).toBeNull();
    expect(parseBootMemo('')).toBeNull();
    expect(parseBootMemo('{안 됨')).toBeNull();
    expect(parseBootMemo(JSON.stringify({ v: 2, chiefs: [] }))).toBeNull();
  });
  it('제대로 된 기억은 그대로, 모르는 도형·얼굴·색은 그 참모만 버린다', () => {
    expect(parseBootMemo(JSON.stringify(memo))).toEqual(memo);
    const bad = { ...memo, chiefs: [...memo.chiefs, { ...memo.chiefs[0], key: 'x', shape: 'banana' }, { ...memo.chiefs[0], key: 'y', face: 'zzz' }, { ...memo.chiefs[0], key: 'z', color: 'red;background:url(x)' }] };
    expect(parseBootMemo(JSON.stringify(bad))?.chiefs.map((c) => c.key)).toEqual(['sid-a', 'sid-b']);
  });
  it('참모가 너무 많으면 앞 20명까지만(첫 장면이 넘치지 않게)', () => {
    const many = { ...memo, chiefs: Array.from({ length: 30 }, (_, i) => ({ ...memo.chiefs[0], key: `k${i}` })) };
    expect(parseBootMemo(JSON.stringify(many))?.chiefs).toHaveLength(20);
  });
});

describe('restGuess — 꺼진 목록이 오기 전 쉬는 묶음은 지난번 기억으로, 지금 위 띠에 있는 참모는 뺀다', () => {
  // 덮개는 꺼진 목록(agents --all, 가장 늦게 옴)을 안 기다리고 날아간다 — 지난번 쉬는 묶음을 그대로 쓰면 깨운 참모가 위 띠와 쉬는 묶음에 둘 다 섰다(아이맥 실측 11-17)
  const chief = (name: string, key = `k-${name}`): { key: string; name: string; face: 'resting' } => ({ key, name, face: 'resting' });
  it('같은 대화(key)나 같은 이름(번호·별명)이 위 띠에 있으면 뺀다', () => {
    const r = restGuess([chief('참모-4 · 개인질문 담당', 'old'), chief('참모-9 · 쇼핑몰')], [{ key: 'new', name: '참모-4 · 개인질문 담당' }]);
    expect(r.map((c) => c.name)).toEqual(['참모-9 · 쇼핑몰']);
    expect(restGuess([chief('참모-9', 'k1')], [{ key: 'k1', name: '다른 이름' }])).toEqual([]);
  });
  it('위 띠가 비면(참모 목록 전) 그대로', () => {
    const rest = [chief('참모-9')];
    expect(restGuess(rest, [])).toBe(rest);
  });
  it('지난번 위 띠에 있었는데 이번엔 살아 있지도 깨울 차례도 아닌 참모 = 그사이 재운 참모 — 쉬는 묶음으로 짐작', () => {
    // 아이맥 실측 11-17: 셋을 재운 뒤 켜면 지난번 기억엔 쉬는 참모가 없어 쉬는 묶음이 아예 안 보였다
    const memo = [{ key: 'a', name: '참모-2', face: 'waking' as const }, { key: 'b', name: '참모-2 · 디자인', face: 'waking' as const }, chief('참모-4')];
    expect(restGuess(memo, [{ key: 'a', name: '참모-2' }]).map((c) => c.name)).toEqual(['참모-2 · 디자인', '참모-4']);
  });
});

describe('faceLook·memoRows — 그리는 모양과 첫 장면', () => {
  it('얼굴 → 프사 상태·단계', () => {
    expect(faceLook('work')).toEqual({ state: 'work' });
    expect(faceLook('queue')).toEqual({ state: 'off', phase: 'queued' });
    expect(faceLook('waking')).toEqual({ state: 'off', phase: 'starting' });
    expect(faceLook('failed')).toEqual({ state: 'off', phase: 'failed' });
    expect(faceLook('resting')).toEqual({ state: 'off' });
  });
  it('기억이 없으면 줄도 묶음도 비었다(대표 캐릭터 하나로)', () => {
    expect(memoRows(null)).toEqual({ top: [], rest: [] });
  });
  it('기억이 있으면 살아 있던 참모는 아직 모르니 깨는 중으로 줄에, 재워 둔 참모는 쉬는 묶음으로', () => {
    const m: BootMemo = { v: 1, at: 1, chiefs: [
      { key: 'a', name: '참모-2', label: '참모 업데이트', color: '#2f74e0', shape: 'mochi', eyes: 'pill', face: 'work' },
      { key: 'b', name: '참모-4', label: '개인질문 담당', color: '#9b51e0', shape: 'cloud', eyes: 'pill', face: 'resting' },
    ] };
    const r = memoRows(m);
    expect(r.top.map((c) => `${c.key}:${c.face}`)).toEqual(['a:waking']);
    expect(r.rest.map((c) => c.key)).toEqual(['b']);
  });
});
