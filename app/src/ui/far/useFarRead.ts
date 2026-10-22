// 다른 기기 읽기 한 벌 — 데스크톱(remoteApi, 앱 주기 every)과 폰(farApi, 화면이 숨으면 쉬는 주기)이 같이 쓴다.
// 세션 5초·꼬리+작업 기록 15초·보관함 30초. 앞 요청이 아직이면 그 바퀴는 건너뛴다(안 닿는 기기에 요청이 쌓여 이 맥 폰 서버 자리를 다 쥐지 않게).
// 읽은 값엔 어느 기기 것인지 붙여 두고 지금 기기 것만 낸다 — 기기를 바꾼 첫 그리기에 앞 기기 참모가 새 기기 이름 아래 보이지 않게
import { useEffect, useMemo, useState } from 'react';
import type { MobileEnv, PeerApi } from '../../data/peerApi';
import { farHome, farLocker, type FarHomeView, type FarOwner } from '../../domain/farHome';
import { makeTaskTail } from '../../domain/taskTail';

export type FarLockerState = FarOwner[] | 'old' | 'off' | 'err' | null;
export type FarRead = { env: MobileEnv | null; home: FarHomeView | null; err: string | null; locker: FarLockerState; again: () => void };
/** 주기 실행기 — 멈춤 함수를 돌려준다 */
export type Every = (f: () => void, ms: number) => () => void;

type Got = { dev: string; env: MobileEnv | null; raw: string | null; tails: Record<string, string>; tasks: string; err: string | null; locker: FarLockerState };
const empty = (dev: string): Got => ({ dev, env: null, raw: null, tails: {}, tasks: '', err: null, locker: null });

/** 한 번에 하나만 — 들고 있는 요청이 있으면 이번 바퀴는 건너뛴다 */
const single = (f: () => Promise<void>) => {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try { await f(); } finally { busy = false; }
  };
};

/** 그 기기 보관함 오류 글 → 화면 상태(옛 판 = 길 없음 404, 끈 기기 = 403) */
export const lockerErr = (m: string): FarLockerState => (m === 'not found' ? 'old' : m === 'locker not shared' ? 'off' : 'err');

export function useFarRead(dev: string, api: PeerApi | null, every: Every): FarRead {
  const [g, setG] = useState<Got>(() => empty(dev));
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!dev || !api) return; // 이 맥을 보는 중 — 아무것도 안 읽는다
    let alive = true;
    const put = (p: Partial<Got>) => { if (alive) setG((o) => ({ ...(o.dev === dev ? o : empty(dev)), ...p })); };
    const tail = makeTaskTail(api.readTasksSince);
    let env: MobileEnv | null = null;
    let raw: string | null = null; // 첫 바퀴 꼬리 읽기가 그리기 전 목록을 보게
    const sessions = single(async () => {
      try {
        env = env ?? (await api.getEnv());
        raw = await api.listSessionsRaw();
        put({ env, raw, err: null });
      } catch (e) { put({ err: String(e instanceof Error ? e.message : e) }); }
    });
    const slow = single(async () => {
      try {
        const tasks = await tail();
        const ids = (JSON.parse(raw || '[]') as { sessionId?: string }[]).map((s) => s.sessionId).filter((x): x is string => !!x);
        put({ tasks, ...(ids.length ? { tails: await api.readTails(ids) } : {}) });
      } catch { /* 다음 바퀴 */ }
    });
    const lk = single(async () => {
      try { put({ locker: farLocker(await api.readPeerLocker()) }); }
      catch (e) { put({ locker: lockerErr(String(e instanceof Error ? e.message : e)) }); }
    });
    void sessions().then(slow);
    void lk();
    const stops = [every(() => void sessions(), 5000), every(() => void slow(), 15_000), every(() => void lk(), 30_000)];
    return () => { alive = false; stops.forEach((s) => s()); };
  }, [dev, api, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = g.dev === dev ? g : empty(dev);
  const home = useMemo(() => (mine.env && mine.raw !== null ? farHome({ env: mine.env, sessionsRaw: mine.raw, tasksText: mine.tasks, tails: mine.tails, now: Date.now() }) : null), [mine.env, mine.raw, mine.tasks, mine.tails]);
  return { env: mine.env, home: dev ? home : null, err: dev ? mine.err : null, locker: dev ? mine.locker : null, again: () => setN((x) => x + 1) };
}
