import { describe, expect, it } from 'vitest';
import { forwardText, GRACE_MS, nextForward } from './forwardQuestion';
import type { Session } from './session';

const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, name: id, cwd: `/dev/${id}`, kind: 'background', state: 'working', project: id, workspace: null, startedAt: 0, ...over,
});
const asking = (id: string, over: Partial<Session> = {}) => s(id, { state: 'blocked', waitingFor: 'input needed', ...over });
const orch = s('local', { name: '참모', state: 'idle' });
const never = () => false;

describe('nextForward — 하위 세션 선택지 창을 참모에게 넘길 때', () => {
  it('처음 본 순간엔 안 넘기고 30초 뒤에 넘긴다', () => {
    const a = nextForward([asking('video-app')], orch, new Map(), 1000, never);
    expect(a.sub).toBeUndefined();
    const b = nextForward([asking('video-app')], orch, a.track, 1000 + GRACE_MS, never);
    expect(b.sub?.id).toBe('video-app');
  });

  it('한 번 멈춘 동안엔 한 번만 넘긴다', () => {
    const a = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, never);
    expect(a.sub?.id).toBe('video-app');
    expect(nextForward([asking('video-app')], orch, a.track, GRACE_MS * 5, never).sub).toBeUndefined();
  });

  it('창이 닫혔다가 다시 뜨면 다시 센다', () => {
    const a = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, never);
    const b = nextForward([s('video-app')], orch, a.track, GRACE_MS + 1, never);
    expect(b.track.has('video-app')).toBe(false);
    const c = nextForward([asking('video-app')], orch, b.track, GRACE_MS + 2, never);
    expect(c.sub).toBeUndefined();
    expect(nextForward([asking('video-app')], orch, c.track, GRACE_MS * 2 + 2, never).sub?.id).toBe('video-app');
  });

  it('권한 창(permission prompt)은 앱이 자동 허용하니 안 넘긴다', () => {
    const p = asking('project-b', { waitingFor: 'permission prompt' });
    expect(nextForward([p], orch, new Map([['project-b', 0]]), GRACE_MS, never).sub).toBeUndefined();
  });

  // 참모 입력칸에 글자 + Enter 를 넣으면 참모 자기 확인창의 선택지를 골라 버린다
  it('참모가 확인창에 걸려 있으면 기다린다 (기록은 지우지 않는다)', () => {
    const r = nextForward([asking('video-app')], { ...orch, state: 'blocked' }, new Map([['video-app', 0]]), GRACE_MS, never);
    expect(r.sub).toBeUndefined();
    expect(nextForward([asking('video-app')], orch, r.track, GRACE_MS + 1, never).sub?.id).toBe('video-app');
  });

  it('참모가 없으면 넘기지 않는다', () => {
    expect(nextForward([asking('video-app')], undefined, new Map([['video-app', 0]]), GRACE_MS, never).sub).toBeUndefined();
  });

  it('사용자가 그 세션 화면을 보고 있으면 넘기지 않는다', () => {
    const r = nextForward([asking('video-app')], orch, new Map([['video-app', 0]]), GRACE_MS, (x) => x.id === 'video-app');
    expect(r.sub).toBeUndefined();
  });

  it('대화형(터미널) 세션은 사용자가 직접 보고 있으니 안 넘긴다', () => {
    const r = nextForward([asking('term', { kind: 'interactive' })], orch, new Map([['term', 0]]), GRACE_MS, never);
    expect(r.sub).toBeUndefined();
  });
});

describe('forwardText — 참모 입력칸에 들어갈 한 줄', () => {
  it('어디·세션 id·읽고 답하는 명령', () => {
    const t = forwardText(asking('92dd8234', { project: 'video-app', name: 'project-x-video' }));
    expect(t).toContain('video-app');
    expect(t).toContain('project-x-video');
    expect(t).toContain('scripts/choice show 92dd8234');
    expect(t).not.toContain('\n');
  });
});
