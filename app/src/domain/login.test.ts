import { describe, expect, it } from 'vitest';
import type { SessionState } from './session';
import { loggedOutSeen, emptyLogin, loginStep, readProbe, stalledOf, type LoginInput } from './login';

const T0 = Date.parse('2026-10-06T00:30:22Z');
const s = (session: string, ts: number, kind: 'background' | 'interactive' = 'background') => ({ session, name: session, ts, kind });
const inp = (o: Partial<LoginInput>): LoginInput => ({ now: T0 + 60_000, stalled: [], loginAt: null, loggedIn: null, liveAuthAt: null, okAt: null, ...o });

describe('loginStep — 로그인 필요 하나로 묶기', () => {
  it('멈춘 세션이 없고 맥도 멀쩡하면 아무것도 안 한다', () => {
    const p = loginStep(emptyLogin(), inp({ loggedIn: true, loginAt: T0 - 3600_000 }));
    expect(p).toMatchObject({ need: null, nudge: [], retry: [], respawn: [] });
  });

  it('로그인 오류로 멈춘 세션이 있고 그 뒤 새 로그인이 없으면 로그인 필요 — 세션 여럿을 한 카드로', () => {
    const p = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0), s('project-x', T0 + 5_000)], loginAt: T0 - 3600_000, loggedIn: true }));
    expect(p.need).toEqual({ since: T0, sessions: ['imac', 'project-x'], machine: false });
    expect(p.nudge).toEqual([]); // 고쳐지기 전엔 '이어서'를 안 보낸다(아이맥 00:30:31 — 보낸 즉시 또 같은 오류)
  });

  it('맥 전체가 로그아웃(auth status false)이면 멈춘 세션이 없어도 로그인 필요', () => {
    expect(loginStep(emptyLogin(), inp({ loggedIn: false })).need).toEqual({ since: T0 + 60_000, sessions: [], machine: true });
  });

  it('auth status 를 모르면(null — 아직 안 쟀거나 못 잼) 그것만으로 막지 않는다', () => {
    expect(loginStep(emptyLogin(), inp({ loggedIn: null })).need).toBeNull();
  });

  it('지금 로그인으로 물은 사용량이 401 이면(계정 풀) 로그인 필요 — 그 뒤 새 로그인이 있으면 아님', () => {
    expect(loginStep(emptyLogin(), inp({ liveAuthAt: T0, loggedIn: true })).need?.machine).toBe(true);
    expect(loginStep(emptyLogin(), inp({ liveAuthAt: T0, loginAt: T0 + 1_000, loggedIn: true })).need).toBeNull();
  });

  it('로그인이 풀린 채 맥을 다시 켜도(since 는 가장 이른 멈춤) 같은 카드', () => {
    const mem = loginStep(emptyLogin(), inp({ loggedIn: false })).mem;
    expect(loginStep(mem, inp({ now: T0 + 120_000, loggedIn: false })).need?.since).toBe(T0 + 60_000);
  });
});

