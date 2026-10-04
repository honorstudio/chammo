import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { canAdopt, gridShape, parseSpawnOutput } from './adopt';
import type { Session } from './session';

const base: Session = {
  id: 's', name: 'n', cwd: '/d/todo-api', kind: 'interactive', state: 'idle',
  project: 'todo-api', workspace: null, startedAt: 0, sessionId: 'uuid', pid: 10,
};

describe('canAdopt — 터미널 세션을 앱으로 옮겨도 되나', () => {
  it('터미널 세션이 입력 대기면 된다', () => {
    expect(canAdopt(base)).toEqual({ ok: true });
  });

  it('작업 중이면 안 된다 — 끊으면 진행 중인 턴이 날아간다', () => {
    expect(canAdopt({ ...base, state: 'working' })).toEqual({ ok: false, reason: '작업이 끝나면 옮길 수 있어' });
  });

  it('이미 백그라운드면 옮길 게 없다', () => {
    expect(canAdopt({ ...base, kind: 'background' })).toEqual({ ok: false, reason: '이미 앱에서 붙을 수 있어' });
  });

  it('pid나 sessionId가 없으면 안 된다 — 누구를 끄고 무엇을 이을지 모른다', () => {
    expect(canAdopt({ ...base, pid: undefined }).ok).toBe(false);
    expect(canAdopt({ ...base, sessionId: undefined }).ok).toBe(false);
  });

  it('확인창(blocked)에 멈춘 세션은 옮겨도 된다 — 대화는 디스크에 있다', () => {
    expect(canAdopt({ ...base, state: 'blocked' })).toEqual({ ok: true });
  });
});

describe('parseSpawnOutput — claude --bg 출력 한 줄', () => {
  it('respawn 은 같은 세션 그대로 — 복사본이 아니다(2026-10-01 되살리면 새 번호·압축 앞 대화가 사라졌다)', () => {
    expect(parseSpawnOutput('respawned f00d0001\n')).toEqual({ id: 'f00d0001', copy: false });
  });
  it('새로 띄움', () => {
    expect(parseSpawnOutput('backgrounded · 1a2b3c4d · orch-probe\n  claude agents  list sessions')).toEqual({ id: '1a2b3c4d', copy: false });
  });

  it('이어붙이기 성공 (이름 없이)', () => {
    expect(parseSpawnOutput('backgrounded · feed0002')).toEqual({ id: 'feed0002', copy: false });
  });

  it('원본이 아직 살아 있어 복사본이 생김 — 경고해야 한다', () => {
    const out = 'note: session feed0002 is already running in the background, so this started a copy as be71fb28. `claude attach feed0002` opens the original.';
    expect(parseSpawnOutput(out)).toEqual({ id: 'be71fb28', copy: true });
  });

  it('알 수 없는 출력은 던진다', () => {
    expect(() => parseSpawnOutput('error: unknown option')).toThrow();
  });
});

describe('gridShape — 전체 보기 격자', () => {
  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2], // 3열이면 한 칸이 55자 남짓 — Claude 화면엔 폭이 먼저다
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 3],
    [9, 3, 3],
    [10, 4, 3],
  ])('%i개 → %i열 %i줄', (n, cols, rows) => {
    expect(gridShape(n)).toEqual({ cols, rows });
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('옮길 수 없는 이유와 오류를 영어로', () => {
    setLang('en');
    expect(canAdopt({ ...base, state: 'working' })).toEqual({ ok: false, reason: 'Can move it once the current work finishes' });
    expect(() => parseSpawnOutput('huh')).toThrow("Couldn't read claude --bg output: huh");
  });
});
