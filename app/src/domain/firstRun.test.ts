import { describe, expect, it } from 'vitest';
import { firstSpawnDue } from './firstRun';
import { allDone, canSkip, doneCount, failKind, itemOk, itemsFor, lineLength, loginCommand, needsManualGet, nextItem, resumeScreen, retryItem, setItem } from './firstRun';

describe('첫 설치 항목', () => {
  it('맥은 넷, 윈도우는 git·파이썬이 앞에 — 맥 참모 도구 줄은 윈도우에 없다', () => {
    expect(itemsFor(false).map((i) => i.key)).toEqual(['tools', 'claude', 'browser', 'folder']);
    expect(itemsFor(true).map((i) => i.key)).toEqual(['git', 'python', 'claude', 'browser', 'folder']);
  });
  it('차례대로, 실패하면 멈춘다 — 브라우저가 안 깔린 채 끝으로 못 간다(사용자 11-05 필수)', () => {
    let it0 = itemsFor(false);
    expect(nextItem(it0)).toMatchObject({ key: 'tools' });
    it0 = setItem(it0, 'tools', 'ok');
    it0 = setItem(it0, 'claude', 'ok');
    it0 = setItem(it0, 'browser', 'fail', 'net');
    expect(nextItem(it0)).toBe('stuck');
    expect(allDone(it0)).toBe(false);
    it0 = retryItem(it0, 'browser');
    expect(nextItem(it0)).toMatchObject({ key: 'browser' });
    it0 = setItem(setItem(it0, 'browser', 'ok'), 'folder', 'ok');
    expect(nextItem(it0)).toBeNull();
    expect(allDone(it0)).toBe(true);
    expect(doneCount(it0)).toBe(4);
  });
  it('넘길 수 있는 건 윈도우 git·파이썬뿐', () => {
    expect((['tools', 'claude', 'browser', 'folder'] as const).some(canSkip)).toBe(false);
    expect(canSkip('git') && canSkip('python')).toBe(true);
  });
  it('winget 이 없으면 윈도우 git·파이썬만 직접 받기', () => {
    expect(needsManualGet(true, 'git', { winget: false })).toBe(true);
    expect(needsManualGet(true, 'claude', { winget: false })).toBe(false);
    expect(needsManualGet(false, 'git', { winget: false })).toBe(false);
    expect(needsManualGet(true, 'git', { winget: true })).toBe(false);
  });
});

describe('실패 이유', () => {
  it('망 문제를 가른다', () => {
    for (const t of ['curl: (6) Could not resolve host: github.com', 'curl: (7) Failed to connect', 'npm ERR! ENOTFOUND', 'getaddrinfo EAI_AGAIN', 'Cannot reach the internet. Check', '인터넷에 연결할 수 없어요']) expect(failKind(t)).toBe('net');
    expect(failKind('checksum mismatch')).toBe('other');
    expect(failKind('anything', false)).toBe('net');
  });
});

describe('항목 결과', () => {
  const c = { claudePath: '/x/claude', clt: true, python: true };
  it('claude 는 있고 옛 판이 아니어야', () => {
    expect(itemOk('claude', c, false)).toBe(true);
    expect(itemOk('claude', c, true)).toBe(false);
    expect(itemOk('claude', { ...c, claudePath: null }, false)).toBe(false);
  });
  it('점검 결과가 없으면 안 된 것', () => expect(itemOk('claude', null, false)).toBe(false));
  it('윈도우 git·파이썬', () => {
    expect(itemOk('git', { ...c, clt: false }, false)).toBe(false);
    expect(itemOk('python', { ...c, python: false }, false)).toBe(false);
  });
});

describe('바닥 선', () => {
  it('처음 0, 끝 1, 준비는 항목만큼 자라고 줄지 않는다', () => {
    const items = itemsFor(false);
    expect(lineLength('start', items, false)).toBe(0);
    const a = lineLength('prep', items, false);
    const b = lineLength('prep', setItem(items, 'tools', 'ok'), false);
    const all = items.map((i) => ({ ...i, state: 'ok' as const }));
    const c = lineLength('prep', all, false);
    const d = lineLength('login', all, false);
    const e = lineLength('login', all, true);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(d);
    expect(d).toBeLessThan(e);
    expect(lineLength('done', all, true)).toBe(1);
  });
});

describe('이어 하기·로그인 명령', () => {
  it('시작을 눌렀으면 준비부터', () => {
    expect(resumeScreen(false)).toBe('start');
    expect(resumeScreen(true)).toBe('prep');
  });
  it('Console 길은 --console 만 붙인다', () => {
    expect(loginCommand("'/x/claude' auth login; r=$?", true)).toBe("'/x/claude' auth login --console; r=$?");
    expect(loginCommand("'/x/claude' auth login; r=$?", false)).toBe("'/x/claude' auth login; r=$?");
  });
});

describe('첫 설치 뒤 첫 참모 저절로 띄우기(0.4.9, 사용자 "웬만하면 다 자동으로")', () => {
  const base = { wanted: true, setupDone: true, seen: true, hasEnv: true, orchs: 0 };
  it('시작하기를 누른 뒤, 세션 목록을 본 뒤, 참모가 하나도 없을 때만', () => {
    expect(firstSpawnDue(base)).toBe(true);
    expect(firstSpawnDue({ ...base, wanted: false })).toBe(false);
    expect(firstSpawnDue({ ...base, setupDone: false })).toBe(false);
    expect(firstSpawnDue({ ...base, seen: false })).toBe(false);
    expect(firstSpawnDue({ ...base, hasEnv: false })).toBe(false);
    expect(firstSpawnDue({ ...base, orchs: 1 })).toBe(false);
  });
});