describe('loginStep — 로그인 뒤 이어서', () => {
  it('멈춘 뒤 키체인이 새로 써졌으면 고쳐진 것으로 — 백그라운드 세션마다 한 번 이어서, 카드는 내린다', () => {
    const p = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0), s('project-x', T0 + 5_000)], loginAt: T0 + 70_000, now: T0 + 80_000, loggedIn: true }));
    expect(p.need).toBeNull();
    expect(p.nudge).toEqual(['imac', 'project-x']);
  });

  it('같은 로그인으로는 두 번 안 보낸다 — 이어서 보낸 뒤 기록이 늦게 와도(다음 폴링에 아직 옛 오류 줄)', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000, loggedIn: true }));
    const b = loginStep(a.mem, inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 85_000, loggedIn: true }));
    expect(b.nudge).toEqual([]);
    expect(b.need).toBeNull();
  });

  it('로그인 직후 몇 초는 기다린다(키체인과 oauthAccount 를 다 쓸 때까지)', () => {
    expect(loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 71_000 })).nudge).toEqual([]);
  });

  it('오래 묵은 멈춤(6시간 넘게)엔 자동으로 이어서를 안 보낸다 — 며칠 전 일이 갑자기 다시 돌지 않게. 로그인이 멀쩡하면 카드도 없다', () => {
    const old = T0 - 7 * 3600_000;
    const p = loginStep(emptyLogin(), inp({ stalled: [s('old', old), s('new', T0)], loginAt: T0 + 70_000, now: T0 + 80_000, loggedIn: true }));
    expect(p.nudge).toEqual(['new']);
    expect(p.need).toBeNull();
    // 로그인이 안 고쳐졌으면 오래됐어도 카드엔 센다
    expect(loginStep(emptyLogin(), inp({ stalled: [s('old', old)], loginAt: old - 1, loggedIn: true })).need?.sessions).toEqual(['old']);
  });

  it('대화형(터미널) 세션은 사람 몫 — 이어서 안 보내지만 카드엔 센다', () => {
    const p = loginStep(emptyLogin(), inp({ stalled: [s('term', T0, 'interactive')], loginAt: T0 - 1, loggedIn: true }));
    expect(p.need?.sessions).toEqual(['term']);
    const fixed = loginStep(emptyLogin(), inp({ stalled: [s('term', T0, 'interactive')], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    expect(fixed.nudge).toEqual([]);
    expect(fixed.need).toBeNull(); // 로그인이 고쳐졌으면 카드는 내린다 — 터미널에서 사람이 '계속'만 치면 된다
  });

  it('이어서 뒤 또 로그인 오류면 다시 로그인 필요(로그인이 안 먹었다) — 이어서는 다시 안 보낸다', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    const b = loginStep(a.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 70_000, now: T0 + 90_000 }));
    expect(b.need?.sessions).toEqual(['imac']);
    expect(b.nudge).toEqual([]);
    expect(b.respawn).toEqual([]);
  });

  it('이어서 뒤 또 오류인데 다른 세션은 그 로그인 뒤 정상 답(자격은 멀쩡) → 그 세션만 다시 띄운다(한 번)', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    const b = loginStep(a.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 70_000, okAt: T0 + 85_000, now: T0 + 90_000 }));
    expect(b.respawn).toEqual(['imac']);
    expect(b.need).toBeNull();
    const c = loginStep(b.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 70_000, okAt: T0 + 85_000, now: T0 + 95_000 }));
    expect(c.respawn).toEqual([]); // 다시 띄우는 중 — 또 안 한다
    const d = loginStep(c.mem, inp({ stalled: [s('imac', T0 + 120_000)], loginAt: T0 + 70_000, okAt: T0 + 85_000, now: T0 + 130_000 }));
    expect(d.respawn).toEqual([]);
    expect(d.need?.sessions).toEqual(['imac']); // 다시 띄워도 안 되면 사람에게
  });

  it('새 로그인이 또 생기면(키체인 다시 씀) 그 로그인으로 한 번 더 이어서', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    const b = loginStep(a.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 70_000, now: T0 + 90_000 }));
    const c = loginStep(b.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 300_000, now: T0 + 310_000 }));
    expect(c.nudge).toEqual(['imac']);
  });

  it('키체인이 자주 다시 써져도(갱신) 세션마다 2분에 한 번보다 자주 안 보낸다', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    const b = loginStep(a.mem, inp({ stalled: [s('imac', T0 + 82_000)], loginAt: T0 + 90_000, now: T0 + 100_000 }));
    expect(b.nudge).toEqual([]);
  });

  it('멈춤이 풀린 세션의 기억은 오래되면 잊는다', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [s('imac', T0)], loginAt: T0 + 70_000, now: T0 + 80_000 }));
    const b = loginStep(a.mem, inp({ stalled: [], now: T0 + 80_000 + 2 * 3600_000 }));
    expect(b.mem.nudged).toEqual({});
  });
});

describe('loginStep — 갱신 겹침(retry): 카드 없이 1분 뒤 이어서 한 번', () => {
  const r = (session: string, ts: number) => ({ ...s(session, ts), retry: true as const });
  it('1분 전엔 기다리고, 1분 뒤 한 번 — 로그인 필요로 안 센다', () => {
    expect(loginStep(emptyLogin(), inp({ stalled: [r('g', T0)], now: T0 + 30_000 }))).toMatchObject({ need: null, retry: [] });
    const a = loginStep(emptyLogin(), inp({ stalled: [r('g', T0)], now: T0 + 61_000 }));
    expect(a).toMatchObject({ need: null, nudge: [], retry: ['g'] });
    expect(loginStep(a.mem, inp({ stalled: [r('g', T0)], now: T0 + 70_000 })).retry).toEqual([]);
  });
  it('또 겹치면(새 오류 시각) 다시 한 번 — 세션마다 2분 간격', () => {
    const a = loginStep(emptyLogin(), inp({ stalled: [r('g', T0)], now: T0 + 61_000 }));
    expect(loginStep(a.mem, inp({ stalled: [r('g', T0 + 65_000)], now: T0 + 130_000 })).retry).toEqual([]);
    expect(loginStep(a.mem, inp({ stalled: [r('g', T0 + 65_000)], now: T0 + 190_000 })).retry).toEqual(['g']);
  });
  it('같은 세션이 갱신 겹침으로 세 번 이어서를 받고도 또 멈추면 그만 보내고 카드로(락이 안 풀림 — 끝없이 2분마다 보내지 않게)', () => {
    let mem = emptyLogin();
    let t = T0;
    for (let i = 0; i < 3; i++) {
      const p = loginStep(mem, inp({ stalled: [r('g', t)], now: t + 61_000 }));
      expect(p.retry, `회차 ${i + 1}`).toEqual(['g']);
      mem = p.mem;
      t += 200_000;
    }
    const p = loginStep(mem, inp({ stalled: [r('g', t)], now: t + 61_000 }));
    expect(p.retry).toEqual([]);
    expect(p.need?.sessions).toEqual(['g']);
    // 풀리면(멈춤 목록에서 빠지면) 센 것을 잊는다
    const q = loginStep(p.mem, inp({ stalled: [], now: t + 70_000 }));
    expect(loginStep(q.mem, inp({ stalled: [r('g', t + 80_000)], now: t + 200_000 })).retry).toEqual(['g']);
  });
  it('오래 묵은 갱신 겹침엔 안 보낸다', () => {
    expect(loginStep(emptyLogin(), inp({ stalled: [r('g', T0 - 7 * 3600_000)], now: T0 })).retry).toEqual([]);
  });
  it('대화형은 안 보낸다', () => {
    expect(loginStep(emptyLogin(), inp({ stalled: [{ ...r('t', T0), kind: 'interactive' }], now: T0 + 61_000 })).retry).toEqual([]);
  });
});

describe('loggedOutSeen — auth status false 는 두 번 연달아 봐야 로그아웃(키체인이 잠깐 잠긴 한 번으로 카드·알림이 안 뜨게)', () => {
  it('한 번은 모름, 두 번째부터 false, true·모름이 끼면 다시 센다', () => {
    let st = loggedOutSeen(0, false);
    expect(st).toEqual({ falses: 1, loggedIn: null });
    st = loggedOutSeen(st.falses, false);
    expect(st).toEqual({ falses: 2, loggedIn: false });
    expect(loggedOutSeen(st.falses, true)).toEqual({ falses: 0, loggedIn: true });
    expect(loggedOutSeen(st.falses, null)).toEqual({ falses: 0, loggedIn: null });
  });
});

describe('stalledOf — 로그인 오류로 멈춘 세션', () => {
  const act = (id: string, kind: 'background' | 'interactive', state: SessionState, auth?: string) => ({ session: { id, name: id, kind, state }, activity: auth ? { auth: { ts: auth, text: 'Login expired · Please run /login' } } : {} });
  it('일하는 중이면 아니다(이어서 받아 도는 중)', () => {
    expect(stalledOf([act('a', 'background', 'working', '2026-10-06T00:30:22Z'), act('b', 'background', 'idle', '2026-10-06T00:30:22Z'), act('c', 'background', 'idle')])).toEqual([
      { session: 'b', name: 'b', ts: T0, kind: 'background' },
    ]);
  });
  it('갱신 겹침은 retry 표시로', () => {
    const a = { session: { id: 'g', name: 'g', kind: 'background' as const, state: 'idle' as const }, activity: { auth: { ts: '2026-10-06T00:30:22Z', text: 'x', retry: true as const } } };
    expect(stalledOf([a])).toEqual([{ session: 'g', name: 'g', ts: T0, kind: 'background', retry: true }]);
  });
  it('시각을 못 읽는 줄은 뺀다', () => {
    expect(stalledOf([act('a', 'background', 'idle', 'x')])).toEqual([]);
  });
});

describe('readProbe — Rust login_probe 답', () => {
  it('모양이 깨졌으면 모름', () => {
    expect(readProbe(null)).toEqual({ loggedIn: null, credAt: null });
    expect(readProbe({ loggedIn: 'yes', credAt: 'x' })).toEqual({ loggedIn: null, credAt: null });
    expect(readProbe({ loggedIn: true, credAt: 1_790_000_000_000 })).toEqual({ loggedIn: true, credAt: 1_790_000_000_000 });
  });
});
